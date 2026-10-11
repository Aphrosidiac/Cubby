// The run manager (PLAN §18 "Runs"): every recipe, flow and long Claude action executes as a run.
//  - one run per brand at a time; further runs for that brand wait in a FIFO queue
//  - each run gets an AbortController; runtime onKill() aborts all; runs.abort aborts one
//  - persists to the `runs` table (status, log entries, screenshots) and emits run.log / runs.changed,
//    requestStatus() so AppStatus.runs (liveRuns()) stays current
//  - rt.step(name, fn) logs start/end, and on failure takes a screenshot (paths.screens) + rethrows
//  - rt.checkpoint() inspects the active page (url, title, visible text, iframe srcs) with
//    detectCheckpoint() from @shared/checkpoints; on a hit: status needs_human, frontBrand(), notify(),
//    logActivity('guardrail.checkpoint'), throw GuardrailError(rule 'checkpoint'). Never solve it.
//  - rt.page() is activePage(brandId); rt.guardUrl(url) throws GuardrailError('off_limits') when
//    isOffLimits(url) and the actor is claude or flow
// The logic lives in ./manager (electron-free, unit-tested); this file wires the browser module and
// OS notifications into it and owns the module lifecycle.
import { notify } from '../../core/notify'
import { onKill } from '../../core/runtime'
import { activePage, frontBrand } from '../browser'
import { abortAll, drain, failStaleRuns, flushAll, setRunDeps } from './manager'

export type { RunContext, RunOptions, Enqueued } from './manager'
export { startRun, enqueueRun, liveRuns, brandBusy, abortRun, abortAll, getRun, listRuns, pageFacts } from './manager'

setRunDeps({ activePage, frontBrand, notify })

let offKill: (() => void) | null = null

export function start(): void {
  const n = failStaleRuns()
  if (n) console.log(`[runs] marked ${n} interrupted run(s) as failed`)
  offKill = onKill(() => abortAll('Stopped — kill switch'))
}

export async function stop(): Promise<void> {
  offKill?.()
  abortAll('Cubby is quitting')
  await drain(5000)
  flushAll()
}
