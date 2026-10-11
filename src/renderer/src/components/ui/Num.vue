<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { rm, pct } from '@/lib/format';

/**
 * A number that counts to its value (and re-counts when it changes live).
 * format: money (sen) | int | pct (0–1) | raw.
 */
const props = withDefaults(defineProps<{ value: number | null | undefined; format?: 'money' | 'int' | 'pct' | 'raw'; duration?: number; decimals?: boolean; compact?: boolean; sign?: boolean }>(), { format: 'money', duration: 1100 });
const shown = ref(0);
let raf = 0;
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(to: number) {
  cancelAnimationFrame(raf);
  const from = shown.value;
  if (reduce || from === to) { shown.value = to; return; }
  const t0 = performance.now();
  const dur = props.duration * (from === 0 ? 1 : 0.7);
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 4);
    shown.value = from + (to - from) * e;
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
onMounted(() => animate(props.value ?? 0));
watch(() => props.value, v => animate(v ?? 0));
onBeforeUnmount(() => cancelAnimationFrame(raf));
const text = () => {
  if (props.value === null || props.value === undefined) return '—';
  const v = shown.value;
  if (props.format === 'money') return rm(Math.round(v), { decimals: props.decimals, compact: props.compact, sign: props.sign });
  if (props.format === 'pct') return pct(v, v < 0.1 && v > 0 ? 1 : 0);
  if (props.format === 'int') return Math.round(v).toLocaleString('en-MY');
  return v.toFixed(1);
};
</script>

<template><span class="num-anim money">{{ text() }}</span></template>
