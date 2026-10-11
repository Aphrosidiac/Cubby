<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Icon from './Icon.vue';
import type { MenuItem } from './types';

/** Overflow / action menu. Opens from its trigger slot; arrow keys move; Esc closes. */
const props = withDefaults(defineProps<{ items: MenuItem[]; align?: 'left' | 'right'; width?: number }>(), { align: 'right', width: 220 });
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const router = useRouter();
// Kept on screen: a menu that would run off an edge slides back in; one that
// would fall below the fold opens upward. (Matters on phones, where a "…"
// button can sit at either edge.)
const pop = ref<HTMLElement | null>(null);
const fit = ref({ dx: 0, up: false, w: props.width });
async function place() {
  fit.value = { dx: 0, up: false, w: Math.min(props.width, document.documentElement.clientWidth - 16) };
  await nextTick();
  const el = pop.value; if (!el) return;
  const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, t = root.value!.getBoundingClientRect();
  const dx = r.left < 8 ? 8 - r.left : r.right > vw - 8 ? vw - 8 - r.right : 0;
  const up = r.bottom > window.innerHeight - 8 && t.top - r.height - 14 > 0;
  fit.value = { ...fit.value, dx, up };
}
const outside = (e: MouseEvent) => { if (root.value && !root.value.contains(e.target as Node)) open.value = false; };
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
    const els = [...(root.value?.querySelectorAll<HTMLElement>('.mi:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length;
    els[j]?.focus();
  }
}
// Escape while focus is somewhere else (opened by mouse, pointer moved on) still closes it.
const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !root.value?.contains(e.target as Node)) open.value = false; };
watch(open, o => {
  if (o) { void place(); setTimeout(() => document.addEventListener('click', outside), 0); document.addEventListener('keydown', esc); setTimeout(() => root.value?.querySelector<HTMLElement>('.mi')?.focus(), 30); }
  else { document.removeEventListener('click', outside); document.removeEventListener('keydown', esc); }
});
onBeforeUnmount(() => { document.removeEventListener('click', outside); document.removeEventListener('keydown', esc); });
function pick(it: MenuItem) {
  if (it.disabled) return;
  // focus goes back to the trigger first, so a dialog the item opens returns focus there too
  const hadFocus = !!root.value?.querySelector('.menu')?.contains(document.activeElement);
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
    <Transition name="pop">
      <div v-if="open" ref="pop" class="menu" :class="[align, { up: fit.up }]" :style="{ width: `${fit.w}px`, translate: `${fit.dx}px 0` }" role="menu">
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
  </div>
</template>

<style scoped>
.menu-root { position: relative; display: inline-block; }
.menu { position: absolute; top: calc(100% + 6px); z-index: 600; padding: 6px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow-2); transform-origin: top right; }
.menu.left { left: 0; transform-origin: top left; } .menu.right { right: 0; }
.menu.up { top: auto; bottom: calc(100% + 6px); transform-origin: bottom right; }
@media (pointer: coarse) { .mi { padding: 12px 12px; font-size: var(--fs-base); } }
.mi { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 6px; font-size: var(--fs-base); text-align: left; color: var(--fg-2); transition: background-color 140ms, color 140ms, padding-left 240ms var(--ease-out); animation: ff-rise .36s var(--ease-out) backwards; animation-delay: calc(var(--i) * 18ms); }
.mi:hover:not(:disabled), .mi:focus-visible { background: var(--panel-2); color: var(--fg); padding-left: 13px; outline: none; box-shadow: none; }
.mi:disabled { opacity: .4; cursor: not-allowed; }
.mi.danger, .mi.danger:hover:not(:disabled), .mi.danger:focus-visible { color: var(--bad); }
.mi.danger:hover:not(:disabled), .mi.danger:focus-visible { background: var(--bad-bg); }
.div { height: 1px; background: var(--line); margin: 5px 4px; }
</style>
