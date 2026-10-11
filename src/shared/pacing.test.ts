import { describe, expect, it } from 'vitest'
import { computePacing, hash01, jitterMs } from './pacing'
import type { PacingRule } from './types'

const MIN = 60_000
const at = new Date('2026-10-11T12:00:00.000Z')
const ago = (m: number) => new Date(at.getTime() - m * MIN)
const rule = (r: Partial<PacingRule> = {}): PacingRule => ({ platform: 'instagram', ageTier: 'new', minGapMin: 60, dailyMax: 3, jitterMin: 0, ...r })

describe('hash01 / jitterMs', () => {
  it('is deterministic and in range', () => {
    for (const s of ['a', 'acc_1:2026-10-11', 'acc_1:2026-10-12', '']) {
      const h = hash01(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(1)
      expect(hash01(s)).toBe(h)
    }
  })
  it('spreads neighbouring seeds', () => {
    const vals = Array.from({ length: 200 }, (_, i) => jitterMs(`acc_x:2026-10-${i}`, 10))
    expect(new Set(vals).size).toBeGreaterThan(100)
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...vals)).toBeLessThanOrEqual(10 * MIN)
    // both halves of the range get used
    expect(vals.some((v) => v < 3 * MIN)).toBe(true)
    expect(vals.some((v) => v > 7 * MIN)).toBe(true)
  })
  it('zero / negative jitter is zero', () => {
    expect(jitterMs('x', 0)).toBe(0)
    expect(jitterMs('x', -5)).toBe(0)
  })
  it('jitter is whole seconds', () => {
    expect(jitterMs('abc', 10) % 1000).toBe(0)
  })
})

describe('computePacing — gap', () => {
  it('ok with no history', () => {
    expect(computePacing(rule(), [], at, 's')).toEqual({ ok: true, nextAllowedAt: null, reason: null })
  })
  it('blocks inside the minimum gap and says when', () => {
    const r = computePacing(rule(), [ago(20)], at, 's')
    expect(r.ok).toBe(false)
    expect(r.nextAllowedAt).toBe(new Date(ago(20).getTime() + 60 * MIN).toISOString())
    expect(r.reason).toMatch(/last Instagram post was 20 min ago/)
    expect(r.reason).toMatch(/new accounts wait 1 h/)
  })
  it('ok exactly at the gap boundary', () => {
    expect(computePacing(rule(), [ago(60)], at, 's').ok).toBe(true)
  })
  it('only the latest post matters for the gap', () => {
    const r = computePacing(rule({ dailyMax: 10 }), [ago(300), ago(30), ago(200)], at, 's')
    expect(r.nextAllowedAt).toBe(new Date(ago(30).getTime() + 60 * MIN).toISOString())
  })
  it('adds the seeded jitter, the same every time', () => {
    const r1 = computePacing(rule({ jitterMin: 10 }), [ago(60)], at, 'acc_1:2026-10-11')
    const r2 = computePacing(rule({ jitterMin: 10 }), [ago(60)], at, 'acc_1:2026-10-11')
    const j = jitterMs('acc_1:2026-10-11', 10)
    expect(r1).toEqual(r2)
    if (j > 0) {
      expect(r1.ok).toBe(false)
      expect(r1.nextAllowedAt).toBe(new Date(at.getTime() + j).toISOString())
    }
    // after gap + max jitter it is always ok
    expect(computePacing(rule({ jitterMin: 10 }), [ago(70)], at, 'acc_1:2026-10-11').ok).toBe(true)
  })
  it('different seeds can give different release times', () => {
    const times = new Set(Array.from({ length: 20 }, (_, i) => computePacing(rule({ jitterMin: 10 }), [ago(60)], at, `acc_${i}:d`).nextAllowedAt))
    expect(times.size).toBeGreaterThan(5)
  })
  it('ignores ledger entries after `at`', () => {
    expect(computePacing(rule(), [new Date(at.getTime() + 5 * MIN)], at, 's').ok).toBe(true)
  })
  it('minGap 0 never blocks on the gap', () => {
    expect(computePacing(rule({ minGapMin: 0, dailyMax: 99 }), [ago(0)], at, 's').ok).toBe(true)
  })
})

describe('computePacing — daily cap', () => {
  it('blocks at the cap over the trailing 24 h, released when the oldest ages out', () => {
    const posts = [ago(23 * 60), ago(10 * 60), ago(5 * 60)]
    const r = computePacing(rule(), posts, at, 's')
    expect(r.ok).toBe(false)
    expect(r.nextAllowedAt).toBe(new Date(ago(23 * 60).getTime() + 24 * 60 * MIN).toISOString())
    expect(r.reason).toMatch(/3 Instagram posts in the last 24 h/)
  })
  it('posts older than 24 h do not count', () => {
    expect(computePacing(rule(), [ago(25 * 60), ago(24 * 60), ago(5 * 60)], at, 's').ok).toBe(true)
  })
  it('over the cap waits for enough posts to age out', () => {
    // 5 posts, cap 3: the 3rd oldest must age out (n - max = index 2)
    const posts = [ago(20 * 60), ago(18 * 60), ago(16 * 60), ago(14 * 60), ago(12 * 60)]
    const r = computePacing(rule({ minGapMin: 0 }), posts, at, 's')
    expect(r.nextAllowedAt).toBe(new Date(ago(16 * 60).getTime() + 24 * 60 * MIN).toISOString())
  })
  it('nextAllowedAt is the later of gap and cap', () => {
    // cap releases in 1 h (oldest 23 h ago) but the last post was 10 min ago with a 120 min gap
    const posts = [ago(23 * 60), ago(60), ago(10)]
    const r = computePacing(rule({ minGapMin: 120 }), posts, at, 's')
    expect(r.nextAllowedAt).toBe(new Date(ago(10).getTime() + 120 * MIN).toISOString())
    expect(r.reason).toContain(';')
    // and the other way round
    const r2 = computePacing(rule({ minGapMin: 30 }), [ago(2 * 60), ago(90), ago(45)], at, 's')
    expect(r2.nextAllowedAt).toBe(new Date(ago(2 * 60).getTime() + 24 * 60 * MIN).toISOString())
  })
  it('at nextAllowedAt the check passes', () => {
    const posts = [ago(23 * 60), ago(10 * 60), ago(5 * 60)]
    const r = computePacing(rule({ jitterMin: 10 }), posts, at, 'seed')
    const r2 = computePacing(rule({ jitterMin: 10 }), posts, new Date(r.nextAllowedAt!), 'seed')
    expect(r2.ok).toBe(true)
  })
})
