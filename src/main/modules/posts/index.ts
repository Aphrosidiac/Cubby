// Composer + approvals + queue (PLAN §6.4–6.6, §10): posts CRUD, fit checks, prepare (posting recipe
// in mode 'prepare' → screenshots → ready_for_approval + notify), approve/reject, run (publish via
// the recipe per account, pacing re-checked per account, results + ledger), slots + next free slot,
// reschedule. Status rules live in ./state.ts; nothing here moves a post except through move().
// Implements commands: posts.*, slots.*
import type { Parsed } from '@shared/contract'
import { PLATFORM_SPECS, platformName } from '@shared/platforms'
import type { Account, Actor, Brand, FlowRun, MediaAsset, PacingCheck, Platform, Post, PostKind, PostResult, PostScreen } from '@shared/types'
import { logActivity } from '../../core/activity'
import { db } from '../../core/db'
import { GuardrailError, UserError } from '../../core/errors'
import { emit } from '../../core/events'
import { newId, nowIso } from '../../core/ids'
import { notify } from '../../core/notify'
import { implement } from '../../core/registry'
import { requestStatus, runtime } from '../../core/runtime'
import { getSettings } from '../../core/settings'
import { listAccounts } from '../accounts/repo'
import { getBrand } from '../brands/repo'
import { getAssets } from '../media'
import { checkPacing, recordPost } from '../pacing'
import { postingRecipeFor, type PostingParams, type RecipeResult } from '../recipes'
import { abortRun, startRun } from '../runs'
import { parseHhmm, safeTz, slotTimes } from '../scheduler/time'
import { captionFor, captionProblems, fitPost } from './fit'
import { casStatus, deletePostRow, findPost, getPost, insertPost, listPosts, listSlots, replaceSlots, savePost } from './repo'
import { pickSlot } from './slots'
import { ACTIVE, afterPrepare, canDo, DUE, initialStatus, nextStatus, runOutcome, transitionError, type PostEvent, type RunTally } from './state'

export { getPost, listPosts } from './repo'

const KIND_NAME: Record<PostKind, string> = { reel: 'reel', video: 'video', image: 'image post', carousel: 'carousel', text: 'text post', story: 'story' }
const KILL_MSG = 'Cubby is stopped (kill switch is on). Turn it off in the app to continue.'

/** posts with a prepare or publish in flight (in this process) */
const busy = new Set<string>()
/** post id → the run currently working on it (for cancel) */
const liveRun = new Map<string, string>()

/** Outcome rows in Activity (the registry only records that a command ran). */
function logOutcome(actor: Actor, p: Post, extra: Record<string, unknown> = {}): void {
  logActivity({ actor, brandId: p.brandId, action: `posts.${p.status === 'ready_for_approval' ? 'ready' : p.status}`, detail: { postId: p.id, kind: p.kind, error: p.error ?? undefined, ...extra } })
}

function changed(id?: string): void {
  emit('posts.changed', { id })
  requestStatus()
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function toIso(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new UserError(`"${s}" is not a valid date and time`)
  return d.toISOString()
}

function fmtLocal(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: safeTz(getSettings().timezone), dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

const who = (a: Account): string => `${platformName(a.platform)} @${a.handle.replace(/^@/, '')}`

/** Move a post along the status table (compare-and-set) and announce it. */
function move(p: Post, ev: PostEvent, patch: Partial<Post> = {}): Post {
  const to = nextStatus(p.status, ev)
  if (!to) throw new UserError(transitionError(p.status, ev), 'conflict')
  const out = casStatus(p.id, p.status, { ...patch, status: to })
  if (!out) throw new UserError('This post changed in the meantime — reload and try again', 'conflict')
  changed(p.id)
  return out
}

// ── validation ────────────────────────────────────────────────────────────────
interface Content {
  brandId: string
  accountIds: string[]
  kind: PostKind
  assetIds: string[]
  caption: string
  perPlatform: Post['perPlatform']
}

interface Checked {
  brand: Brand
  accounts: Account[]
  /** in the post's asset order */
  assets: MediaAsset[]
}

/** Accounts belong to the brand, platforms support the kind, files exist, captions fit. */
/** strictCaption=false (drafts) lets an over-limit caption be saved; it is enforced once the post is submitted. */
function validateContent(c: Content, opts: { needMedia: boolean; strictCaption?: boolean }): Checked {
  const brand = getBrand(c.brandId)
  if (brand.deletedAt) throw new UserError(`${brand.name} is in the recycle bin — restore it first`)
  if (!c.accountIds.length) throw new UserError('Pick at least one account')
  const own = new Map(listAccounts(brand.id).map((a) => [a.id, a]))
  const accounts: Account[] = []
  for (const id of [...new Set(c.accountIds)]) {
    const a = own.get(id)
    if (!a) throw new UserError(`An account on this post doesn't belong to ${brand.name} (was it removed?)`)
    if (!PLATFORM_SPECS[a.platform].kinds.includes(c.kind)) throw new UserError(`${platformName(a.platform)} doesn't support ${KIND_NAME[c.kind]}s`)
    accounts.push(a)
  }
  const found = new Map(getAssets(c.assetIds).map((m) => [m.id, m]))
  const missing = c.assetIds.filter((id) => !found.has(id))
  if (missing.length) throw new UserError(`${missing.length} media file${missing.length === 1 ? ' is' : 's are'} not in the library`)
  const assets = c.assetIds.map((id) => found.get(id)!)
  if (opts.needMedia && c.kind !== 'text') {
    if (c.kind === 'carousel' ? assets.length < 2 : assets.length < 1) throw new UserError(c.kind === 'carousel' ? 'A carousel needs at least 2 files' : `Attach ${c.kind === 'image' ? 'an image' : 'a video'} first`)
    const gone = assets.find((m) => m.missing)
    if (gone) throw new UserError(`${gone.filename} is missing on disk — put it back or rescan the media library`)
  }
  const problems: string[] = []
  for (const p of new Set(accounts.map((a) => a.platform))) for (const x of captionProblems(p, captionFor(c.caption, c.perPlatform, p))) problems.push(`${platformName(p)}: ${x}`)
  if (problems.length && opts.strictCaption !== false) throw new UserError(problems.join('; '))
  return { brand, accounts, assets }
}

// ── recipes ───────────────────────────────────────────────────────────────────
type RecipeOutcome = { kind: 'ok'; result: RecipeResult | undefined; run: FlowRun } | { kind: 'failed' | 'needs_human'; message: string; run: FlowRun | null }

function classify(e: unknown, run: FlowRun | null, label: string): RecipeOutcome {
  const message = `${label}: ${errMsg(e ?? run?.error ?? 'the run did not finish')}`
  const human = (e instanceof GuardrailError && e.rule !== 'kill_switch') || run?.status === 'needs_human'
  return { kind: human ? 'needs_human' : 'failed', message, run }
}

/** One posting recipe for one account, as a run in the brand's window. Never throws. */
async function runRecipe(p: Post, acc: Account, assets: MediaAsset[], mode: PostingParams['mode'], actor: Actor): Promise<RecipeOutcome> {
  const name = platformName(acc.platform)
  const label = who(acc)
  const recipe = postingRecipeFor(acc.platform, p.kind)
  if (!recipe) return { kind: 'failed', message: `${label}: no recipe for ${name} ${KIND_NAME[p.kind]}s yet — post it by hand`, run: null }
  const params: PostingParams = { post: p, account: acc, assets, mode }
  try {
    const r = await startRun<RecipeResult>(
      { brandId: p.brandId, actor, label: `${mode === 'prepare' ? 'Prepare' : 'Post'} ${name} ${p.kind}`, recipe: recipe.info.id, postId: p.id },
      (rt) => {
        liveRun.set(p.id, rt.runId)
        return recipe.run(rt, params as unknown as Record<string, unknown>)
      }
    )
    if (r.error != null || r.run.status !== 'ok') return classify(r.error, r.run, label)
    return { kind: 'ok', result: r.result, run: r.run }
  } catch (e) {
    return classify(e, null, label)
  }
}

// ── prepare ───────────────────────────────────────────────────────────────────
/**
 * Run each account's recipe up to the final button and keep the screenshots. Pre-flight problems
 * (status, content) throw; anything after the post is marked running ends as failed / needs_human.
 */
export async function preparePost(id: string, actor: Actor): Promise<Post> {
  let p = getPost(id)
  if (busy.has(id)) throw new UserError('This post is already being prepared or posted')
  if (!canDo(p.status, 'prepare')) throw new UserError(transitionError(p.status, 'prepare'), 'conflict')
  if (runtime.killSwitch && actor !== 'you') throw new GuardrailError(KILL_MSG, 'kill_switch')
  const { brand, accounts, assets } = validateContent(p, { needMedia: true })
  const origin = p.status
  // synchronous up to here: callers that don't await (create) already see status "running"
  p = move(p, 'prepare', { approval: null, screens: [], error: null })
  busy.add(id)
  const screens: PostScreen[] = []
  let failure: RecipeOutcome | null = null
  try {
    for (const acc of accounts) {
      if (findPost(id)?.status !== 'running') break
      const out = await runRecipe(p, acc, assets, 'prepare', actor)
      if (out.kind !== 'ok') {
        failure = out
        break
      }
      const shot = out.result?.screen ?? out.run.screens[out.run.screens.length - 1] ?? null
      if (shot) screens.push({ accountId: acc.id, path: shot, at: nowIso() })
      savePost(id, { screens })
      changed(id)
    }
  } catch (e) {
    failure = classify(e, null, 'Prepare')
  } finally {
    busy.delete(id)
    liveRun.delete(id)
  }

  const cur = getPost(id)
  if (cur.status !== 'running') return cur // cancelled meanwhile
  if (failure && failure.kind !== 'ok') {
    const human = failure.kind === 'needs_human'
    const out = move(cur, human ? 'needs_human' : 'fail', { error: failure.message })
    logOutcome(actor, out, { phase: 'prepare', runId: failure.run?.id })
    notify({ title: `${brand.name}: ${human ? 'prepare needs you' : 'prepare failed'}`, body: failure.message, path: failure.run ? `/runs/${failure.run.id}` : '/calendar', urgent: human })
    return out
  }
  const ev = afterPrepare(origin, brand.approvalRequired)
  const out = move(cur, ev, { screens })
  logOutcome(actor, out, { phase: 'prepare', screens: screens.length })
  if (ev === 'prepared') notify({ title: `${brand.name}: post ready to approve`, body: `${accounts.map(who).join(', ')} · ${KIND_NAME[p.kind]}`, path: '/approvals' })
  return out
}

/** Fire-and-forget prepare (create with approval). Failures before it starts stay on the draft. */
function prepareInBackground(id: string, actor: Actor): void {
  preparePost(id, actor).catch((e) => {
    const p = findPost(id)
    if (p && p.status !== 'running') {
      savePost(id, { error: `Couldn't prepare: ${errMsg(e)}` })
      changed(id)
    }
  })
}

// ── run (publish) ─────────────────────────────────────────────────────────────
/**
 * Publish to every target account that hasn't been posted yet. Per account: pacing first (a refusal
 * re-paces: the post keeps waiting with scheduledAt = nextAllowedAt), then the recipe in 'publish'.
 */
export async function runPost(id: string, actor: Actor): Promise<Post> {
  let p = getPost(id)
  if (busy.has(id)) throw new UserError('This post is already being prepared or posted')
  if (!canDo(p.status, 'run')) throw new UserError(transitionError(p.status, 'run'), 'conflict')
  if (runtime.killSwitch && actor !== 'you') throw new GuardrailError(KILL_MSG, 'kill_switch')
  const brand = getBrand(p.brandId)
  if (brand.deletedAt) throw new UserError(`${brand.name} is in the recycle bin — restore it first`)
  if (brand.approvalRequired && (!p.approval || p.status === 'draft')) {
    // the brand started requiring approval after this was queued: send it back instead of failing every tick
    if (p.status === 'queued') return move(p, 'unapprove', { error: `${brand.name} requires approval — prepare and approve this post first` })
    throw new UserError(`${brand.name} requires approval — approve this post first`)
  }

  let checked: Checked
  try {
    checked = validateContent(p, { needMedia: true })
  } catch (e) {
    if (!(e instanceof UserError)) throw e
    // recorded on the post, not thrown, so the scheduler doesn't retry a broken post every tick
    p = move(p, 'run', { error: null })
    const out = move(p, 'fail', { error: e.message })
    logOutcome(actor, out)
    notify({ title: `${brand.name}: post failed`, body: e.message, path: '/calendar' })
    return out
  }
  const { accounts, assets } = checked
  const targetIds = brand.approvalRequired ? p.approval!.accountIds.filter((a) => p.accountIds.includes(a)) : p.accountIds
  const done = new Set(p.results.filter((r) => r.error === null).map((r) => r.accountId))
  const pending = accounts.filter((a) => targetIds.includes(a.id) && !done.has(a.id))

  p = move(p, 'run', { error: null })
  busy.add(id)
  const tally: RunTally = { targets: pending.length, posted: 0, failed: 0, needsHuman: 0, repaced: 0, alreadyPosted: targetIds.filter((a) => done.has(a)).length }
  const repaced: { acc: Account; check: PacingCheck }[] = []
  const errors: string[] = []
  const urls: string[] = []
  let lastRun: string | null = null
  const setResult = (r: PostResult) => {
    const cur = getPost(id)
    savePost(id, { results: [...cur.results.filter((x) => x.accountId !== r.accountId), r] })
    changed(id)
  }
  try {
    for (const acc of pending) {
      if (runtime.killSwitch && actor !== 'you') break
      if (findPost(id)?.status !== 'running') break
      const check = checkPacing(acc.id)
      if (!check.ok) {
        tally.repaced++
        repaced.push({ acc, check })
        logActivity({ actor, brandId: brand.id, action: 'posts.repaced', detail: { postId: id, accountId: acc.id, platform: acc.platform, nextAllowedAt: check.nextAllowedAt, reason: check.reason } })
        continue
      }
      const out = await runRecipe(p, acc, assets, 'publish', actor)
      if (out.run) lastRun = out.run.id
      if (out.kind === 'ok') {
        tally.posted++
        recordPost(acc.id, acc.platform, id)
        if (out.result?.url) urls.push(out.result.url)
        setResult({ accountId: acc.id, url: out.result?.url ?? null, error: null, at: nowIso() })
      } else {
        errors.push(out.message)
        setResult({ accountId: acc.id, url: null, error: out.message, at: nowIso() })
        if (out.kind === 'needs_human') {
          tally.needsHuman++
          break // the brand window needs a person; don't keep driving it
        }
        tally.failed++
      }
    }
  } catch (e) {
    tally.failed++
    errors.push(errMsg(e))
  } finally {
    busy.delete(id)
    liveRun.delete(id)
  }

  const cur = getPost(id)
  if (cur.status !== 'running') return cur // cancelled meanwhile
  const ev = runOutcome(tally, brand.approvalRequired)
  let out: Post
  if (ev === 'wait_approved' || ev === 'wait_queued') {
    const next = repaced.map((r) => r.check.nextAllowedAt).filter((x): x is string => !!x).sort()[0] ?? null
    const why = repaced.length
      ? repaced.map((r) => `${who(r.acc)} re-paced to ${fmtLocal(r.check.nextAllowedAt ?? nowIso())} — ${r.check.reason}`).join(' · ')
      : 'Stopped by the kill switch — it continues when the kill switch is off'
    out = move(cur, ev, { scheduledAt: next ?? cur.scheduledAt, error: why })
  } else if (ev === 'posted') {
    out = move(cur, ev, { error: null })
    logOutcome(actor, out, { urls })
    notify({ title: `${brand.name}: posted`, body: `${accounts.filter((a) => targetIds.includes(a.id)).map(who).join(', ')}${urls.length ? '\n' + urls.join('\n') : ''}`, path: lastRun ? `/runs/${lastRun}` : '/calendar' })
  } else {
    const human = ev === 'needs_human'
    out = move(cur, ev, { error: errors.join(' · ') || 'The post did not finish' })
    logOutcome(actor, out, { runId: lastRun })
    notify({ title: `${brand.name}: ${human ? 'post needs you' : 'post failed'}`, body: out.error ?? '', path: lastRun ? `/runs/${lastRun}` : '/calendar', urgent: human })
  }
  return out
}

/** Scheduler: a post that came due while the machine slept and Settings.catchUp is 'skip'. */
export function markMissed(id: string): Post | null {
  const p = findPost(id)
  if (!p || !canDo(p.status, 'miss') || busy.has(id)) return null
  const out = move(p, 'miss', { error: 'Missed while the computer was asleep (catch-up is set to skip)' })
  logActivity({ actor: 'scheduler', brandId: p.brandId, action: 'posts.missed', detail: { postId: id, scheduledAt: p.scheduledAt } })
  const brand = getBrand(p.brandId)
  notify({ title: `${brand.name}: post missed`, body: `Scheduled for ${p.scheduledAt ? fmtLocal(p.scheduledAt) : 'earlier'} — skipped because the computer was asleep`, path: '/calendar' })
  return out
}

export const isPostBusy = (id: string): boolean => busy.has(id)

// ── slots ─────────────────────────────────────────────────────────────────────
/** Other active scheduled posts per account (hypothetical ledger entries for slot/pacing checks). */
function plannedByAccount(brandId: string, excludeId?: string): Map<string, Date[]> {
  const out = new Map<string, Date[]>()
  for (const p of listPosts({ brandId, status: [...ACTIVE], limit: 5000 })) {
    if (p.id === excludeId || !p.scheduledAt) continue
    for (const a of p.approval?.accountIds ?? p.accountIds) out.set(a, [...(out.get(a) ?? []), new Date(p.scheduledAt)])
  }
  return out
}

/**
 * Earliest future slot (Settings.timezone) not within ±30 min of another active post of the brand
 * and allowed by pacing for the accounts (default: all the brand's accounts). 60 days ahead.
 */
export function nextSlotFor(brandId: string, accountIds?: string[], excludeId?: string): string | null {
  const slots = listSlots(brandId)
  if (!slots.length) return null
  const tz = safeTz(getSettings().timezone)
  const candidates = slotTimes(slots, new Date(), tz, 60)
  const taken = listPosts({ brandId, status: [...ACTIVE], limit: 5000 })
    .filter((p) => p.id !== excludeId && p.scheduledAt)
    .map((p) => new Date(p.scheduledAt!))
  const accs = accountIds?.length ? accountIds : listAccounts(brandId).map((a) => a.id)
  const planned = plannedByAccount(brandId, excludeId)
  const t = pickSlot(candidates, taken, (at) => accs.every((a) => checkPacing(a, at, planned.get(a) ?? []).ok))
  return t ? t.toISOString() : null
}

// ── commands ──────────────────────────────────────────────────────────────────
/** When a post in this mode should go out. */
function resolveSchedule(mode: 'draft' | 'schedule' | 'queue' | 'now', brand: { id: string; name: string }, accountIds: string[], requested: string | null | undefined, excludeId?: string): string | null {
  let scheduledAt = requested ? toIso(requested) : null
  if (mode === 'schedule') {
    if (!scheduledAt) throw new UserError('Pick a date and time to schedule this post')
    if (new Date(scheduledAt).getTime() <= Date.now()) throw new UserError('Pick a time in the future')
  } else if (mode === 'queue') {
    scheduledAt = nextSlotFor(brand.id, accountIds, excludeId)
    if (!scheduledAt) throw new UserError(listSlots(brand.id).length ? 'No free posting slot in the next 60 days — add slots or pick a time' : `${brand.name} has no posting slots yet — add some in Calendar, or schedule a time`)
  } else if (mode === 'now') {
    scheduledAt = nowIso()
  }
  return scheduledAt
}

async function createPost(i: Parsed<'posts.create'>, actor: Actor): Promise<Post> {
  const { brand } = validateContent(i, { needMedia: i.mode !== 'draft', strictCaption: i.mode !== 'draft' })
  const scheduledAt = resolveSchedule(i.mode, brand, i.accountIds, i.scheduledAt)
  const init = initialStatus(i.mode, brand.approvalRequired)
  const at = nowIso()
  const post: Post = {
    id: newId('post_'),
    brandId: brand.id,
    accountIds: [...new Set(i.accountIds)],
    kind: i.kind,
    assetIds: i.assetIds,
    caption: i.caption,
    perPlatform: i.perPlatform,
    scheduledAt,
    status: init.status,
    approval: null,
    screens: [],
    results: [],
    error: null,
    createdAt: at,
    updatedAt: at
  }
  insertPost(post)
  changed(post.id)
  if (init.prepare) prepareInBackground(post.id, actor)
  return getPost(post.id)
}

implement({
  'posts.list': (f) => listPosts(f),
  'posts.get': ({ id }) => getPost(id),
  'posts.create': (i, ctx) => createPost(i, ctx.actor),

  'posts.update': ({ id, patch }) => {
    const p = getPost(id)
    if (busy.has(id) || p.status === 'running') throw new UserError('This post is running — wait for it to finish or cancel it first', 'conflict')
    let scheduledAt = p.scheduledAt
    if (patch.scheduledAt !== undefined) {
      scheduledAt = patch.scheduledAt ? toIso(patch.scheduledAt) : null
      if (scheduledAt && scheduledAt !== p.scheduledAt && new Date(scheduledAt).getTime() < Date.now() - 60_000) throw new UserError('Pick a time in the future')
    }
    const next: Content = {
      brandId: p.brandId,
      accountIds: patch.accountIds ? [...new Set(patch.accountIds)] : p.accountIds,
      kind: patch.kind ?? p.kind,
      assetIds: patch.assetIds ?? p.assetIds,
      caption: patch.caption ?? p.caption,
      perPlatform: patch.perPlatform ?? p.perPlatform
    }
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    const contentChanged = !same(next.accountIds, p.accountIds) || next.kind !== p.kind || !same(next.assetIds, p.assetIds) || next.caption !== p.caption || !same(next.perPlatform, p.perPlatform)
    if (!contentChanged) {
      // only the time moved: same as reschedule (approval kept)
      if (scheduledAt === p.scheduledAt) return p
      if (!canDo(p.status, 'reschedule')) throw new UserError(transitionError(p.status, 'reschedule'), 'conflict')
      return move(p, 'reschedule', { scheduledAt })
    }
    if (!canDo(p.status, 'edit')) throw new UserError(transitionError(p.status, 'edit'), 'conflict')
    const willRun = nextStatus(p.status, 'edit') === 'queued'
    validateContent(next, { needMedia: willRun, strictCaption: willRun || p.status !== 'draft' })
    // a changed post must be prepared + approved again: approval and screenshots are dropped
    return move(p, 'edit', { ...next, scheduledAt, approval: null, screens: [], error: null })
  },

  'posts.submit': ({ id, mode, scheduledAt }, ctx) => {
    const p = getPost(id)
    if (p.status !== 'draft') throw new UserError('Only drafts can be submitted — this post is already on its way', 'conflict')
    const { brand } = validateContent(p, { needMedia: true, strictCaption: true })
    const at = resolveSchedule(mode, brand, p.accountIds, scheduledAt, p.id)
    if (brand.approvalRequired) {
      // prepared in the brand window first; lands in Approvals (draft --prepare--> ready_for_approval)
      const saved = savePost(p.id, { scheduledAt: at, error: null })
      changed(saved.id)
      prepareInBackground(saved.id, ctx.actor)
      return getPost(saved.id)
    }
    return move(p, 'queue', { scheduledAt: at, error: null })
  },

  'posts.delete': ({ id }) => {
    const p = getPost(id)
    if (busy.has(id) || p.status === 'running') throw new UserError('This post is running — cancel it first', 'conflict')
    deletePostRow(id)
    changed(id)
  },

  'posts.fit': ({ brandId, kind, assetIds, accountIds, caption, perPlatform }) => {
    const own = new Map(listAccounts(brandId).map((a) => [a.id, a]))
    const accounts = accountIds.map((id) => {
      const a = own.get(id)
      if (!a) throw new UserError("An account doesn't belong to this brand")
      return { id: a.id, platform: a.platform, handle: a.handle }
    })
    return fitPost({ kind, accounts, assetIds, assets: getAssets(assetIds), caption, perPlatform, hasRecipe: (pl: Platform, k: PostKind) => !!postingRecipeFor(pl, k) })
  },

  'posts.prepare': ({ id }, ctx) => preparePost(id, ctx.actor),

  'posts.approve': ({ id, accountIds }, ctx) => {
    const p = getPost(id)
    const ids = accountIds?.length ? [...new Set(accountIds)] : p.accountIds
    if (ids.some((a) => !p.accountIds.includes(a))) throw new UserError('You can only approve accounts that are on this post')
    return move(p, 'approve', { approval: { by: ctx.actor, at: nowIso(), accountIds: ids }, error: null })
  },

  'posts.reject': ({ id, reason }) => {
    const p = getPost(id)
    return move(p, 'reject', { approval: null, error: reason?.trim() ? `Rejected: ${reason.trim()}` : 'Rejected' })
  },

  'posts.run': ({ id }, ctx) => runPost(id, ctx.actor),

  'posts.cancel': ({ id }) => {
    const p = getPost(id)
    const run = liveRun.get(id)
    const out = move(p, 'cancel')
    if (run) abortRun(run)
    return out
  },

  'posts.reschedule': ({ id, scheduledAt }) => {
    const p = getPost(id)
    const t = toIso(scheduledAt)
    if (new Date(t).getTime() <= Date.now()) throw new UserError('Pick a time in the future')
    if (!canDo(p.status, 'reschedule')) throw new UserError(transitionError(p.status, 'reschedule'), 'conflict')
    const own = new Map(listAccounts(p.brandId).map((a) => [a.id, a]))
    const planned = plannedByAccount(p.brandId, p.id)
    const warnings: string[] = []
    for (const accId of p.approval?.accountIds ?? p.accountIds) {
      const acc = own.get(accId)
      if (!acc) continue
      const c = checkPacing(acc.id, new Date(t), planned.get(acc.id) ?? [])
      if (!c.ok) warnings.push(`${who(acc)} will be re-paced to about ${fmtLocal(c.nextAllowedAt!)} — ${c.reason}`)
    }
    const error = warnings.length ? `Heads up: ${warnings.join(' · ')}` : DUE.includes(p.status) ? null : p.error
    return move(p, 'reschedule', { scheduledAt: t, error })
  },

  'posts.nextSlot': ({ brandId }) => {
    getBrand(brandId)
    return nextSlotFor(brandId)
  },

  'slots.list': ({ brandId }) => listSlots(brandId),

  'slots.set': ({ brandId, slots }) => {
    getBrand(brandId)
    const clean = slots.map((s) => {
      if (parseHhmm(s.time) == null) throw new UserError(`${s.time} is not a valid time (use HH:mm, 00:00–23:59)`)
      return { id: newId('slot_'), weekdays: [...new Set(s.weekdays)].sort(), time: s.time }
    })
    replaceSlots(brandId, clean)
    changed()
    return listSlots(brandId)
  }
})

/** Posts left "running" by a crash or quit: preparing → failed; publishing → needs_human (may be live). */
function recoverInterrupted(): void {
  for (const p of listPosts({ status: ['running'] })) {
    const run = db.get<{ label: string }>('SELECT label FROM runs WHERE post_id = ? ORDER BY started_at DESC LIMIT 1', p.id)
    const publishing = !!run && run.label.startsWith('Post ')
    savePost(
      p.id,
      publishing
        ? { status: 'needs_human', error: 'Cubby closed while this post was publishing — check the accounts before running it again (accounts already posted are skipped)' }
        : { status: 'failed', error: 'Cubby closed before this post finished — prepare or run it again' }
    )
    changed(p.id)
  }
}

export function start(): void {
  recoverInterrupted()
}
export async function stop(): Promise<void> {
  for (const run of liveRun.values()) abortRun(run)
}
