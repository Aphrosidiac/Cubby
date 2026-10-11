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
  if (f.length === 5 && /^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) && f[2] === '*' && f[3] === '*' && /^[\d,]+$/.test(f[4])) {
    const days = f[4].split(',').map(d => DAY[+d % 7]);
    return `${days.join(', ')} at ${at(f[1], f[0])}`;
  }
  if (/^\*\/(\d+) \* \* \* \*$/.test(cron.trim())) return `Every ${cron.trim().split('/')[1].split(' ')[0]} minutes`;
  return `Cron: ${cron}`;
}
