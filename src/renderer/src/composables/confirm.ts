import { reactive } from 'vue';

export interface ConfirmOpts { title: string; body?: string; confirm?: string; cancel?: string; danger?: boolean; input?: { label: string; placeholder?: string; required?: boolean; value?: string; multiline?: boolean } }
export const confirmState = reactive<{ open: boolean; opts: ConfirmOpts | null; resolve: ((v: string | boolean | null) => void) | null }>({ open: false, opts: null, resolve: null });

/** Promise-based confirm. With `input`, resolves to the typed string (or null when cancelled). */
export function confirm(opts: ConfirmOpts & { input: NonNullable<ConfirmOpts['input']> }): Promise<string | null>;
export function confirm(opts: ConfirmOpts): Promise<boolean>;
export function confirm(opts: ConfirmOpts): Promise<boolean | string | null> {
  return new Promise(res => { confirmState.opts = opts; confirmState.resolve = res; confirmState.open = true; });
}
export function settle(v: string | boolean | null) { confirmState.resolve?.(v); confirmState.open = false; confirmState.resolve = null; }
