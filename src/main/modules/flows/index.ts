// Flows (PLAN §6.8): CRUD, the step-list engine on the run manager, the recorder, schedules via croner
// (next_run_at in Settings.timezone), the recipe list, and runs list/get/abort.
// Implements commands: flows.*, runs.*
import type { Flow, FlowRun, FlowStep, Actor } from '@shared/types'
import { PLATFORM_SPECS } from '@shared/platforms'
import { logActivity } from '../../core/activity'
import { db } from '../../core/db'
import { GuardrailError, UserError, notFound } from '../../core/errors'
import { emit, on } from '../../core/events'
import { newId } from '../../core/ids'
import { notify } from '../../core/notify'
import { paths } from '../../core/paths'
import { implement, type Ctx } from '../../core/registry'
import { getSettings } from '../../core/settings'
import { listAccounts } from '../accounts/repo'
import { findBrand } from '../brands/repo'
import { closeBrand, openBrand } from '../browser'
import { getRecipe, RECIPES } from '../recipes'
import { abortRun, enqueueRun, getRun, listRuns } from '../runs'
import { askClaude } from './claude-cli'
import { runSteps, type EngineDeps } from './engine'
import { recordStart, recordStop, stopAllRecordings } from './recorder'
import { dueFlows, getFlow, insertFlow, listFlows, mediaFor, saveFlow, setNextRun, type FlowFields } from './repo'
import { checkCron, nextRunAt, validateSteps } from './steps'

const changed = () => emit('flows.changed', {})

function tz(): string {
  return getSettings().timezone || 'Asia/Kuala_Lumpur'
}

function normSchedule(s: string | null | undefined): string | null {
  const v = (s ?? '').trim()
  return v ? v : null
}

function validCron(expr: string | null): void {
  if (!expr) return
  try {
    checkCron(expr, tz())
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e))
  }
}

function computeNext(schedule: string | null, enabled: boolean, from = new Date()): string | null {
  if (!schedule || !enabled) return null
  try {
    return nextRunAt(schedule, tz(), from)
  } catch {
    return null
  }
}

/** Fresh ids for every step (duplicating a flow, pasting steps). */
function reId(steps: FlowStep[]): FlowStep[] {
  return steps.map((s) => {
    const c = { ...s, id: newId('st_') } as FlowStep
    if (c.type === 'if_exists') {
      c.then = reId(c.then)
      if (c.else) c.else = reId(c.else)
    }
    if (c.type === 'loop_media') c.steps = reId(c.steps)
    return c
  })
}

// ── engine wiring ────────────────────────────────────────────────────────────
function brandContext(brandId: string): string {
  const b = findBrand(brandId)
  const accs = listAccounts(brandId)
    .map((a) => `${PLATFORM_SPECS[a.platform]?.name ?? a.platform} @${a.handle.replace(/^@/, '')}`)
    .join(', ')
  return `You are helping with the brand "${b?.name ?? brandId}" in Cubby (a desktop app that runs each brand's social accounts in its own Chrome).${accs ? ` Its accounts: ${accs}.` : ''}${b?.notes ? ` Notes about the brand: ${b.notes}` : ''}\nReply with just the answer text — no preamble.\n\n`
}

function engineDeps(brandId: string): EngineDeps {
  return {
    openBrand: (id) => openBrand(id, { actor: 'flow' }),
    closeBrand: (id) => closeBrand(id),
    notify: (n) => notify(n),
    media: (sel) => mediaFor(sel),
    runRecipe: async (rt, id, params) => {
      const r = getRecipe(id)
      if (!r) throw new UserError(`Unknown recipe "${id}"`)
      return r.run(rt, params)
    },
    askClaude: (prompt, signal) => askClaude(brandContext(brandId) + prompt, { signal, cwd: paths.tmp })
  }
}

function assertRunnable(flow: Flow): void {
  if (!flow.steps.length) throw new UserError(`"${flow.name}" has no steps yet`)
  const issues = validateSteps(flow.steps, (id) => !!getRecipe(id))
  if (issues.length) throw new UserError(`"${flow.name}" can't run yet — ${issues.slice(0, 6).map((i) => `step ${i.where}: ${i.message}`).join('; ')}${issues.length > 6 ? ` (+${issues.length - 6} more)` : ''}`)
}

/** Which brands a run of this flow covers. */
function resolveBrands(flow: Flow, input?: string[]): string[] {
  const given = (input ?? []).filter(Boolean)
  let ids: string[]
  if (flow.brandScope === 'one') ids = flow.brandIds.length ? [flow.brandIds[0]] : given.slice(0, 1)
  else if (flow.brandScope === 'many') ids = given.length ? given : flow.brandIds
  else ids = given.length ? given : flow.brandIds
  ids = [...new Set(ids)]
  if (!ids.length) throw new UserError(flow.brandScope === 'any' ? `Pick the brands to run "${flow.name}" on` : `"${flow.name}" has no brand — pick one in the flow settings`)
  for (const id of ids) {
    const b = findBrand(id)
    if (!b) throw notFound('Brand')
    if (b.deletedAt) throw new UserError(`${b.name} is in the recycle bin`)
  }
  return ids
}

function runActor(actor: Actor): Actor {
  return actor === 'scheduler' ? 'flow' : actor
}

function startFlowRuns(flow: Flow, brandIds: string[], actor: Actor): FlowRun[] {
  return brandIds.map((brandId) => {
    const brandName = findBrand(brandId)?.name ?? brandId
    const { run } = enqueueRun({ brandId, actor, label: flow.name, flowId: flow.id }, (rt) =>
      runSteps(rt, flow.steps, { vars: { 'brand.name': brandName, 'brand.id': brandId, 'flow.name': flow.name }, flowName: flow.name, brandName }, engineDeps(brandId))
    )
    return run
  })
}

function checkCtxBrands(ctx: Ctx, brandIds: string[]): void {
  for (const id of brandIds) {
    if (ctx.tokenBrandIds && !ctx.tokenBrandIds.includes(id)) throw new UserError('token is not allowed to use this brand', 'forbidden')
    if (ctx.brandLock && ctx.brandLock !== id) throw new GuardrailError('this session is locked to another brand — call brand_open/brand_switch for this brand first', 'brand_lock')
  }
}

// ── commands ─────────────────────────────────────────────────────────────────
implement({
  'flows.list': () => listFlows(),
  'flows.get': ({ id }) => getFlow(id),

  'flows.create': (i) => {
    const schedule = normSchedule(i.schedule)
    validCron(schedule)
    const name = i.name.trim()
    if (!name) throw new UserError('Flow name is required')
    const f = insertFlow({ name, brandScope: i.brandScope, brandIds: i.brandIds, steps: i.steps, schedule, enabled: i.enabled, nextRunAt: computeNext(schedule, i.enabled) })
    changed()
    return f
  },

  'flows.update': ({ id, patch }) => {
    const cur = getFlow(id)
    const schedule = patch.schedule !== undefined ? normSchedule(patch.schedule) : cur.schedule
    if (patch.schedule !== undefined) validCron(schedule)
    const name = patch.name !== undefined ? patch.name.trim() : cur.name
    if (!name) throw new UserError('Flow name is required')
    const enabled = patch.enabled ?? cur.enabled
    const scheduleChanged = schedule !== cur.schedule || enabled !== cur.enabled
    const next: FlowFields = {
      name,
      brandScope: patch.brandScope ?? cur.brandScope,
      brandIds: patch.brandIds ?? cur.brandIds,
      steps: patch.steps ?? cur.steps,
      schedule,
      enabled,
      nextRunAt: scheduleChanged || !cur.nextRunAt ? computeNext(schedule, enabled) : cur.nextRunAt
    }
    const f = saveFlow(id, next)
    changed()
    return f
  },

  'flows.delete': ({ id }) => {
    getFlow(id)
    db.run('DELETE FROM flows WHERE id = ?', id)
    changed()
  },

  'flows.duplicate': ({ id }) => {
    const cur = getFlow(id)
    const f = insertFlow({ name: `${cur.name} copy`, brandScope: cur.brandScope, brandIds: cur.brandIds, steps: reId(cur.steps), schedule: cur.schedule, enabled: false, nextRunAt: null })
    changed()
    return f
  },

  'flows.run': ({ id, brandIds }, ctx) => {
    const flow = getFlow(id)
    assertRunnable(flow)
    const ids = resolveBrands(flow, brandIds)
    checkCtxBrands(ctx, ids)
    return startFlowRuns(flow, ids, runActor(ctx.actor))
  },

  'flows.recipes': () => RECIPES.map((r) => r.info),

  'flows.runRecipe': ({ recipe, brandId, params }, ctx) => {
    const r = getRecipe(recipe)
    if (!r) throw new UserError(`Unknown recipe "${recipe}"`)
    if (!findBrand(brandId)) throw notFound('Brand')
    const { run } = enqueueRun({ brandId, actor: runActor(ctx.actor), label: r.info.name, recipe: r.info.id }, (rt) => r.run(rt, params))
    return run
  },

  'flows.recordStart': async ({ brandId }) => ({ recordingId: await recordStart(brandId) }),
  'flows.recordStop': ({ recordingId }) => recordStop(recordingId),

  'runs.list': (f) => listRuns(f),
  'runs.get': ({ id }) => getRun(id),
  'runs.abort': ({ id }, ctx) => {
    const run = getRun(id)
    checkCtxBrands({ ...ctx, brandLock: null }, [run.brandId])
    if (run.status !== 'running') return
    abortRun(id, ctx.actor === 'you' ? 'Stopped by you' : `Stopped by ${ctx.tokenName ?? ctx.actor}`)
  }
})

// ── schedules ────────────────────────────────────────────────────────────────
/** Start every enabled flow whose next_run_at <= now (called by the scheduler tick). */
export async function runDueFlows(now: Date = new Date()): Promise<void> {
  for (const flow of dueFlows(now)) {
    // advance first: a failing flow must not fire again every tick
    setNextRun(flow.id, computeNext(flow.schedule, flow.enabled, now))
    try {
      assertRunnable(flow)
      const ids = resolveBrands(flow)
      const runs = startFlowRuns(flow, ids, 'flow')
      logActivity({ actor: 'scheduler', action: 'flow.scheduled_run', detail: { flowId: flow.id, name: flow.name, runs: runs.map((r) => r.id) } })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logActivity({ actor: 'scheduler', action: 'flow.scheduled_run.failed', detail: { flowId: flow.id, name: flow.name, error: msg } })
      notify({ title: `Flow "${flow.name}" did not run`, body: msg, path: '/flows' })
    }
  }
  changed()
}

/** Recompute next_run_at for every scheduled flow (start, timezone change). Missed runs follow Settings.catchUp. */
function refreshSchedules(reason: 'start' | 'timezone'): void {
  const now = new Date()
  const skip = getSettings().catchUp === 'skip'
  let n = 0
  for (const f of listFlows()) {
    if (!f.schedule || !f.enabled) {
      if (f.nextRunAt) { setNextRun(f.id, null); n++ }
      continue
    }
    const missed = f.nextRunAt && f.nextRunAt <= now.toISOString()
    if (reason === 'start' && missed && !skip) continue // fires once on the next scheduler tick
    if (reason === 'start' && f.nextRunAt && !missed) continue
    setNextRun(f.id, computeNext(f.schedule, true, now))
    n++
  }
  if (n) changed()
}

let lastTz = ''
let offSettings: (() => void) | null = null

export function start(): void {
  lastTz = tz()
  refreshSchedules('start')
  offSettings = on('settings.changed', (s) => {
    if (s.timezone && s.timezone !== lastTz) {
      lastTz = s.timezone
      refreshSchedules('timezone')
    }
  })
}

export async function stop(): Promise<void> {
  offSettings?.()
  await stopAllRecordings()
}
