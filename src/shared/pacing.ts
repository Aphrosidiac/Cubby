// Pacing per account (PLAN §8.3) as one pure calculation, so main (pacing module, scheduler,
// next free slot) and tests agree on exactly when an account may post again.
//
// Two rules, both per account + platform:
//  - gap:   the last post was at least minGapMin + jitter ago. The jitter is deterministic in
//           [0, jitterMin] minutes, derived from a seed (the module uses account id + local day of the
//           last post) so the same question always gets the same answer — no random re-rolls between
//           the scheduler tick and the UI.
//  - daily: fewer than dailyMax posts in the trailing 24 h.
// nextAllowedAt is the earliest instant both hold: the gap only depends on the last post and the
// daily count only falls over time, so it is simply the later of the two release times.
import { platformName } from './platforms'
import type { PacingCheck, PacingRule } from './types'

const MIN = 60_000
const DAY = 24 * 60 * MIN

/** FNV-1a 32-bit hash of a string, as a fraction in [0, 1]. Stable across runs and machines. */
export function hash01(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // final avalanche so neighbouring seeds ("…-01", "…-02") spread over the whole range
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  return (h >>> 0) / 0xffffffff
}

/** Deterministic jitter for a seed, whole seconds in [0, jitterMin] minutes. */
export function jitterMs(seed: string, jitterMin: number): number {
  if (!(jitterMin > 0)) return 0
  return Math.round(hash01(seed) * jitterMin * 60) * 1000
}

function fmtMinutes(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

/**
 * May an account post at `at`? `postedAt` = this account's earlier posts on the rule's platform
 * (entries after `at` are ignored). `seed` drives the jitter.
 */
export function computePacing(rule: PacingRule, postedAt: Date[], at: Date, seed: string): PacingCheck {
  const t = at.getTime()
  const past = postedAt
    .map((d) => d.getTime())
    .filter((x) => Number.isFinite(x) && x <= t)
    .sort((a, b) => a - b)
  const name = platformName(rule.platform)
  const reasons: string[] = []
  let next = t

  if (past.length) {
    const last = past[past.length - 1]
    const jit = jitterMs(seed, rule.jitterMin)
    const gapEnd = last + rule.minGapMin * MIN + jit
    if (gapEnd > t) {
      next = Math.max(next, gapEnd)
      const extra = jit >= MIN ? ` (+${fmtMinutes(jit)} jitter)` : ''
      reasons.push(`last ${name} post was ${fmtMinutes(t - last)} ago — ${rule.ageTier} accounts wait ${fmtMinutes(rule.minGapMin * MIN)}${extra} between posts`)
    }
  }

  const inDay = past.filter((x) => x > t - DAY)
  if (rule.dailyMax >= 1 && inDay.length >= rule.dailyMax) {
    // the window drops below the cap once the (n - max + 1)th oldest post in it is 24 h old
    const release = inDay[inDay.length - rule.dailyMax] + DAY
    next = Math.max(next, release)
    reasons.push(`${inDay.length} ${name} post${inDay.length === 1 ? '' : 's'} in the last 24 h — ${rule.ageTier} accounts are capped at ${rule.dailyMax} a day`)
  }

  if (next <= t) return { ok: true, nextAllowedAt: null, reason: null }
  return { ok: false, nextAllowedAt: new Date(next).toISOString(), reason: reasons.join('; ') }
}
