import { onBeforeUnmount, watch } from 'vue';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';

/** Hold the page still while an overlay is open (so a phone scrolls the sheet, not the page under it). */
export function useOverlayLock(open: () => boolean) {
  let held = false;
  const set = (o: boolean) => { if (o && !held) { lockScroll(); held = true; } else if (!o && held) { unlockScroll(); held = false; } };
  watch(open, set, { immediate: true });
  onBeforeUnmount(() => set(false));
}
