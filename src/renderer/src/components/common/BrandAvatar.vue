<script setup lang="ts">
import { computed } from 'vue';
import { initials } from '@/lib/format';
import { lightLogo } from './logoTone';

/**
 * A brand's mark: its logo on a quiet plate, or its initials on the brand colour (the same
 * colour that tints its Chrome window). Rounded squares, so brands never read as people.
 */
const props = withDefaults(defineProps<{ brand: { name: string; color?: string | null; logo?: string | null }; size?: number }>(), { size: 32 });
const INK = [11, 11, 10], BONE = [243, 239, 228];
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (rgb: number[]) => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
/**
 * Ink or Bone initials, whichever reads better on the brand colour. Mid-tone colours where neither
 * reaches 4.5:1 (e.g. #b45309) get their plate nudged toward the far end just enough to pass,
 * so the initials always read and the colour still looks like the brand's.
 */
const plate = computed(() => {
  const m = /^#?([0-9a-f]{6})$/i.exec(props.brand.color || '#8b8981');
  if (!m) return { bg: props.brand.color || '#8b8981', fg: '#f3efe4' };
  const n = parseInt(m[1], 16);
  const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const useInk = ratio(base, INK) > ratio(base, BONE);
  const text = useInk ? INK : BONE;
  let bg = base;
  for (let t = 0.04; ratio(bg, text) < 4.6 && t <= 0.6; t += 0.04) bg = mix(base, useInk ? [255, 255, 255] : [0, 0, 0], t);
  return { bg: hex(bg), fg: hex(text) };
});
const bg = computed(() => plate.value.bg);
const fg = computed(() => plate.value.fg);
const radius = computed(() => Math.max(4, Math.round(props.size * 0.26)));
const inkPlate = computed(() => !!props.brand.logo && lightLogo(props.brand.logo) === true);
</script>

<template>
  <span class="ba" :class="{ logo: !!brand.logo, 'ink-plate': inkPlate }" :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${radius}px`, background: brand.logo ? undefined : bg, color: fg, fontSize: `${Math.max(10, Math.round(size * 0.38))}px` }" :title="brand.name">
    <img v-if="brand.logo" :src="brand.logo" alt="" draggable="false" />
    <span v-else>{{ initials(brand.name) || '?' }}</span>
  </span>
</template>

<style scoped>
.ba { display: inline-grid; place-items: center; flex: none; overflow: hidden; font-weight: 600; letter-spacing: .01em; line-height: 1; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .08); user-select: none; }
/* (an ancestor selector needs no :global — `:global(x) .y` compiles to a bare global `x { … }`) */
[data-theme='dark'] .ba:not(.logo) { box-shadow: inset 0 0 0 1px rgb(243 239 228 / .3); }
.ba.logo { background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
/* a white mark on transparency: an Ink plate, or it would vanish on the white one */
.ba.logo.ink-plate { background: #0b0b0a; box-shadow: inset 0 0 0 1px rgb(243 239 228 / .18); }
.ba img { width: 100%; height: 100%; object-fit: contain; padding: 12%; }
</style>
