// OWNER: automation module builder. PUBLIC interface — keep exports; replace stubs.
//
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
//    isOffLimits(url) and the actor is claude
import type { Page } from 'playwright-core'
import type { Actor, FlowRun, LiveRun } from '@shared/types'
import { UserError } from '../../core/errors'

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
}

/** Queue + execute a run. Resolves with the final run record and the body's result (if it succeeded). */
export async function startRun<T>(opts: RunOptions, body: (rt: RunContext) => Promise<T>): Promise<{ run: FlowRun; result?: T; error?: unknown }> {
  void body
  throw new UserError(`run manager not built (${opts.label})`, 'not_implemented')
}

export function liveRuns(): LiveRun[] {
  return []
}

export function abortRun(runId: string): boolean {
  void runId
  return false
}

export function abortAll(): void {}

export function start(): void {}
export async function stop(): Promise<void> {}
