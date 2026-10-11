<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';

/** Centered dialog. Focus moves in, Tab is trapped, Escape and the scrim close it. */
const props = withDefaults(defineProps<{ open: boolean; title?: string; eyebrow?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; closable?: boolean }>(), { size: 'md', closable: true });
const emit = defineEmits<{ 'update:open': [v: boolean]; close: [] }>();
const dialog = ref<HTMLElement | null>(null);
let last: Element | null = null;
let locked = false;
const close = () => { if (!props.closable) return; emit('update:open', false); emit('close'); };
function key(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); close(); }
  if (e.key === 'Tab' && dialog.value) {
    const f = [...dialog.value.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], lastEl = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  }
}
watch(() => props.open, async o => {
  if (o) {
    last = document.activeElement;
    if (!locked) { lockScroll(); locked = true; }
    await nextTick();
    const target = dialog.value?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), textarea, select') ?? dialog.value;
    setTimeout(() => target?.focus(), 60);
  } else {
    if (locked) { unlockScroll(); locked = false; }
    (last as HTMLElement | null)?.focus?.();
  }
});
onBeforeUnmount(() => { if (locked) { unlockScroll(); locked = false; } });
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-root" @keydown="key">
        <div class="scrim" @click="close" />
        <div ref="dialog" class="dialog" :class="`s-${size}`" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
          <header v-if="title || closable" class="mh">
            <div>
              <div v-if="eyebrow" class="label">{{ eyebrow }}</div>
              <h2 v-if="title" class="h2">{{ title }}</h2>
            </div>
            <button v-if="closable" class="x" type="button" aria-label="Close" @click="close"><Icon name="close" :size="16" /></button>
          </header>
          <div class="mb"><slot /></div>
          <footer v-if="$slots.footer" class="mf"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-root { position: fixed; inset: 0; z-index: 900; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; padding: 24px 16px; overflow-y: auto; }
.scrim { position: fixed; inset: 0; background: var(--scrim); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.dialog { position: relative; width: 100%; min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow-3); max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px); display: flex; flex-direction: column; }
.dialog:focus { outline: none; }
.s-sm { max-width: 420px; } .s-md { max-width: 560px; } .s-lg { max-width: 760px; } .s-xl { max-width: 1040px; }
.mh { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 24px 0; }
.mh .label { margin-bottom: 6px; }
.x { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; color: var(--muted); transition: background-color 200ms, color 200ms, transform 300ms var(--ease-out); }
.x:hover { background: var(--panel-2); color: var(--fg); transform: rotate(90deg); }
.mb { padding: 20px 24px 24px; overflow-y: auto; }
.mf { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 24px; border-top: 1px solid var(--line); background: var(--bg-elev); border-radius: 0 0 10px 10px; flex-wrap: wrap; }
.mb { overscroll-behavior: contain; min-width: 0; overflow-x: hidden; }
/* Phones: a bottom sheet — full width, rising from the thumb's edge, clear of the home bar. */
@media (max-width: 560px) {
  .modal-root { padding: 0; place-items: end stretch; }
  .dialog { max-width: none; border-radius: 16px 16px 0 0; border-bottom: 0; max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); }
  .dialog::before { content: ''; position: absolute; top: 7px; left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: 4px; background: var(--line-strong); }
  .mh { padding: 22px 18px 0; }
  .mb { padding: 16px 18px 20px; }
  .mb:last-child { padding-bottom: calc(20px + env(safe-area-inset-bottom)); }
  .mf { padding: 12px 18px calc(12px + env(safe-area-inset-bottom)); border-radius: 0; }
  .x { width: 36px; height: 36px; margin: -4px -6px 0 0; }
}
</style>
