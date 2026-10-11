<script setup lang="ts">
import { computed } from 'vue';
import { initials } from '@/lib/format';

/**
 * A brand's mark: its logo on a quiet plate, or its initials on the brand colour (the same
 * colour that tints its Chrome window). Rounded squares, so brands never read as people.
 */
const props = withDefaults(defineProps<{ brand: { name: string; color?: string | null; logo?: string | null }; size?: number }>(), { size: 32 });
const bg = computed(() => props.brand.color || '#8b8981');
/** Ink or Bone text, whichever reads on the brand colour. */
const fg = computed(() => {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.value);
  if (!m) return '#f3efe4';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#0b0b0a' : '#f3efe4';
});
const radius = computed(() => Math.max(4, Math.round(props.size * 0.26)));
</script>

<template>
  <span class="ba" :class="{ logo: !!brand.logo }" :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${radius}px`, background: brand.logo ? undefined : bg, color: fg, fontSize: `${Math.max(10, Math.round(size * 0.38))}px` }" :title="brand.name">
    <img v-if="brand.logo" :src="brand.logo" alt="" draggable="false" />
    <span v-else>{{ initials(brand.name) || '?' }}</span>
  </span>
</template>

<style scoped>
.ba { display: inline-grid; place-items: center; flex: none; overflow: hidden; font-weight: 600; letter-spacing: .01em; line-height: 1; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .08); user-select: none; }
:global([data-theme='dark']) .ba:not(.logo) { box-shadow: inset 0 0 0 1px rgb(243 239 228 / .16); }
.ba.logo { background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
.ba img { width: 100%; height: 100%; object-fit: contain; padding: 12%; }
</style>
