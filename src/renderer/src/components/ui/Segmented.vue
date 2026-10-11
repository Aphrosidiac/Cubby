<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { useOverflowEdges } from '@/composables/overflow';

/** Pill toggle with a sliding highlight — the control from ffdev.studio's bottom nav. */
const props = withDefaults(defineProps<{ modelValue: string; options: { value: string; label?: string; icon?: string; count?: number | null; /** accessible name + tooltip for icon-only options */ title?: string }[]; size?: 'sm' | 'md' }>(), { size: 'md' });
defineEmits<{ 'update:modelValue': [v: string] }>();
const root = ref<HTMLElement | null>(null);
const hl = ref({ x: 0, w: 0, ready: false });
/** The highlight is at rest on the active pill (not mid-slide). */
const settled = ref(true);
/** The first placement jumps there (no slide in from the left edge). */
const still = ref(true);
let timer = 0;
function measure() {
  const el = root.value?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!el) { hl.value = { ...hl.value, ready: false }; return; }
  const moved = hl.value.ready &&(hl.value.x !== el.offsetLeft || hl.value.w !== el.offsetWidth);
  hl.value = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
  if (still.value) requestAnimationFrame(() => requestAnimationFrame(() => { still.value = false; }));
  else if (moved) { settled.value = false; clearTimeout(timer); timer = window.setTimeout(() => { settled.value = true; }, 640); }
  edges.reveal(el, !first); first = false;
}
const edges = useOverflowEdges(root);
let first = true;
onMounted(() => { void nextTick(measure); document.fonts?.ready.then(measure); });
onBeforeUnmount(() => clearTimeout(timer));
watch(() => [props.modelValue, props.options.map(o => `${o.value}${o.count ?? ''}`).join()], () => nextTick(measure));
</script>

<template>
  <div ref="root" class="seg" :class="[`s-${size}`, { 'fade-l': edges.left.value, 'fade-r': edges.right.value, measured: hl.ready, settled, still }]" role="group">
    <span class="hl" :class="{ ready: hl.ready }" :style="{ transform: `translateX(${hl.x}px)`, width: `${hl.w}px` }" />
    <button v-for="o in options" :key="o.value" type="button" :aria-pressed="o.value === modelValue" :aria-label="o.label ? undefined : (o.title ?? o.value)" :title="o.label ? o.title : (o.title ?? o.value)" @click="$emit('update:modelValue', o.value)">
      <Icon v-if="o.icon" :name="o.icon" :size="15" />
      <span v-if="o.label">{{ o.label }}</span>
      <span v-if="o.count !== undefined && o.count !== null" class="count num">{{ o.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.seg { position: relative; display: inline-flex; align-items: center; padding: 4px; gap: 2px; border-radius: var(--r-pill); background: var(--panel-2); border: 1px solid var(--line-soft); max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.seg::-webkit-scrollbar { display: none; }
.fade-r { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 32px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 32px), transparent); }
.fade-l { -webkit-mask-image: linear-gradient(90deg, transparent, #000 32px); mask-image: linear-gradient(90deg, transparent, #000 32px); }
.fade-l.fade-r { -webkit-mask-image: linear-gradient(90deg, transparent, #000 32px, #000 calc(100% - 32px), transparent); mask-image: linear-gradient(90deg, transparent, #000 32px, #000 calc(100% - 32px), transparent); }
.hl { position: absolute; top: 4px; bottom: 4px; left: 0; border-radius: var(--r-pill); background: var(--fg); opacity: 0; transition: transform 620ms var(--ease-toggle), width 620ms var(--ease-toggle), opacity 200ms; }
.hl.ready { opacity: 1; }
.still .hl { transition: none; }
button { position: relative; z-index: 1; flex: none; display: inline-flex; align-items: center; gap: 6px; border-radius: var(--r-pill); color: var(--fg-2); font-weight: 500; white-space: nowrap; }
/* the labels cross-fade only while the highlight travels; a theme switch flips them at once
   (a lagging label would sit Bone-on-Bone for half a second) */
.measured:not(.settled) button { transition: color 300ms ease-in-out 120ms; }
.s-md button { height: 32px; padding: 0 14px; font-size: var(--fs-base); }
.s-sm button { height: 26px; padding: 0 11px; font-size: var(--fs-sm); }
@media (pointer: coarse) { .s-md button { height: 36px; } .s-sm button { height: 32px; padding: 0 12px; } }
button[aria-pressed='true'] { color: var(--bg); }
/* At rest the active pill also carries its own Ink fill, exactly under the highlight, so its
   label never sits on the Bone track (first paint before the highlight is measured, fonts
   loading, a contrast check reading the pill's real background). The fill is dropped while the
   highlight slides and comes back when it settles, so it is never seen apart from it. */
.seg:not(.measured) button[aria-pressed='true'], .settled button[aria-pressed='true'] { background-color: var(--fg); }
/* the strip scrolls (overflow) — an outside ring would be cut; ring the pill from inside */
button:focus-visible { outline: 2px solid var(--fg); outline-offset: -2px; box-shadow: none; }
button[aria-pressed='true']:focus-visible { outline-color: var(--lime); }
button:not([aria-pressed='true']):hover { color: var(--fg); }
.count { font-family: var(--mono); font-size: var(--fs-2xs); min-width: 18px; height: 18px; padding: 0 5px; display: inline-grid; place-items: center; border-radius: 99px; background: color-mix(in srgb, currentColor 14%, transparent); }
button[aria-pressed='true'] .count { background: var(--lime); color: var(--ink); }
</style>
