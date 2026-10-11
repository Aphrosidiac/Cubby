// Wall-clock math in Settings.timezone with Intl only (no tz library). Pure and electron-free so
// slots, quiet hours and the pacing day key are unit-tested. Used by posts (slots / next free slot),
// pacing (jitter seed day) and the scheduler (quiet hours).
export const DEFAULT_TZ = 'Asia/Kuala_Lumpur'

export interface ZonedParts {
  year: number
  /** 1-12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
}

const fmts = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })
    fmts.set(tz, f)
  }
  return f
}

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false
  try {
    fmt(tz)
    return true
  } catch {
    return false
  }
}

/** The configured zone, or Kuala Lumpur when it is missing or unknown to Intl. */
export const safeTz = (tz: string | null | undefined): string => (isValidTimeZone(tz) ? (tz as string) : DEFAULT_TZ)

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function zonedParts(d: Date, tz: string): ZonedParts {
  const p: Record<string, string> = {}
  for (const x of fmt(tz).formatToParts(d)) p[x.type] = x.value
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: WEEKDAYS[p.weekday] ?? 0 }
}

/** Offset of `tz` from UTC at instant `d`, in ms (MYT = +8 h). */
export function tzOffsetMs(d: Date, tz: string): number {
  const z = zonedParts(d, tz)
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return asUtc - Math.floor(d.getTime() / 1000) * 1000
}

/**
 * The instant at which the wall clock in `tz` reads y-m-d h:mi. Out-of-range days/months roll over
 * (day 32 → next month). A time skipped by a DST jump resolves to the instant after the jump;
 * a repeated time resolves to its first occurrence.
 */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const o1 = tzOffsetMs(new Date(guess), tz)
  let t = guess - o1
  const o2 = tzOffsetMs(new Date(t), tz)
  if (o2 !== o1) {
    const t2 = guess - o2
    // keep the candidate that really shows the requested wall time; otherwise (DST gap) the later one
    const z = zonedParts(new Date(t2), tz)
    t = z.hour === hour && z.minute === minute ? t2 : Math.max(t, t2)
  }
  return new Date(t)
}

/** Local calendar day "YYYY-MM-DD" of an instant. */
export function dayKey(d: Date, tz: string): string {
  const z = zonedParts(d, tz)
  return `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`
}

/** "HH:mm" → minutes after midnight; null if malformed. */
export function parseHhmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = +m[1]
  const mi = +m[2]
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

/** Local date `offset` days after the local date of `d` (calendar math, DST-safe). */
function addLocalDays(z: { year: number; month: number; day: number }, offset: number): { year: number; month: number; day: number; weekday: number } {
  const u = new Date(Date.UTC(z.year, z.month - 1, z.day + offset))
  return { year: u.getUTCFullYear(), month: u.getUTCMonth() + 1, day: u.getUTCDate(), weekday: u.getUTCDay() }
}

export interface QuietHours {
  enabled: boolean
  start: string
  end: string
}

/**
 * Is `at` inside the quiet window, and when does it end? Windows may cross midnight
 * (22:00 → 07:00). start === end, a malformed time or enabled=false = no quiet hours.
 */
export function quietHoursState(at: Date, q: QuietHours | null | undefined, tz: string): { quiet: boolean; endsAt: Date | null } {
  const none = { quiet: false, endsAt: null }
  if (!q?.enabled) return none
  const s = parseHhmm(q.start)
  const e = parseHhmm(q.end)
  if (s == null || e == null || s === e) return none
  const z = zonedParts(at, tz)
  const m = z.hour * 60 + z.minute
  const endOn = (offset: number) => {
    const d = addLocalDays(z, offset)
    return zonedToUtc(d.year, d.month, d.day, Math.floor(e / 60), e % 60, tz)
  }
  if (s < e) return m >= s && m < e ? { quiet: true, endsAt: endOn(0) } : none
  if (m >= s) return { quiet: true, endsAt: endOn(1) }
  if (m < e) return { quiet: true, endsAt: endOn(0) }
  return none
}

export interface SlotSpec {
  weekdays: number[]
  time: string
}

/**
 * Every slot instant strictly after `from`, over the next `days` local days, ascending and
 * de-duplicated. Weekdays are read in `tz` (a Monday 08:00 slot is Monday 08:00 local time).
 */
export function slotTimes(slots: SlotSpec[], from: Date, tz: string, days = 60): Date[] {
  const z = zonedParts(from, tz)
  const out = new Set<number>()
  for (let off = 0; off <= days; off++) {
    const d = addLocalDays(z, off)
    for (const s of slots) {
      const mins = parseHhmm(s.time)
      if (mins == null || !s.weekdays.includes(d.weekday)) continue
      const t = zonedToUtc(d.year, d.month, d.day, Math.floor(mins / 60), mins % 60, tz).getTime()
      if (t > from.getTime()) out.add(t)
    }
  }
  return [...out].sort((a, b) => a - b).map((t) => new Date(t))
}
