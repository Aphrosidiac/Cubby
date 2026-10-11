<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useOverflowEdges } from '@/composables/overflow';

/** Underline tabs; the Ink rule slides to the active tab. */
const props = defineProps<{ modelValue: string; tabs: { value: string; label: string; count?: number | null }[] }>();
defineEmits<{ 'update:modelValue': [v: string] }>();
const root = ref<HTMLElement | null>(null);
const bar = ref({ x: 0, w: 0, ready: false });
const edges = useOverflowEdges(root);
let first = true;
function measure() {
  const el = root.value?.querySelector<HTMLElement>('[aria-selected="true"]');
  if (el) { bar.value = { x: el.offsetLeft, w: el.offsetWidth, ready: true }; edges.reveal(el, !first); first = false; }
}
onMounted(() => { void nextTick(measure); document.fonts?.ready.then(measure); });
watch(() => [props.modelValue, props.tabs.map(t => t.label + (t.count ?? '')).join()], () => nextTick(measure));
</script>

<template>
  <div ref="root" class="tabs" :class="{ 'fade-l': edges.left.value, 'fade-r': edges.right.value }" role="tablist">
    <button v-for="t in tabs" :key="t.value" role="tab" type="button" :aria-selected="t.value === modelValue" @click="$emit('update:modelValue', t.value)">
      {{ t.label }}<span v-if="t.count" class="c num">{{ t.count }}</span>
    </button>
    <span class="bar" :class="{ ready: bar.ready }" :style="{ transform: `translateX(${bar.x}px)`, width: `${bar.w}px` }" />
  </div>
</template>

<style scoped>
.tabs { position: relative; display: flex; gap: 22px; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.fade-r { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent); }
.fade-l { -webkit-mask-image: linear-gradient(90deg, transparent, #000 36px); mask-image: linear-gradient(90deg, transparent, #000 36px); }
.fade-l.fade-r { -webkit-mask-image: linear-gradient(90deg, transparent, #000 36px, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(90deg, transparent, #000 36px, #000 calc(100% - 36px), transparent); }
@media (pointer: coarse) { button { padding: 13px 0 14px; } }
button { position: relative; padding: 12px 0 13px; font-size: var(--fs-base); font-weight: 500; color: var(--muted); transition: color 240ms var(--ease-out); white-space: nowrap; }
button:hover, button[aria-selected='true'] { color: var(--fg); }
.c { margin-left: 7px; font-family: var(--mono); font-size: var(--fs-2xs); color: var(--muted); }
.bar { position: absolute; bottom: -1px; left: 0; height: 2px; background: var(--fg); opacity: 0; transition: transform 560ms var(--ease-out), width 560ms var(--ease-out), opacity 200ms; }
.bar.ready { opacity: 1; }
</style>
