import type { Directive } from 'vue';

/**
 * v-autosize: a textarea that grows to fit what is in it (between its rows
 * height and `max`), so terms and notes are never clipped behind a scrollbar.
 */
const fit = (el: HTMLTextAreaElement) => {
  const max = Number(el.dataset.max ?? 480);
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
  el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
};
export const autosize: Directive<HTMLTextAreaElement> = {
  mounted(el) { el.addEventListener('input', () => fit(el)); requestAnimationFrame(() => fit(el)); },
  // v-model changes the value without an input event (a draft loading, settings arriving)
  updated(el) { requestAnimationFrame(() => fit(el)); },
};
