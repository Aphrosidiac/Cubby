<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { useOverflowEdges } from '@/composables/overflow';

/** Pill toggle with a sliding highlight — the control from ffdev.studio's bottom nav. */
const props = withDefaults(defineProps<{ modelValue: string; options: { value: string; label?: string; icon?: string; count?: number | null }[]; size?: 'sm' | 'md' }>(), { size: 'md' });
defineEmits<{ 'update:modelValue': [v: string] }>();
const root = ref<HTMLElement | null>(null);
const hl = ref({ x: 0, w: 0, ready: false });
function measure() {
  const el = root.value?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!el) { hl.value = { ...hl.value, ready: false }; return; }
  hl.value = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
  edges.reveal(el, !first); first = false;
}
const edges = useOverflowEdges(root);
let first = true;
onMounted(() => { void nextTick(measure); document.fonts?.ready.then(measure); });
watch(() => [props.modelValue, props.options.map(o => `${o.value}${o.count ?? ''}`).join()], () => nextTick(measure));
</script>

<template>
  <div ref="root" class="seg" :class="[`s-${size}`, { 'fade-l': edges.left.value, 'fade-r': edges.right.value }]" role="group">
    <span class="hl" :class="{ ready: hl.ready }" :style="{ transform: `translateX(${hl.x}px)`, width: `${hl.w}px` }" />
    <button v-for="o in options" :key="o.value" type="button" :aria-pressed="o.value === modelValue" @click="$emit('update:modelValue', o.value)">
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
button { position: relative; z-index: 1; flex: none; display: inline-flex; align-items: center; gap: 6px; border-radius: var(--r-pill); color: var(--fg-2); font-weight: 500; transition: color 300ms ease-in-out 120ms; white-space: nowrap; }
.s-md button { height: 32px; padding: 0 14px; font-size: var(--fs-base); }
.s-sm button { height: 26px; padding: 0 11px; font-size: var(--fs-sm); }
@media (pointer: coarse) { .s-md button { height: 36px; } .s-sm button { height: 32px; padding: 0 12px; } }
button[aria-pressed='true'] { color: var(--bg); }
button:not([aria-pressed='true']):hover { color: var(--fg); }
.count { font-family: var(--mono); font-size: var(--fs-2xs); min-width: 18px; height: 18px; padding: 0 5px; display: inline-grid; place-items: center; border-radius: 99px; background: color-mix(in srgb, currentColor 14%, transparent); }
button[aria-pressed='true'] .count { background: var(--lime); color: var(--ink); }
</style>
