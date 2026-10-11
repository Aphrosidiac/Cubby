// Flow schedules: the editor's presets (hourly / daily / weekdays / custom) to and from cron, and
// a human sentence for any cron the presets produce.

export type SchedulePreset =
  | { kind: 'off' }
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'custom'; cron: string };

const pad = (n: number) => String(n).padStart(2, '0');
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseSchedule(cron: string | null | undefined): SchedulePreset {
  if (!cron || !cron.trim()) return { kind: 'off' };
  const f = cron.trim().split(/\s+/);
  if (f.length === 5) {
    const [mi, h, dom, mon, dow] = f;
    const num = (x: string) => /^\d+$/.test(x);
    if (num(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return { kind: 'hourly', minute: +mi };
    if (num(mi) && num(h) && dom === '*' && mon === '*') {
      const time = `${pad(+h)}:${pad(+mi)}`;
      if (dow === '*') return { kind: 'daily', time };
      if (dow === '1-5' || dow === 'MON-FRI') return { kind: 'weekdays', time };
    }
  }
  return { kind: 'custom', cron: cron.trim() };
}

export function buildSchedule(p: SchedulePreset): string | null {
  switch (p.kind) {
    case 'off': return null;
    case 'hourly': return `${Math.min(59, Math.max(0, p.minute | 0))} * * * *`;
    case 'daily': { const [h, m] = p.time.split(':').map(Number); return `${m | 0} ${h | 0} * * *`; }
    case 'weekdays': { const [h, m] = p.time.split(':').map(Number); return `${m | 0} ${h | 0} * * 1-5`; }
    case 'custom': return p.cron.trim() || null;
  }
}

/** Light syntax check (croner does the real one in main): five fields of cron characters. */
export function cronError(cron: string): string | null {
  const f = cron.trim().split(/\s+/);
  if (f.length < 5 || f.length > 6) return 'A cron needs five fields: minute hour day month weekday';
  if (f.some(x => !/^[\d*,\-/A-Za-z?LW#]+$/.test(x))) return 'Only numbers, * , - / and day/month names are allowed';
  return null;
}

function at(h: string, m: string) {
  const hh = +h, mm = +m;
  const am = hh < 12;
  return `${hh % 12 || 12}:${pad(mm)} ${am ? 'am' : 'pm'}`;
}

export function describeSchedule(cron: string | null | undefined): string {
  if (!cron) return 'Manual only';
  const p = parseSchedule(cron);
  if (p.kind === 'hourly') return p.minute ? `Every hour at :${pad(p.minute)}` : 'Every hour';
  if (p.kind === 'daily') { const [h, m] = p.time.split(':'); return `Every day at ${at(h, m)}`; }
  if (p.kind === 'weekdays') { const [h, m] = p.time.split(':'); return `Weekdays at ${at(h, m)}`; }
  const f = cron.trim().split(/\s+/);
  const raw = `Cron: ${cron.trim()}`;
  if (f.length !== 5 || f[2] !== '*' || f[3] !== '*') return raw;
  const [mi, h, , , dow] = f;
  const days = dayText(dow);
  if (days === null) return raw;
  const num = (x: string) => /^\d+$/.test(x) && +x < 60;
  // "Mon, Wed at 9:00 am"
  if (num(mi) && num(h)) return `${days ? days.replace(/^, /, '') : 'Every day'} at ${at(h, mi)}`;
  // "Every 30 minutes from 9:00 am to 6:30 pm, weekdays"
  const step = /^\*\/(\d+)$/.exec(mi);
  if (step && +step[1] > 0 && +step[1] < 60) {
    const n = +step[1];
    const last = Math.floor(59 / n) * n;
    const every = n === 1 ? 'Every minute' : `Every ${n} minutes`;
    if (h === '*') return `${every}${days}`;
    const r = /^(\d+)-(\d+)$/.exec(h);
    if (r && +r[1] < 24 && +r[2] < 24 && +r[1] <= +r[2]) return `${every} from ${at(r[1], '0')} to ${at(r[2], String(last))}${days}`;
    return raw;
  }
  if (mi === '*' && h === '*') return `Every minute${days}`;
  // "Every 2 hours at :15"
  const hs = /^\*\/(\d+)$/.exec(h);
  if (num(mi) && hs && +hs[1] > 0 && +hs[1] < 24) return `Every ${+hs[1] === 1 ? 'hour' : `${hs[1]} hours`}${+mi ? ` at :${pad(+mi)}` : ''}${days}`;
  return raw;
}

/** ", weekdays" / ", Mon, Wed" / "" for every day; null when the weekday field is not something we can say simply. */
function dayText(dow: string): string | null {
  if (dow === '*' || dow === '?') return '';
  if (dow === '1-5' || /^MON-FRI$/i.test(dow)) return ', weekdays';
  if (dow === '0,6' || dow === '6,0' || /^(SAT,SUN|SUN,SAT)$/i.test(dow)) return ', weekends';
  const r = /^(\d)-(\d)$/.exec(dow);
  if (r && +r[1] <= 7 && +r[2] <= 7) return `, ${DAY[+r[1] % 7]}–${DAY[+r[2] % 7]}`;
  if (/^\d(,\d)*$/.test(dow) && dow.split(',').every(d => +d <= 7)) return `, ${dow.split(',').map(d => DAY[+d % 7]).join(', ')}`;
  return null;
}
