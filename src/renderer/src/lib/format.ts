/** Money is integer sen everywhere. */
export function rm(sen: number | null | undefined, opts: { decimals?: boolean; sign?: boolean; compact?: boolean } = {}) {
  if (sen === null || sen === undefined || Number.isNaN(sen)) return '—';
  const neg = sen < 0;
  const v = Math.abs(sen) / 100;
  let s: string;
  if (opts.compact && v >= 10000) s = `${(v / 1000).toLocaleString('en-MY', { maximumFractionDigits: v >= 100000 ? 0 : 1 })}k`;
  else s = v.toLocaleString('en-MY', { minimumFractionDigits: opts.decimals === false ? 0 : 2, maximumFractionDigits: opts.decimals === false ? 0 : 2 });
  return `${neg ? '−' : opts.sign && sen > 0 ? '+' : ''}RM ${s}`;
}
export const toSen = (ringgit: string | number) => Math.round(Number(String(ringgit).replace(/[^\d.\-]/g, '')) * 100) || 0;
export const fromSen = (sen: number | null | undefined) => (sen ?? 0) / 100;

const D = (d: string | Date) => (typeof d === 'string' ? new Date(d) : d);
/** 12 Sep 2026 */
export const date = (d?: string | Date | null) => (d ? D(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }) : '—');
/** 12 Sep */
export const shortDate = (d?: string | Date | null) => (d ? D(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' }) : '—');
export const dateTime = (d?: string | Date | null) => (d ? D(d).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }) : '—');
/** YYYY-MM-DD in Malaysia time, for date inputs. */
export const isoDay = (d: string | Date = new Date()) => { const x = new Date(D(d).getTime() + 8 * 3.6e6); return x.toISOString().slice(0, 10); };
export const addDays = (d: string | Date, n: number) => new Date(D(d).getTime() + n * 86400_000);

/** "3h ago", "in 2 days", "yesterday" */
export function ago(d?: string | Date | null) {
  if (!d) return '—';
  const diff = (D(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}
export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`);
export const initials = (name?: string | null) => (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
export const titleCase = (s?: string | null) => (s ?? '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export const sentence = (s?: string | null) => { const t = (s ?? '').toLowerCase().replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
export const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
