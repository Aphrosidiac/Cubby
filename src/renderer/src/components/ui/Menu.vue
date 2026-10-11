<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Icon from './Icon.vue';
import type { MenuItem } from './types';

/**
 * Overflow / action menu. Opens from its trigger slot; arrow keys move; Esc closes.
 * The popup renders at <body> with fixed coordinates, so a scrolling table, card or drawer
 * around the trigger can never clip it; it follows the trigger while anything scrolls.
 */
const props = withDefaults(defineProps<{ items: MenuItem[]; align?: 'left' | 'right'; width?: number }>(), { align: 'right', width: 220 });
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const router = useRouter();
// Kept on screen: aligned to the trigger's edge, slid back in when it would run off a side,
// opened upward when it would fall below the fold.
const pop = ref<HTMLElement | null>(null);
const pos = ref({ left: 0, top: 0, w: props.width, up: false });
async function place() {
  const t = root.value?.getBoundingClientRect();
  if (!t) return;
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const w = Math.min(props.width, vw - 16);
  await nextTick();
  const h = pop.value?.offsetHeight ?? 0;
  let left = props.align === 'left' ? t.left : t.right - w;
  left = Math.max(8, Math.min(left, vw - 8 - w));
  const up = t.bottom + 6 + h > vh - 8 && t.top - 6 - h > 8;
  pos.value = { left, top: up ? t.top - 6 - h : t.bottom + 6, w, up };
}
const reflow = () => { if (open.value) void place(); };
const inMenu = (n: Node | null) => !!n && (!!root.value?.contains(n) || !!pop.value?.contains(n));
const outside = (e: MouseEvent) => { if (!inMenu(e.target as Node)) open.value = false; };
/** The trigger's own focusable element, to hand focus back to when the menu closes by keyboard. */
const triggerEl = () => root.value?.querySelector<HTMLElement>('.menu-trigger button, .menu-trigger [tabindex], .menu-trigger a') ?? null;
// Keys inside the menu are handled here, before they bubble to a modal / drawer around it
// (Escape closes the menu, not the dialog it sits in).
function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open.value = false; triggerEl()?.focus(); }
  else if (e.key === 'Tab') open.value = false;
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const els = [...(pop.value?.querySelectorAll<HTMLElement>('.mi:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length;
    els[j]?.focus();
  }
}
// Escape while focus is somewhere else (opened by mouse, pointer moved on) still closes it.
const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !inMenu(e.target as Node)) open.value = false; };
const unlisten = () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', reflow, true); window.removeEventListener('resize', reflow); };
watch(open, o => {
  if (o) {
    void place();
    setTimeout(() => document.addEventListener('click', outside), 0);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    setTimeout(() => pop.value?.querySelector<HTMLElement>('.mi')?.focus({ preventScroll: true }), 30);
  } else unlisten();
});
onBeforeUnmount(unlisten);
function pick(it: MenuItem) {
  if (it.disabled) return;
  // focus goes back to the trigger first, so a dialog the item opens returns focus there too
  const hadFocus = !!pop.value?.contains(document.activeElement);
  open.value = false;
  if (hadFocus) triggerEl()?.focus({ preventScroll: true });
  if (it.to) void router.push(it.to);
  else if (it.href && it.download) { const a = document.createElement('a'); a.href = it.href; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }
  else if (it.href) { if (/^(mailto|tel|https?:\/\/wa\.me)/.test(it.href) || it.href.startsWith('mailto:')) location.href = it.href; else window.open(it.href, '_blank', 'noopener'); }
  else it.run?.();
}
defineExpose({ open });
void props;
</script>

<template>
  <div ref="root" class="menu-root" @keydown="onKey">
    <div class="menu-trigger" @click="open = !open"><slot :open="open" /></div>
    <Teleport to="body">
    <Transition name="pop">
      <div v-if="open" ref="pop" class="menu" :class="[align, { up: pos.up }]" :style="{ width: `${pos.w}px`, left: `${pos.left}px`, top: `${pos.top}px` }" role="menu" @keydown="onKey">
        <template v-for="(it, i) in items" :key="i">
          <div v-if="it.divider" class="div" />
          <button v-else class="mi" :class="{ danger: it.danger }" :disabled="it.disabled" role="menuitem" type="button" :style="{ '--i': i }" @click="pick(it)">
            <Icon v-if="it.icon" :name="it.icon" :size="15" />
            <span class="grow">{{ it.label }}</span>
            <span v-if="it.hint" class="kbd keys">{{ it.hint }}</span>
          </button>
        </template>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.menu-root { position: relative; display: inline-block; }
.menu { position: fixed; z-index: 1100; padding: 6px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow-2); transform-origin: top right; -webkit-app-region: no-drag; max-height: calc(100vh - 16px); overflow-y: auto; }
.menu.left { transform-origin: top left; }
.menu.up { transform-origin: bottom right; }
.menu.up.left { transform-origin: bottom left; }
@media (pointer: coarse) { .mi { padding: 12px 12px; font-size: var(--fs-base); } }
.mi { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 6px; font-size: var(--fs-base); text-align: left; color: var(--fg-2); transition: background-color 140ms, color 140ms, padding-left 240ms var(--ease-out); animation: ff-rise .36s var(--ease-out) backwards; animation-delay: calc(var(--i) * 18ms); }
.mi:hover:not(:disabled), .mi:focus-visible { background: var(--panel-2); color: var(--fg); padding-left: 13px; outline: none; box-shadow: none; }
.mi:disabled { opacity: .4; cursor: not-allowed; }
.mi.danger, .mi.danger:hover:not(:disabled), .mi.danger:focus-visible { color: var(--bad); }
.mi.danger:hover:not(:disabled), .mi.danger:focus-visible { background: var(--bad-bg); }
.div { height: 1px; background: var(--line); margin: 5px 4px; }
</style>
