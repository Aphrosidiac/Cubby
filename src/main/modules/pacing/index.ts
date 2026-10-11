// OWNER: posting module builder. PUBLIC interface — keep exports; replace stubs.
//
// Pacing per account (PLAN §8.3): rules from pacing_rules (seeded from defaultPacingRules() on
// first start), the ledger in post_ledger. An account may post when (a) the last post on that platform
// was ≥ minGapMin (+ a deterministic jitter in [0, jitterMin] seeded by account+day) ago and (b) fewer
// than dailyMax posts in the last 24 h. The pure calculation lives in @shared/pacing.ts (unit-tested).
// Implements: pacing.rules, pacing.setRules, pacing.check.
import type { PacingCheck, Platform } from '@shared/types'

export function checkPacing(accountId: string, at: Date = new Date()): PacingCheck {
  void accountId
  void at
  return { ok: true, nextAllowedAt: null, reason: null }
}

export function recordPost(accountId: string, platform: Platform, postId: string | null): void {
  void accountId
  void platform
  void postId
}

export function start(): void {}
export async function stop(): Promise<void> {}
