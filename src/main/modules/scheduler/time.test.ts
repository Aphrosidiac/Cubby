import { describe, expect, it } from 'vitest'
import { dayKey, parseHhmm, quietHoursState, safeTz, slotTimes, zonedParts, zonedToUtc } from './time'

const KL = 'Asia/Kuala_Lumpur'
const NY = 'America/New_York'
const iso = (d: Date | null) => d?.toISOString() ?? null

describe('zoned helpers', () => {
  it('reads wall time in a zone', () => {
    const z = zonedParts(new Date('2026-10-11T16:30:00Z'), KL)
    expect(z).toMatchObject({ year: 2026, month: 10, day: 12, hour: 0, minute: 30, weekday: 1 })
  })
  it('converts wall time to UTC', () => {
    expect(iso(zonedToUtc(2026, 10, 12, 20, 0, KL))).toBe('2026-10-12T12:00:00.000Z')
    expect(iso(zonedToUtc(2026, 7, 1, 9, 0, NY))).toBe('2026-07-01T13:00:00.000Z') // EDT
    expect(iso(zonedToUtc(2026, 12, 1, 9, 0, NY))).toBe('2026-12-01T14:00:00.000Z') // EST
  })
  it('rolls over day overflow', () => {
    expect(iso(zonedToUtc(2026, 10, 32, 8, 0, KL))).toBe('2026-11-01T00:00:00.000Z')
  })
  it('handles DST gaps and repeats', () => {
    // 2026-03-08 02:30 does not exist in New York → 03:30 EDT
    expect(iso(zonedToUtc(2026, 3, 8, 2, 30, NY))).toBe('2026-03-08T07:30:00.000Z')
    // 2026-11-01 01:30 happens twice → first (EDT)
    expect(iso(zonedToUtc(2026, 11, 1, 1, 30, NY))).toBe('2026-11-01T05:30:00.000Z')
  })
  it('day key follows the zone', () => {
    const d = new Date('2026-10-11T17:00:00Z')
    expect(dayKey(d, KL)).toBe('2026-10-12')
    expect(dayKey(d, NY)).toBe('2026-10-11')
  })
  it('parses HH:mm', () => {
    expect(parseHhmm('07:05')).toBe(425)
    expect(parseHhmm('24:00')).toBeNull()
    expect(parseHhmm('7:60')).toBeNull()
    expect(parseHhmm('x')).toBeNull()
  })
  it('falls back to KL for unknown zones', () => {
    expect(safeTz('Mars/Olympus')).toBe(KL)
    expect(safeTz(null)).toBe(KL)
    expect(safeTz(NY)).toBe(NY)
  })
})

describe('quiet hours', () => {
  const q = (start: string, end: string, enabled = true) => ({ enabled, start, end })
  it('same-day window', () => {
    // 13:00 KL = 05:00Z
    const s = quietHoursState(new Date('2026-10-11T05:00:00Z'), q('12:00', '14:00'), KL)
    expect(s.quiet).toBe(true)
    expect(iso(s.endsAt)).toBe('2026-10-11T06:00:00.000Z')
    expect(quietHoursState(new Date('2026-10-11T06:00:00Z'), q('12:00', '14:00'), KL).quiet).toBe(false) // end is exclusive
    expect(quietHoursState(new Date('2026-10-11T04:00:00Z'), q('12:00', '14:00'), KL).quiet).toBe(true) // start inclusive
  })
  it('window crossing midnight, before midnight', () => {
    // 23:30 KL on the 11th = 15:30Z → ends 07:00 KL on the 12th = 23:00Z on the 11th
    const s = quietHoursState(new Date('2026-10-11T15:30:00Z'), q('22:00', '07:00'), KL)
    expect(s.quiet).toBe(true)
    expect(iso(s.endsAt)).toBe('2026-10-11T23:00:00.000Z')
  })
  it('window crossing midnight, after midnight', () => {
    // 03:00 KL on the 12th = 19:00Z on the 11th → ends 07:00 KL on the 12th
    const s = quietHoursState(new Date('2026-10-11T19:00:00Z'), q('22:00', '07:00'), KL)
    expect(s.quiet).toBe(true)
    expect(iso(s.endsAt)).toBe('2026-10-11T23:00:00.000Z')
  })
  it('outside a midnight-crossing window', () => {
    expect(quietHoursState(new Date('2026-10-11T04:00:00Z'), q('22:00', '07:00'), KL).quiet).toBe(false)
  })
  it('disabled, malformed or empty windows are not quiet', () => {
    const at = new Date('2026-10-11T19:00:00Z')
    expect(quietHoursState(at, q('22:00', '07:00', false), KL).quiet).toBe(false)
    expect(quietHoursState(at, q('03:00', '03:00'), KL).quiet).toBe(false)
    expect(quietHoursState(at, q('bad', '07:00'), KL).quiet).toBe(false)
    expect(quietHoursState(at, null, KL).quiet).toBe(false)
  })
  it('uses the configured zone', () => {
    // 2026-10-11T03:00Z = 23:00 NY (quiet) and 11:00 KL (not quiet)
    const at = new Date('2026-10-11T03:00:00Z')
    expect(quietHoursState(at, q('22:00', '07:00'), NY).quiet).toBe(true)
    expect(quietHoursState(at, q('22:00', '07:00'), KL).quiet).toBe(false)
  })
})

describe('slot times', () => {
  it('daily slot later today, then following days', () => {
    // 2026-10-11 is a Sunday. 10:00 KL = 02:00Z; slot 20:00 every day
    const t = slotTimes([{ weekdays: [0, 1, 2, 3, 4, 5, 6], time: '20:00' }], new Date('2026-10-11T02:00:00Z'), KL, 3)
    expect(t.map(iso)).toEqual(['2026-10-11T12:00:00.000Z', '2026-10-12T12:00:00.000Z', '2026-10-13T12:00:00.000Z', '2026-10-14T12:00:00.000Z'])
  })
  it('skips a slot that already passed today', () => {
    const t = slotTimes([{ weekdays: [0, 1, 2, 3, 4, 5, 6], time: '08:00' }], new Date('2026-10-11T02:00:00Z'), KL, 1)
    expect(t.map(iso)).toEqual(['2026-10-12T00:00:00.000Z'])
  })
  it('weekdays are local weekdays', () => {
    // From Sunday 10:00 KL, a Monday-only 07:00 slot = Monday 07:00 KL = Sunday 23:00Z
    const t = slotTimes([{ weekdays: [1], time: '07:00' }], new Date('2026-10-11T02:00:00Z'), KL, 7)
    expect(t.map(iso)).toEqual(['2026-10-11T23:00:00.000Z'])
    // in New York the same Monday slot is Monday 11:00Z
    const n = slotTimes([{ weekdays: [1], time: '07:00' }], new Date('2026-10-11T02:00:00Z'), NY, 7)
    expect(n.map(iso)).toEqual(['2026-10-12T11:00:00.000Z'])
  })
  it('near local midnight the local date decides "today"', () => {
    // 23:50 KL Sunday (15:50Z) — an 00:10 slot on Monday is 20 min away
    const t = slotTimes([{ weekdays: [1], time: '00:10' }], new Date('2026-10-11T15:50:00Z'), KL, 2)
    expect(iso(t[0])).toBe('2026-10-11T16:10:00.000Z')
  })
  it('sorts and de-duplicates several slots', () => {
    const t = slotTimes(
      [
        { weekdays: [1, 3], time: '20:00' },
        { weekdays: [1], time: '09:00' },
        { weekdays: [1], time: '20:00' }
      ],
      new Date('2026-10-11T02:00:00Z'),
      KL,
      3
    )
    expect(t.map(iso)).toEqual(['2026-10-12T01:00:00.000Z', '2026-10-12T12:00:00.000Z', '2026-10-14T12:00:00.000Z'])
  })
  it('crosses a DST change with the same wall time', () => {
    const t = slotTimes([{ weekdays: [0], time: '09:00' }], new Date('2026-10-26T12:00:00Z'), NY, 14)
    expect(t.map(iso)).toEqual(['2026-11-01T14:00:00.000Z', '2026-11-08T14:00:00.000Z'])
  })
  it('no slots → nothing', () => {
    expect(slotTimes([], new Date(), KL)).toEqual([])
  })
})
