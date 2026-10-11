<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useOverflowEdges } from '@/composables/overflow';

/** Underline tabs; the Ink rule slides to the active tab. */
const props = defineProps<{ modelValue: string; tabs: { value: string; label: string; count?: number | null }[] }>();
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();
const root = ref<HTMLElement | null>(null);
const bar = ref({ x: 0, w: 0, ready: false });
const edges = useOverflowEdges(root);
let first = true;
function measure() {
  const el = root.value?.querySelector<HTMLElement>('[aria-selected="true"]');
  if (el) { bar.value = { x: el.offsetLeft, w: el.offsetWidth, ready: true }; edges.reveal(el, !first); first = false; }
}
/** Arrow keys move between tabs (and select), Home / End jump — the tablist keyboard model. */
function key(e: KeyboardEvent) {
  const i = props.tabs.findIndex(t => t.value === props.modelValue);
  const n = props.tabs.length;
  const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
  if (j < 0 || !n) return;
  e.preventDefault();
  emit('update:modelValue', props.tabs[j].value);
  void nextTick(() => root.value?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus());
}
onMounted(() => { void nextTick(measure); document.fonts?.ready.then(measure); });
watch(() => [props.modelValue, props.tabs.map(t => t.label + (t.count ?? '')).join()], () => nextTick(measure));
</script>

<template>
  <div ref="root" class="tabs" :class="{ 'fade-l': edges.left.value, 'fade-r': edges.right.value }" role="tablist">
    <button v-for="t in tabs" :key="t.value" role="tab" type="button" :aria-selected="t.value === modelValue" :tabindex="t.value === modelValue ? 0 : -1" @click="emit('update:modelValue', t.value)" @keydown="key">
      {{ t.label }}<span v-if="t.count" class="c num">{{ t.count }}</span>
    </button>
    <span class="bar" :class="{ ready: bar.ready }" :style="{ transform: `translateX(${bar.x}px)`, width: `${bar.w}px` }" />
  </div>
</template>

<style scoped>
.tabs { position: relative; display: flex; gap: 22px; padding: 0 6px; margin: 0 -6px; background: linear-gradient(var(--line), var(--line)) no-repeat 6px 100% / calc(100% - 12px) 1px; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.fade-r { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent); }
.fade-l { -webkit-mask-image: linear-gradient(90deg, transparent, #000 36px); mask-image: linear-gradient(90deg, transparent, #000 36px); }
.fade-l.fade-r { -webkit-mask-image: linear-gradient(90deg, transparent, #000 36px, #000 calc(100% - 36px), transparent); mask-image: linear-gradient(90deg, transparent, #000 36px, #000 calc(100% - 36px), transparent); }
@media (pointer: coarse) { button { padding: 13px 0 14px; } }
button { position: relative; padding: 12px 0 13px; font-size: var(--fs-base); font-weight: 500; color: var(--muted); transition: color 240ms var(--ease-out); white-space: nowrap; }
button:hover, button[aria-selected='true'] { color: var(--fg); }
.c { margin-left: 7px; font-family: var(--mono); font-size: var(--fs-2xs); color: var(--muted); }
/* the rule sits inside the strip (bottom: 0): at -1px it hung outside a scroll container */
.bar { position: absolute; bottom: 0; left: 0; height: 2px; background: var(--fg); opacity: 0; transition: transform 560ms var(--ease-out), width 560ms var(--ease-out), opacity 200ms; }
.bar.ready { opacity: 1; }
/* The strip scrolls sideways, so an outline would be cut: the keyboard ring is drawn inside
   the strip's 6px side gutters (the hairline is a background, inset to the same gutters). */
button:focus-visible { outline: none; box-shadow: none; color: var(--fg); }
button:focus-visible::after { content: ''; position: absolute; inset: 6px -6px; border: 2px solid var(--fg); border-radius: 6px; pointer-events: none; }
</style>
