/** "yesterday" → "Yesterday": relative times that start a table cell or a fact read in sentence case. */
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** An hour of the day as app text: 3 → "3:00 am", 0 → "12:00 am", 13 → "1:00 pm". */
export const hourText = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'am' : 'pm'}`;

/** "09:30" (an <input type=time> value) → "9:30 am". Anything unparseable comes back unchanged. */
export function clockText(hhmm: string | null | undefined) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return hhmm ?? '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

/** Middle-truncate a path or file name so its end (the folder or the extension) stays readable. */
export function middle(s: string, max: number) {
  if (s.length <= max) return s;
  const keep = max - 1;
  const tail = Math.ceil(keep * 0.55);
  return `${s.slice(0, keep - tail)}…${s.slice(s.length - tail)}`;
}
