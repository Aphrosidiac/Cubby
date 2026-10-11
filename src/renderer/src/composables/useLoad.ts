import { onBeforeUnmount, ref, shallowRef, watch, type Ref, type WatchSource } from 'vue';
import { onTopics } from '@/lib/live';

/**
 * Load data for a screen and keep it fresh:
 *   - reruns when any `deps` change (filters, route params)
 *   - reruns quietly when a live event names one of `topics`
 * `loading` is only true for the first load; refreshes swap data in place so
 * nothing flickers back to a skeleton.
 */
export function useLoad<T>(fn: () => Promise<T>, opts: { topics?: string[] | (() => string[]); deps?: WatchSource[]; immediate?: boolean } = {}) {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const loading = ref(true);
  const refreshing = ref(false);
  const error = ref<string | null>(null);
  const tick = ref(0);
  let seq = 0;
  async function load(quiet = false) {
    const my = ++seq;
    if (!quiet && data.value === null) loading.value = true;
    refreshing.value = true;
    try {
      const v = await fn();
      if (my !== seq) return;
      data.value = v;
      error.value = null;
      tick.value++;
    } catch (e) {
      if (my !== seq) return;
      error.value = (e as Error).message;
    } finally {
      if (my === seq) { loading.value = false; refreshing.value = false; }
    }
  }
  if (opts.deps?.length) watch(opts.deps, () => void load(), { deep: true });
  if (opts.immediate !== false) void load();
  let off: (() => void) | null = null;
  const sub = () => {
    off?.();
    const t = typeof opts.topics === 'function' ? opts.topics() : opts.topics;
    if (t?.length) off = onTopics(t, () => void load(true)) as unknown as () => void;
  };
  sub();
  if (typeof opts.topics === 'function') watch(opts.topics, sub);
  onBeforeUnmount(() => off?.());
  return { data, loading, refreshing, error, reload: load, tick };
}
