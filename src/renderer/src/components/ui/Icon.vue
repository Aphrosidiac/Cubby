<script setup lang="ts">
import { computed } from 'vue';
import { ICONS } from './icons';

const props = withDefaults(defineProps<{ name: string; size?: number; stroke?: number }>(), { size: 18, stroke: 1.5 });
const d = computed(() => ICONS[props.name] ?? ICONS.info);
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="stroke" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" class="icon"><path :d="d" /></svg>
</template>

<style scoped>
.icon { flex: none; }
</style>
