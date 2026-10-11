import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * For a sideways-scrolling strip (tabs, segmented pills): which edges have
 * more to show, so the strip can fade there instead of cutting a word in
 * half — and a way to bring the active item into view.
 */
export function useOverflowEdges(el: Ref<HTMLElement | null>) {
  const left = ref(false), right = ref(false);
  const update = () => {
    const e = el.value; if (!e) return;
    left.value = e.scrollLeft > 2;
    right.value = e.scrollLeft + e.clientWidth < e.scrollWidth - 2;
  };
  let ro: ResizeObserver | null = null;
  onMounted(() => {
    const e = el.value; if (!e) return;
    e.addEventListener('scroll', update, { passive: true });
    ro = new ResizeObserver(update); ro.observe(e);
    update();
  });
  onBeforeUnmount(() => { el.value?.removeEventListener('scroll', update); ro?.disconnect(); });
  /** Centre `item` in the strip if it is not fully visible. */
  function reveal(item: HTMLElement | null | undefined, smooth = true) {
    const e = el.value; if (!e || !item || e.scrollWidth <= e.clientWidth) return update();
    const a = item.offsetLeft, b = a + item.offsetWidth;
    if (a >= e.scrollLeft + 8 && b <= e.scrollLeft + e.clientWidth - 8) return update();
    e.scrollTo({ left: a - (e.clientWidth - item.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
  }
  return { left, right, update, reveal };
}
