// The run manager core (PLAN §18 "Runs"). Electron-free so vitest can drive it: the browser and
// notification hooks are injected through setRunDeps() by runs/index.ts (tests inject fakes).
//
//  - one active run per brand; later runs for that brand wait in a FIFO queue (their row exists from
//    the moment they are queued, status running + a "waiting" log line, so flows.run can return them)
//  - AbortController per run, combined with the caller's signal; abortAll() is wired to the kill switch
//  - log entries are kept in memory, emitted live (run.log) and written to SQLite in batches
//  - every step logs start/finish + duration; a failing step gets a screenshot attached
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { detectCheckpoint, type PageFacts } from '@shared/checkpoints'
import { isOffLimits } from '@shared/platforms'
import type { Actor, FlowRun, LiveRun, RunLogEntry, RunStatus } from '@shared/types'
import { logActivity } from '../../core/activity'
import { db, j, pj } from '../../core/db'
import { GuardrailError, UserError, notFound } from '../../core/errors'
import { emit } from '../../core/events'
import { newId, nowIso } from '../../core/ids'
import { paths } from '../../core/paths'
import { requestStatus, runtime } from '../../core/runtime'

export interface RunOptions {
  brandId: string
  actor: Actor
  label: string
  flowId?: string | null
  recipe?: string | null
  postId?: string | null
  /** external abort (e.g. MCP request cancelled) */
  signal?: AbortSignal
}

export interface RunContext {
  runId: string
  brandId: string
  actor: Actor
  signal: AbortSignal
  page(): Promise<Page>
  log(msg: string, level?: 'info' | 'warn' | 'error'): void
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  /** saves a PNG of the active page under paths.screens; returns the absolute path */
  screenshot(label?: string): Promise<string>
  /** throws GuardrailError if the page shows a checkpoint / captcha / rate-limit wall */
  checkpoint(): Promise<void>
  guardUrl(url: string): void
  /** throws if aborted */
  throwIfAborted(): void
  /** abortable sleep */
  sleep(ms: number): Promise<void>
  /** resolves/rejects with p, or rejects as soon as the run is aborted (p keeps running detached) */
  race<T>(p: Promise<T>): Promise<T>
}

export interface RunDeps {
  activePage(brandId: string, ensureOpen?: boolean): Promise<Page>
  frontBrand(brandId: string, page?: Page): Promise<void>
  notify(n: { title: string; body: string; path?: string; urgent?: boolean }): void
}

const missing = (): never => {
  throw new UserError('browser control is not wired', 'not_implemented')
}
let deps: RunDeps = { activePage: missing, frontBrand: async () => {}, notify: () => {} }
export function setRunDeps(d: Partial<RunDeps>): void {
  deps = { ...deps, ...d }
}

// GuardrailError rules that mean "a person has to look at the window" rather than "it broke".
const HUMAN_RULES = new Set(['checkpoint', 'handle_check', 'unsupported'])
const MAX_LOG = 3000
const FLUSH_MS = 1000
const FLUSH_AT = 40

type Result<T> = { run: FlowRun; result?: T; error?: unknown }

interface RunState {
  id: string
  opts: RunOptions
  ctrl: AbortController
  signal: AbortSignal
  abortReason: string | null
  phase: 'queued' | 'active' | 'done'
  step: string | null
  startedAt: string
  log: RunLogEntry[]
  truncated: boolean
  screens: string[]
  forced: RunStatus | null
  dirty: boolean
  flushTimer: NodeJS.Timeout | null
  shotSeq: number
  closed: boolean
  go: () => void
  done: Promise<Result<unknown>>
}

const states = new Map<string, RunState>()
const lanes = new Map<string, { active: RunState | null; queue: RunState[] }>()

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function lane(brandId: string) {
  let l = lanes.get(brandId)
  if (!l) {
    l = { active: null, queue: [] }
    lanes.set(brandId, l)
  }
  return l
}

// ── persistence ──────────────────────────────────────────────────────────────
interface RunRow {
  id: string
  flow_id: string | null
  recipe: string | null
  brand_id: string
  post_id: string | null
  actor: string
  label: string
  status: string
  started_at: string
  ended_at: string | null
  log: string
  screens: string
  error: string | null
}

export const mapRun = (r: RunRow): FlowRun => ({
  id: r.id,
  flowId: r.flow_id,
  recipe: r.recipe,
  brandId: r.brand_id,
  postId: r.post_id,
  actor: r.actor as Actor,
  label: r.label,
  status: r.status as RunStatus,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  log: pj<RunLogEntry[]>(r.log, []),
  screens: pj<string[]>(r.screens, []),
  error: r.error
})

function flush(s: RunState): void {
  if (s.flushTimer) {
    clearTimeout(s.flushTimer)
    s.flushTimer = null
  }
  if (!s.dirty) return
  s.dirty = false
  try {
    db.run('UPDATE runs SET log = ?, screens = ? WHERE id = ?', j(s.log), j(s.screens), s.id)
  } catch (e) {
    console.warn('run log write failed', s.id, e)
  }
}

function addLog(s: RunState, entry: RunLogEntry): void {
  // a body still unwinding after its run ended (abort races it) must not rewrite the final record
  if (s.closed) return
  if (s.log.length >= MAX_LOG) {
    if (entry.level === 'info' && !entry.screen) {
      if (!s.truncated) {
        s.truncated = true
        s.log.push({ at: nowIso(), level: 'warn', msg: `log truncated after ${MAX_LOG} entries — later info lines are not kept` })
      }
      emit('run.log', { runId: s.id, brandId: s.opts.brandId, entry })
      return
    }
  }
  s.log.push(entry)
  s.dirty = true
  emit('run.log', { runId: s.id, brandId: s.opts.brandId, entry })
  if (s.log.length % FLUSH_AT === 0) flush(s)
  else if (!s.flushTimer) s.flushTimer = setTimeout(() => flush(s), FLUSH_MS)
}

function brandName(brandId: string): string {
  return db.get<{ name: string }>('SELECT name FROM brands WHERE id = ?', brandId)?.name ?? brandId
}

function snapshot(s: RunState, status: RunStatus = 'running', endedAt: string | null = null, error: string | null = null): FlowRun {
  return {
    id: s.id,
    flowId: s.opts.flowId ?? null,
    recipe: s.opts.recipe ?? null,
    brandId: s.opts.brandId,
    postId: s.opts.postId ?? null,
    actor: s.opts.actor,
    label: s.opts.label,
    status,
    startedAt: s.startedAt,
    endedAt,
    log: [...s.log],
    screens: [...s.screens],
    error
  }
}

// ── page helpers ─────────────────────────────────────────────────────────────
/** What detectCheckpoint looks at: url, title, visible text, visible iframes, open dialogs. */
export async function pageFacts(page: Page): Promise<PageFacts> {
  const inPage = await page
    .evaluate(() => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const cs = getComputedStyle(el as HTMLElement)
        return r.width >= 40 && r.height >= 40 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
      }
      const frames = [...document.querySelectorAll('iframe')].filter(visible).map((f) => (f as HTMLIFrameElement).src || '')
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')].filter(visible).map((d) => (d as HTMLElement).innerText || '')
      return {
        title: document.title,
        text: (document.body?.innerText || '').slice(0, 30000),
        frames,
        dialogText: dialogs.join('\n').slice(0, 5000)
      }
    })
    .catch(() => ({ title: '', text: '', frames: [] as string[], dialogText: '' }))
  // nested frame URLs from Playwright too (cross-origin captcha frames inside a visible wrapper);
  // only frames whose own element is visible count
  const nested: string[] = []
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue
    try {
      const el = await f.frameElement()
      const box = await el.boundingBox()
      if (box && box.width >= 40 && box.height >= 40) nested.push(f.url())
    } catch {
      /* detached */
    }
  }
  return { url: page.url(), title: inPage.title, text: inPage.text, frameUrls: [...new Set([...inPage.frames, ...nested])].filter(Boolean), dialogText: inPage.dialogText }
}

function safeLabel(s: string): string {
  return s.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'shot'
}

// ── the run context given to bodies ──────────────────────────────────────────
function abortError(s: RunState): Error {
  const e = new Error(s.abortReason ?? 'Stopped')
  e.name = 'AbortError'
  return e
}

function makeContext(s: RunState): RunContext {
  const { brandId, actor } = s.opts
  const throwIfAborted = () => {
    if (s.signal.aborted) throw abortError(s)
  }
  const race = <T>(p: Promise<T>): Promise<T> => {
    if (s.signal.aborted) {
      p.catch(() => {})
      return Promise.reject(abortError(s))
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        p.catch(() => {})
        reject(abortError(s))
      }
      s.signal.addEventListener('abort', onAbort, { once: true })
      p.then(
        (v) => {
          s.signal.removeEventListener('abort', onAbort)
          resolve(v)
        },
        (e) => {
          s.signal.removeEventListener('abort', onAbort)
          reject(e)
        }
      )
    })
  }
  const log = (msg: string, level: RunLogEntry['level'] = 'info', extra: Partial<RunLogEntry> = {}) => addLog(s, { at: nowIso(), level, msg, ...extra })

  const screenshot = async (label?: string): Promise<string> => {
    const page = await race(deps.activePage(brandId, false))
    mkdirSync(paths.screens, { recursive: true })
    const file = join(paths.screens, `${s.id}-${String(++s.shotSeq).padStart(2, '0')}-${safeLabel(label ?? s.step ?? 'shot')}.png`)
    const buf = await race(page.screenshot({ timeout: 15_000 }))
    writeFileSync(file, buf)
    s.screens.push(file)
    s.dirty = true
    return file
  }

  const rt: RunContext = {
    runId: s.id,
    brandId,
    actor,
    signal: s.signal,
    page: () => race(deps.activePage(brandId)),
    log: (msg, level = 'info') => log(msg, level, s.step ? { step: s.step } : {}),
    throwIfAborted,
    race,
    sleep: (ms) =>
      race(
        new Promise<void>((r) => {
          const t = setTimeout(r, Math.max(0, ms))
          s.signal.addEventListener('abort', () => clearTimeout(t), { once: true })
        })
      ),
    screenshot: async (label) => {
      const file = await screenshot(label)
      log(`Screenshot${label ? ` — ${label}` : ''}`, 'info', { step: s.step ?? undefined, screen: file })
      return file
    },
    step: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      throwIfAborted()
      const prev = s.step
      s.step = name
      requestStatus()
      const t0 = Date.now()
      log(`▶ ${name}`, 'info', { step: name })
      try {
        const out = await race(fn())
        log(`✓ ${name} (${fmtMs(Date.now() - t0)})`, 'info', { step: name })
        return out
      } catch (e) {
        if (s.signal.aborted) {
          log(`■ ${name} — stopped`, 'warn', { step: name })
          throw abortError(s)
        }
        let shot: string | undefined
        if (!(e instanceof GuardrailError && e.rule === 'checkpoint')) {
          shot = await screenshot(`failed-${name}`).catch(() => undefined)
        }
        log(`✗ ${name} (${fmtMs(Date.now() - t0)}): ${errMsg(e)}`, 'error', { step: name, screen: shot })
        throw e
      } finally {
        s.step = prev
      }
    },
    guardUrl: (url) => {
      if ((actor === 'claude' || actor === 'flow') && isOffLimits(url))
        throw new GuardrailError(`That page is off-limits for automation (account security, billing or deactivation): ${url}`, 'off_limits')
    },
    checkpoint: async () => {
      throwIfAborted()
      const page = await race(deps.activePage(brandId, false))
      const facts = await race(pageFacts(page))
      const hit = detectCheckpoint(facts)
      if (!hit) return
      const shot = await screenshot('checkpoint').catch(() => undefined)
      s.forced = 'needs_human'
      log(`Stopped: ${hit.reason}. Cubby never solves these — finish it in the window.`, 'error', { step: s.step ?? undefined, screen: shot })
      const name = brandName(brandId)
      await deps.frontBrand(brandId, page).catch(() => {})
      deps.notify({ title: 'Cubby needs you', body: `${name}: ${hit.reason}`, path: `/runs/${s.id}`, urgent: true })
      logActivity({ actor, brandId, action: 'guardrail.checkpoint', detail: { runId: s.id, kind: hit.kind, reason: hit.reason, url: facts.url }, screen: shot ?? null })
      throw new GuardrailError(hit.reason, 'checkpoint')
    }
  }
  return rt
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

// ── lifecycle ────────────────────────────────────────────────────────────────
function finish<T>(s: RunState, outcome: { result?: T; error?: unknown }): Result<T> {
  s.phase = 'done'
  const e = outcome.error
  let status: RunStatus
  let error: string | null = null
  if (e === undefined) status = s.forced ?? 'ok'
  else if (s.signal.aborted) {
    status = 'aborted'
    error = s.abortReason ?? 'Stopped'
  } else if (s.forced) {
    status = s.forced
    error = errMsg(e)
  } else if (e instanceof GuardrailError && HUMAN_RULES.has(e.rule)) {
    status = 'needs_human'
    error = errMsg(e)
  } else {
    status = 'failed'
    error = errMsg(e)
  }
  const endedAt = nowIso()
  addLog(s, { at: endedAt, level: status === 'ok' ? 'info' : status === 'aborted' ? 'warn' : 'error', msg: status === 'ok' ? 'Finished' : `Ended: ${status}${error ? ` — ${error}` : ''}` })
  if (status === 'needs_human' && !(e instanceof GuardrailError && e.rule === 'checkpoint')) {
    // checkpoint() already notified; other human stops (handle check, unsupported) notify here
    deps.notify({ title: 'Cubby needs you', body: `${brandName(s.opts.brandId)}: ${error ?? s.opts.label}`, path: `/runs/${s.id}`, urgent: true })
  }
  s.dirty = false
  if (s.flushTimer) clearTimeout(s.flushTimer)
  s.flushTimer = null
  s.closed = true
  db.run('UPDATE runs SET status = ?, ended_at = ?, error = ?, log = ?, screens = ? WHERE id = ?', status, endedAt, error, j(s.log), j(s.screens), s.id)
  states.delete(s.id)
  emit('runs.changed', { id: s.id, status })
  requestStatus()
  const run = snapshot(s, status, endedAt, error)
  return e === undefined ? { run, result: outcome.result } : { run, error: e }
}

function pump(brandId: string): void {
  const l = lane(brandId)
  if (l.active) return
  const next = l.queue.shift()
  if (!next) {
    lanes.delete(brandId)
    return
  }
  l.active = next
  next.go()
}

export interface Enqueued<T> {
  run: FlowRun
  done: Promise<Result<T>>
}

/** Queue a run and return its record right away; `done` settles (never rejects) when it ends. */
export function enqueueRun<T>(opts: RunOptions, body: (rt: RunContext) => Promise<T>): Enqueued<T> {
  if (runtime.killSwitch && opts.actor !== 'you') throw new GuardrailError('Cubby is stopped (kill switch is on). Turn it off in the app to continue.', 'kill_switch')
  if (!db.get('SELECT 1 FROM brands WHERE id = ?', opts.brandId)) throw notFound('Brand')
  const id = newId('run_')
  const ctrl = new AbortController()
  const signal = opts.signal ? AbortSignal.any([ctrl.signal, opts.signal]) : ctrl.signal
  const startedAt = nowIso()
  let go!: () => void
  const started = new Promise<void>((r) => (go = r))
  const s: RunState = {
    id, opts, ctrl, signal, abortReason: null, phase: 'queued', step: null, startedAt, log: [], truncated: false, screens: [],
    forced: null, dirty: false, flushTimer: null, shotSeq: 0, closed: false, go, done: null as unknown as Promise<Result<unknown>>
  }
  if (opts.signal) opts.signal.addEventListener('abort', () => (s.abortReason ??= 'Cancelled by the caller'), { once: true })
  db.run(
    'INSERT INTO runs (id, flow_id, recipe, brand_id, post_id, actor, label, status, started_at, log, screens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, opts.flowId ?? null, opts.recipe ?? null, opts.brandId, opts.postId ?? null, opts.actor, opts.label, 'running', startedAt, '[]', '[]'
  )
  states.set(id, s)
  const l = lane(opts.brandId)
  const waitingFor = l.active ?? l.queue[l.queue.length - 1] ?? null
  l.queue.push(s)
  if (waitingFor) addLog(s, { at: nowIso(), level: 'info', msg: `Waiting for "${waitingFor.opts.label}" to finish in this brand` })

  const done = (async (): Promise<Result<T>> => {
    await started
    if (signal.aborted) return finish<T>(s, { error: abortError(s) })
    s.phase = 'active'
    addLog(s, { at: nowIso(), level: 'info', msg: `Started "${opts.label}" (by ${opts.actor})` })
    requestStatus()
    const rt = makeContext(s)
    try {
      const result = await rt.race(body(rt))
      return finish<T>(s, { result })
    } catch (error) {
      return finish<T>(s, { error })
    } finally {
      const ln = lane(opts.brandId)
      if (ln.active === s) ln.active = null
      pump(opts.brandId)
    }
  })()
  s.done = done as Promise<Result<unknown>>
  emit('runs.changed', { id, status: 'running' })
  requestStatus()
  pump(opts.brandId)
  return { run: snapshot(s), done }
}

/** Queue + execute a run. Resolves with the final run record and the body's result (if it succeeded). */
export async function startRun<T>(opts: RunOptions, body: (rt: RunContext) => Promise<T>): Promise<{ run: FlowRun; result?: T; error?: unknown }> {
  return enqueueRun(opts, body).done
}

export function liveRuns(): LiveRun[] {
  const out: LiveRun[] = []
  for (const s of states.values()) {
    out.push({
      runId: s.id,
      brandId: s.opts.brandId,
      brandName: brandName(s.opts.brandId),
      actor: s.opts.actor,
      label: s.opts.label,
      startedAt: s.startedAt,
      step: s.phase === 'queued' ? 'Waiting for the brand' : s.step
    })
  }
  return out
}

/** The live run currently holding this brand, if any (Claude's browser tools refuse while one runs). */
export function brandBusy(brandId: string): LiveRun | null {
  const a = lanes.get(brandId)?.active
  return a ? (liveRuns().find((r) => r.runId === a.id) ?? null) : null
}

function abortState(s: RunState, reason: string): void {
  if (s.signal.aborted) return
  s.abortReason = reason
  addLog(s, { at: nowIso(), level: 'warn', msg: reason })
  if (s.phase === 'queued') {
    const l = lanes.get(s.opts.brandId)
    if (l) l.queue = l.queue.filter((x) => x !== s)
    s.ctrl.abort(new Error(reason))
    s.go() // let it settle as aborted without taking the lane
    return
  }
  s.ctrl.abort(new Error(reason))
}

export function abortRun(runId: string, reason = 'Stopped by you'): boolean {
  const s = states.get(runId)
  if (!s) return false
  abortState(s, reason)
  return true
}

export function abortAll(reason = 'Stopped — kill switch'): void {
  for (const s of [...states.values()]) abortState(s, reason)
}

/** Settles once every live run has ended (used on quit and in tests). */
export async function drain(timeoutMs = 10_000): Promise<void> {
  const all = [...states.values()].map((s) => s.done)
  await Promise.race([Promise.allSettled(all), new Promise((r) => setTimeout(r, timeoutMs))])
}

export function getRun(id: string): FlowRun {
  const s = states.get(id)
  if (s) return snapshot(s)
  const r = db.get<RunRow>('SELECT * FROM runs WHERE id = ?', id)
  if (!r) throw notFound('Run')
  return mapRun(r)
}

export function listRuns(f: { flowId?: string; brandId?: string; postId?: string; status?: string; limit?: number } = {}): FlowRun[] {
  const where: string[] = []
  const vals: (string | number)[] = []
  if (f.flowId) { where.push('flow_id = ?'); vals.push(f.flowId) }
  if (f.brandId) { where.push('brand_id = ?'); vals.push(f.brandId) }
  if (f.postId) { where.push('post_id = ?'); vals.push(f.postId) }
  if (f.status) { where.push('status = ?'); vals.push(f.status) }
  const rows = db.all<RunRow>(`SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC, id DESC LIMIT ?`, ...vals, Math.min(Math.max(f.limit ?? 100, 1), 1000))
  return rows.map((r) => {
    const s = states.get(r.id)
    return s ? snapshot(s) : mapRun(r)
  })
}

/** On app start: runs left `running` by a previous session can never finish. */
export function failStaleRuns(): number {
  const live = new Set(states.keys())
  const stale = db.all<{ id: string; log: string }>("SELECT id, log FROM runs WHERE status = 'running'").filter((r) => !live.has(r.id))
  const at = nowIso()
  for (const r of stale) {
    const log = pj<RunLogEntry[]>(r.log, [])
    log.push({ at, level: 'error', msg: 'Cubby closed while this was running' })
    db.run("UPDATE runs SET status = 'failed', ended_at = ?, error = ?, log = ? WHERE id = ?", at, 'Cubby closed while this was running', j(log), r.id)
  }
  return stale.length
}

export function flushAll(): void {
  for (const s of states.values()) flush(s)
}
