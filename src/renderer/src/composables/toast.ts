import { reactive } from 'vue';

export interface Toast { id: number; title: string; body?: string; tone: 'neutral' | 'good' | 'bad' | 'warn' | 'signal'; action?: { label: string; run: () => void }; ms: number }
export const toasts = reactive<Toast[]>([]);
let n = 0;

export function toast(title: string, opts: Partial<Omit<Toast, 'id' | 'title'>> = {}) {
  const t: Toast = { id: ++n, title, tone: opts.tone ?? 'neutral', body: opts.body, action: opts.action, ms: opts.ms ?? (opts.tone === 'bad' ? 7000 : 4200) };
  toasts.push(t);
  if (toasts.length > 5) toasts.shift();
  setTimeout(() => dismiss(t.id), t.ms);
  return t.id;
}
export function dismiss(id: number) { const i = toasts.findIndex(t => t.id === id); if (i >= 0) toasts.splice(i, 1); }
export const ok = (title: string, body?: string) => toast(title, { tone: 'good', body });
export const fail = (e: unknown, title = 'That did not work') => toast(title, { tone: 'bad', body: (e as Error)?.message ?? String(e) });
