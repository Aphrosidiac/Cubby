<script setup lang="ts">
import { computed } from 'vue';
import Chip from '@/components/ui/Chip.vue';
import { LIVE_STATUS, postStatus, runStatus } from './meta';

/**
 * A post or run status as the kit chip, with the words and tone from meta.ts — so a status reads the
 * same on every posting and flow screen. In-progress statuses ("Running") get a softly pulsing dot in
 * the chip's own colour (never lime text).
 */
const props = defineProps<{ status: string; of?: 'post' | 'run'; size?: 'sm' | 'md' }>();
const s = computed(() => (props.of === 'run' ? runStatus(props.status) : postStatus(props.status)));
</script>

<template>
  <Chip :tone="s.tone" :size="size" :dot="LIVE_STATUS.has(status)" :class="{ pulse: LIVE_STATUS.has(status) }">{{ s.label }}</Chip>
</template>

<style scoped>
.pulse :deep(.d)::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: currentColor; animation: ff-pulse 1.8s var(--ease-out) infinite; }
@media (prefers-reduced-motion: reduce) { .pulse :deep(.d)::after { animation: none; } }
</style>
