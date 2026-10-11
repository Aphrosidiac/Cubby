<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(defineProps<{ values: number[]; stroke?: string }>(), { stroke: 'currentColor' });
const W = 120, H = 36;
const d = computed(() => {
  const v = props.values.length ? props.values : [0];
  const max = Math.max(...v), min = Math.min(...v, 0);
  const span = max - min || 1;
  return v.map((x, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, v.length - 1)) * W},${H - 3 - ((x - min) / span) * (H - 6)}`).join(' ');
});
const area = computed(() => `${d.value} L${W},${H} L0,${H} Z`);
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="spark" aria-hidden="true">
    <path :d="area" class="a" />
    <path :d="d" class="l" />
  </svg>
</template>

<style scoped>
.spark { overflow: visible; color: var(--fg); }
.spark { animation: reveal 1.4s var(--ease-out) .2s both; }
.l { fill: none; stroke: currentColor; stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.a { fill: currentColor; opacity: .06; animation: ff-fade 1s var(--ease-out) .6s backwards; }
@keyframes reveal { from { clip-path: inset(-20% 100% -20% 0); } to { clip-path: inset(-20% 0 -20% 0); } }
</style>
