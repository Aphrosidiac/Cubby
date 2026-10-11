// Pacing per account (PLAN §8.3): rules from pacing_rules (seeded from defaultPacingRules() on
// first start), the ledger in post_ledger. An account may post when (a) the last post on that platform
// was ≥ minGapMin (+ a deterministic jitter in [0, jitterMin] seeded by account + local day of that
// post) ago and (b) fewer than dailyMax posts in the last 24 h. The pure calculation lives in
// @shared/pacing.ts (unit-tested); this module only feeds it rows.
// Implements: pacing.rules, pacing.setRules, pacing.check.
import { computePacing } from '@shared/pacing'
import { DEFAULT_PACING, defaultPacingRules, platformName } from '@shared/platforms'
import { AGE_TIERS, PLATFORMS, type AgeTier, type PacingCheck, type PacingRule, type Platform } from '@shared/types'
import { db } from '../../core/db'
import { UserError } from '../../core/errors'
import { nowIso } from '../../core/ids'
import { implement } from '../../core/registry'
import { getSettings } from '../../core/settings'
import { getAccount } from '../accounts/repo'
import { dayKey, safeTz } from '../scheduler/time'

const MIN = 60_000
const DAY = 24 * 60 * MIN

interface RuleRow {
  platform: string
  age_tier: string
  min_gap_min: number
  daily_max: number
  jitter_min: number
}

const mapRule = (r: RuleRow): PacingRule => ({ platform: r.platform as Platform, ageTier: r.age_tier as AgeTier, minGapMin: r.min_gap_min, dailyMax: r.daily_max, jitterMin: r.jitter_min })

export function getRules(): PacingRule[] {
  return db.all<RuleRow>('SELECT * FROM pacing_rules').map(mapRule).sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform) || AGE_TIERS.indexOf(a.ageTier) - AGE_TIERS.indexOf(b.ageTier))
}

/** The rule for a platform + tier; falls back to the tier default (e.g. custom platforms). */
export function ruleFor(platform: Platform, tier: AgeTier): PacingRule {
  const r = db.get<RuleRow>('SELECT * FROM pacing_rules WHERE platform = ? AND age_tier = ?', platform, tier)
  return r ? mapRule(r) : { platform, ageTier: tier, ...(DEFAULT_PACING[tier] ?? DEFAULT_PACING.new) }
}

function seedRules(): void {
  const n = db.get<{ n: number }>('SELECT count(*) n FROM pacing_rules')?.n ?? 0
  if (n > 0) return
  db.tx(() => {
    for (const r of defaultPacingRules()) db.run('INSERT INTO pacing_rules (platform, age_tier, min_gap_min, daily_max, jitter_min) VALUES (?, ?, ?, ?, ?)', r.platform, r.ageTier, r.minGapMin, r.dailyMax, r.jitterMin)
  })
}

/** Ledger times for an account + platform since `since` (ISO strings sort correctly). */
export function ledgerTimes(accountId: string, platform: Platform, since: Date): Date[] {
  return db
    .all<{ posted_at: string }>('SELECT posted_at FROM post_ledger WHERE account_id = ? AND platform = ? AND posted_at > ? ORDER BY posted_at', accountId, platform, since.toISOString())
    .map((r) => new Date(r.posted_at))
}

/**
 * May this account post at `at`? `planned` adds hypothetical earlier posts (e.g. other scheduled
 * posts when looking for a free slot) on top of the ledger.
 */
export function checkPacing(accountId: string, at: Date = new Date(), planned: Date[] = []): PacingCheck {
  const acc = getAccount(accountId)
  const rule = ruleFor(acc.platform, acc.ageTier)
  const lookback = Math.max(DAY, (rule.minGapMin + rule.jitterMin) * MIN) + MIN
  const times = [...ledgerTimes(accountId, acc.platform, new Date(at.getTime() - lookback)), ...planned].filter((d) => d.getTime() <= at.getTime())
  const last = times.reduce<Date | null>((m, d) => (!m || d > m ? d : m), null)
  const seed = `${accountId}:${last ? dayKey(last, safeTz(getSettings().timezone)) : 'none'}`
  return computePacing(rule, times, at, seed)
}

export function recordPost(accountId: string, platform: Platform, postId: string | null): void {
  db.run('INSERT INTO post_ledger (account_id, platform, post_id, posted_at) VALUES (?, ?, ?, ?)', accountId, platform, postId, nowIso())
}

implement({
  'pacing.rules': () => getRules(),

  'pacing.setRules': ({ rules }) => {
    // the table is replaced as a whole: every platform × tier exactly once (custom is optional)
    const seen = new Set<string>()
    for (const r of rules) {
      const k = `${r.platform}/${r.ageTier}`
      if (seen.has(k)) throw new UserError(`${platformName(r.platform)} · ${r.ageTier} appears twice in the pacing rules`)
      seen.add(k)
    }
    const missing: string[] = []
    for (const p of PLATFORMS) {
      if (p === 'custom') continue
      for (const t of AGE_TIERS) if (!seen.has(`${p}/${t}`)) missing.push(`${platformName(p)} · ${t}`)
    }
    if (missing.length) throw new UserError(`Pacing rules are missing for: ${missing.join(', ')}`)
    db.tx(() => {
      db.run('DELETE FROM pacing_rules')
      for (const r of rules) db.run('INSERT INTO pacing_rules (platform, age_tier, min_gap_min, daily_max, jitter_min) VALUES (?, ?, ?, ?, ?)', r.platform, r.ageTier, r.minGapMin, r.dailyMax, r.jitterMin)
    })
    return getRules()
  },

  'pacing.check': ({ accountId, at }) => {
    const when = at ? new Date(at) : new Date()
    if (Number.isNaN(when.getTime())) throw new UserError('Pick a valid time')
    return checkPacing(accountId, when)
  }
})

export function start(): void {
  seedRules()
}
export async function stop(): Promise<void> {}
