<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';

/** Right-hand sheet for detail-at-a-glance (a lead, a ledger). The list stays in view behind it. */
const props = withDefaults(defineProps<{ open: boolean; title?: string; eyebrow?: string; width?: number }>(), { width: 560 });
const emit = defineEmits<{ 'update:open': [v: boolean]; close: [] }>();
const close = () => { emit('update:open', false); emit('close'); };
const sheet = ref<HTMLElement | null>(null);
let last: Element | null = null;
let locked = false;
const key = (e: KeyboardEvent) => {
  if (!props.open) return;
  if (e.key === 'Escape') close();
  if (e.key === 'Tab' && sheet.value) {
    const f = [...sheet.value.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
};
watch(() => props.open, async o => {
  if (o) { last = document.activeElement; window.addEventListener('keydown', key); if (!locked) { lockScroll(); locked = true; } await nextTick(); setTimeout(() => sheet.value?.focus(), 60); }
  else { window.removeEventListener('keydown', key); if (locked) { unlockScroll(); locked = false; } (last as HTMLElement | null)?.focus?.(); }
}, { immediate: true });
onBeforeUnmount(() => { window.removeEventListener('keydown', key); if (locked) { unlockScroll(); locked = false; } });
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-root">
        <div class="scrim" @click="close" />
        <aside ref="sheet" tabindex="-1" class="sheet" :style="{ width: `min(${width}px, 100vw)` }" role="dialog" aria-modal="true" :aria-label="title">
          <header class="dh">
            <div class="grow">
              <div v-if="eyebrow" class="label">{{ eyebrow }}</div>
              <h2 v-if="title" class="h2 ellipsis">{{ title }}</h2>
              <slot name="head" />
            </div>
            <slot name="actions" />
            <button class="x" type="button" aria-label="Close" @click="close"><Icon name="close" :size="16" /></button>
          </header>
          <div class="db"><slot /></div>
          <footer v-if="$slots.footer" class="df"><slot name="footer" /></footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* no-drag: over the top bar (a window drag area) a click on the scrim must close, not drag the window */
.drawer-root { position: fixed; inset: 0; z-index: 800; -webkit-app-region: no-drag; }
.scrim { position: absolute; inset: 0; background: var(--scrim); }
.sheet:focus { outline: none; }
.sheet { position: absolute; top: 0; right: 0; bottom: 0; background: var(--bg); border-left: 1px solid var(--line); box-shadow: var(--shadow-3); display: flex; flex-direction: column; }
/* the sheet runs to the window's top edge: on Windows the header starts under the
   title-bar buttons so its own close button never sits beside (or under) them */
.dh { display: flex; align-items: flex-start; gap: 10px; padding: max(22px, calc(var(--wc-h) + 10px)) 24px 18px; border-bottom: 1px solid var(--line); }
.dh .label { margin-bottom: 6px; }
.x { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 50%; color: var(--muted); transition: background-color 200ms, color 200ms, transform 300ms var(--ease-out); }
.x:hover { background: var(--panel-2); color: var(--fg); transform: rotate(90deg); }
.db { flex: 1; overflow-y: auto; padding: 22px 24px 32px; --table-top: 0px; }
.df { display: flex; gap: 8px; justify-content: flex-end; padding: 14px 24px; border-top: 1px solid var(--line); background: var(--bg-elev); flex-wrap: wrap; }
.db { overscroll-behavior: contain; min-width: 0; overflow-x: hidden; }
@media (max-width: 560px) {
  .sheet { border-left: 0; }
  .dh { padding: max(16px, calc(var(--wc-h) + 8px)) 16px 14px; flex-wrap: wrap; }
  /* the title gets the whole first line; any header actions drop under it */
  .dh > .grow { flex: 1 1 calc(100% - 100px); }
  .dh > :deep(.btn) { order: 1; }
  .db { padding: 18px 16px calc(28px + env(safe-area-inset-bottom)); }
  .df { padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); }
  .x { width: 38px; height: 38px; margin: -4px -6px 0 0; }
}
</style>
