import { reactive, ref } from 'vue';

export interface Toast { id: number; title: string; body?: string; tone: 'neutral' | 'good' | 'bad' | 'warn' | 'signal'; action?: { label: string; run: () => void }; ms: number }
export const toasts = reactive<Toast[]>([]);
/** True while the pointer (or keyboard focus) is on the stack: nothing times out under it. */
export const toastsPaused = ref(false);
let n = 0;
const timers = new Map<number, { handle: number; left: number; since: number }>();

function arm(id: number, ms: number) {
  timers.set(id, { handle: toastsPaused.value ? 0 : window.setTimeout(() => dismiss(id), ms), left: ms, since: Date.now() });
}

export function toast(title: string, opts: Partial<Omit<Toast, 'id' | 'title'>> = {}) {
  // a toast with a body or an action needs longer to read and reach
  const base = opts.tone === 'bad' ? 7000 : opts.action || (opts.body?.length ?? 0) > 60 ? 6500 : 4200;
  const t: Toast = { id: ++n, title, tone: opts.tone ?? 'neutral', body: opts.body, action: opts.action, ms: opts.ms ?? base };
  toasts.push(t);
  if (toasts.length > 5) dismiss(toasts[0].id);
  arm(t.id, t.ms);
  return t.id;
}
export function dismiss(id: number) {
  const tm = timers.get(id);
  if (tm) { clearTimeout(tm.handle); timers.delete(id); }
  const i = toasts.findIndex(t => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
  // the stack can vanish from under the pointer without a mouseleave: never stay paused empty
  if (!toasts.length) toastsPaused.value = false;
}
/** Hold every toast's countdown (hover / focus on the stack) and pick it up again after. */
export function pauseToasts(on: boolean) {
  if (toastsPaused.value === on) return;
  toastsPaused.value = on;
  const now = Date.now();
  for (const [id, tm] of timers) {
    if (on) { clearTimeout(tm.handle); tm.left = Math.max(0, tm.left - (now - tm.since)); }
    else { tm.since = now; tm.handle = window.setTimeout(() => dismiss(id), Math.max(1200, tm.left)); }
  }
}
export const ok = (title: string, body?: string) => toast(title, { tone: 'good', body });
export const fail = (e: unknown, title = 'That did not work') => toast(title, { tone: 'bad', body: (e as Error)?.message ?? String(e) });
