// Time in the person's posting timezone (Settings.timezone, normally Asia/Kuala_Lumpur), independent
// of the computer's own zone: schedule inputs, calendar wall times and labels all go through here.
import { app } from '@/lib/store';

export const tz = () => app.settings?.timezone || 'Asia/Kuala_Lumpur';

/** Short label for the zone: MYT for Malaysia, otherwise what Intl calls it. */
export function tzLabel(zone = tz()): string {
  if (zone === 'Asia/Kuala_Lumpur' || zone === 'Asia/Singapore') return zone === 'Asia/Singapore' ? 'SGT' : 'MYT';
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? zone;
  } catch {
    return zone;
  }
}

function parts(d: Date, zone: string) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

/** Minutes the zone is ahead of UTC at this instant. */
function offsetMin(d: Date, zone: string): number {
  const p = parts(d, zone);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-12T20:00:00" — the wall clock in the zone, with no offset (FullCalendar in UTC mode). */
export function toWall(iso: string | Date, zone = tz()): string {
  const p = parts(typeof iso === 'string' ? new Date(iso) : iso, zone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** Wall clock in the zone → real instant (ISO, UTC). Handles DST by re-checking the offset. */
export function fromWall(day: string, time: string, zone = tz()): string {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMin(new Date(guess), zone) * 60000;
  t = guess - offsetMin(new Date(t), zone) * 60000;
  return new Date(t).toISOString();
}

/** A Date whose UTC fields are a wall time (what FullCalendar hands back in UTC mode) → real ISO. */
export function wallDateToIso(d: Date, zone = tz()): string {
  return fromWall(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, zone);
}

/** { day: 'YYYY-MM-DD', time: 'HH:mm' } of an instant in the zone, for date/time inputs. */
export function splitWall(iso: string | Date, zone = tz()): { day: string; time: string } {
  const w = toWall(iso, zone);
  return { day: w.slice(0, 10), time: w.slice(11, 16) };
}

/** "Mon 12 Oct, 8:00 pm MYT" */
export function fmtWhen(iso: string | null | undefined, opts: { zone?: boolean; year?: boolean } = {}): string {
  if (!iso) return '—';
  const s = new Date(iso).toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: opts.year ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit', timeZone: tz() });
  return opts.zone === false ? s : `${s} ${tzLabel()}`;
}

/** "8:00 pm" */
export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: tz() }) : '—');

/** "12 Oct 2026, 8:00:03 pm" for logs */
export const fmtStamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: tz() }) : '—');

/** "4m 12s", "820 ms" */
export function duration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "1:05" for media lengths */
export function clock(ms: number | null | undefined): string {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
