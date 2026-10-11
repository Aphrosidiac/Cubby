<script setup lang="ts">
import { computed } from 'vue';
import type { Platform } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';

/**
 * One glyph per platform, drawn on the same 24px grid as the FF icon set. Monochrome
 * (currentColor) by default so it sits quietly in tables; `colored` uses the platform's colour.
 */
const props = withDefaults(defineProps<{ platform: Platform | string; size?: number; colored?: boolean; title?: string }>(), { size: 16 });

const GLYPHS: Record<string, { d: string; mode: 'fill' | 'stroke'; evenodd?: boolean }> = {
  instagram: { mode: 'stroke', d: 'M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17.2 6.8h.01' },
  facebook: { mode: 'fill', d: 'M13.6 21v-7.9h2.7l.4-3.2h-3.1V7.9c0-.9.3-1.5 1.6-1.5H17V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.3H7.9v3.2h2.7V21z' },
  tiktok: { mode: 'fill', d: 'M16.4 3c.3 2.2 1.7 3.6 3.9 3.8V10c-1.5 0-2.8-.4-3.9-1.2v6.3c0 3.2-2.6 5.7-5.7 5.7S5 18.3 5 15.1s2.6-5.7 5.7-5.7c.3 0 .6 0 .9.1v3.3a2.5 2.5 0 1 0 1.6 2.3V3z' },
  youtube: { mode: 'fill', evenodd: true, d: 'M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z' },
  x: { mode: 'fill', d: 'M17.6 3.5h3l-6.6 7.5 7.7 9.5h-6l-4.7-6.1-5.4 6.1h-3l7-8L2.3 3.5h6.2l4.3 5.6zm-1 15.3h1.7L7.5 5.1H5.7z' },
  linkedin: { mode: 'fill', evenodd: true, d: 'M4.5 3A1.5 1.5 0 0 0 3 4.5v15A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5v-15A1.5 1.5 0 0 0 19.5 3zM8.3 18H5.7V9.8h2.6zM7 8.7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM18.3 18h-2.6v-4c0-1 0-2.2-1.4-2.2s-1.6 1.1-1.6 2.1V18h-2.6V9.8h2.5v1.1h.1a2.7 2.7 0 0 1 2.5-1.3c2.6 0 3.1 1.7 3.1 4z' },
  threads: { mode: 'stroke', d: 'M16.6 10.9C16.2 8.6 14.6 7.5 12.3 7.5c-1.9 0-3.3.9-3.9 2.3M12 21c-5 0-8-3.4-8-9s3-9 8-9c4.1 0 6.8 2.2 7.7 5.8M15.2 12.4c0 2.4-1.3 3.8-3.2 3.8-1.5 0-2.6-.8-2.6-2.1 0-1.5 1.4-2.3 3.4-2.3 3.4 0 6 1.1 6 4.2 0 2.8-2.5 5-6.8 5' },
  custom: { mode: 'stroke', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z' }
};
const g = computed(() => GLYPHS[props.platform] ?? GLYPHS.custom);
const name = computed(() => props.title ?? PLATFORM_SPECS[props.platform as Platform]?.name ?? String(props.platform));
// platform blacks (X, TikTok, Threads) would vanish on Ink, so they take the text colour
const color = computed(() => {
  if (!props.colored) return undefined;
  const c = PLATFORM_SPECS[props.platform as Platform]?.color;
  return !c || /^#(000000|111111)$/i.test(c) ? 'var(--fg)' : c;
});
</script>

<template>
  <svg class="pi" :width="size" :height="size" viewBox="0 0 24 24" role="img" :aria-label="name" :style="color ? { color } : undefined"
    :fill="g.mode === 'fill' ? 'currentColor' : 'none'" :stroke="g.mode === 'stroke' ? 'currentColor' : 'none'" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path :d="g.d" :fill-rule="g.evenodd ? 'evenodd' : undefined" />
  </svg>
</template>

<style scoped>
.pi { flex: none; display: block; }
</style>
