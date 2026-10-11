<script setup lang="ts">
import { computed } from 'vue';
import { initials } from '@/lib/format';
const props = withDefaults(defineProps<{ name?: string | null; size?: number; tone?: 'ink' | 'bone' | 'signal' }>(), { size: 32, tone: 'ink' });
const text = computed(() => initials(props.name));
</script>

<template>
  <span class="av" :class="`t-${tone}`" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` }" :title="name ?? undefined">{{ text }}</span>
</template>

<style scoped>
.av { display: inline-grid; place-items: center; flex: none; border-radius: 50%; font-weight: 600; letter-spacing: .02em; }
.t-ink { background: var(--fg); color: var(--bg); }
.t-bone { background: var(--panel-2); color: var(--fg); box-shadow: inset 0 0 0 1px var(--line); }
.t-signal { background: var(--lime); color: var(--ink); }
</style>
