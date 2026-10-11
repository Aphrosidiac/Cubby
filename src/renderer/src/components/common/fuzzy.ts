// Small fuzzy matcher for the quick switcher and command palette: prefix > word start > substring >
// in-order letters. Pure, no dependencies.
import type { BrandRow } from '@shared/types';

/** Score how well `q` matches `text` (0 = no match). */
export function fuzzyScore(q: string, text: string): number {
  const t = text.toLowerCase();
  const s = q.toLowerCase().trim();
  if (!s) return 1;
  if (t === s) return 100;
  if (t.startsWith(s)) return 80 - Math.min(20, t.length - s.length) * 0.5;
  const word = t.split(/[\s@_\-./#]+/).some(w => w.startsWith(s));
  if (word) return 60;
  const i = t.indexOf(s);
  if (i >= 0) return 40 - Math.min(20, i);
  // letters in order ("asc" → "ascend", "ffd" → "ff dev")
  let j = 0, gaps = 0, last = -1;
  for (let k = 0; k < t.length && j < s.length; k++) {
    if (t[k] === s[j]) { if (last >= 0) gaps += k - last - 1; last = k; j++; }
  }
  return j === s.length ? Math.max(1, 20 - gaps) : 0;
}

/** Brands ranked against a query by name, serial, handles, tags and group. */
export function rankBrands(brands: BrandRow[], q: string): BrandRow[] {
  const s = q.trim().replace(/^#0*/, '');
  if (!s) return brands;
  return brands
    .map(b => {
      const fields: [string, number][] = [
        [b.name, 1.2],
        [String(b.serial), 1],
        [b.groupName ?? '', 0.6],
        ...b.accounts.map(a => [a.handle.replace(/^@/, ''), 1] as [string, number]),
        ...b.tags.map(t => [t, 0.7] as [string, number])
      ];
      const score = Math.max(...fields.map(([f, w]) => fuzzyScore(s, f) * w));
      return { b, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.b);
}
