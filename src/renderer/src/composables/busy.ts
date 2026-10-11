import { ref } from 'vue';
import { fail } from './toast';

/**
 * Wrap an action so its button shows a spinner, double clicks are ignored,
 * and failures surface as a toast with the server's message.
 */
export function useBusy() {
  const busy = ref<string | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>, errTitle?: string): Promise<T | undefined> {
    if (busy.value) return undefined;
    busy.value = key;
    try { return await fn(); } catch (e) { fail(e, errTitle); return undefined; } finally { busy.value = null; }
  }
  return { busy, run };
}
