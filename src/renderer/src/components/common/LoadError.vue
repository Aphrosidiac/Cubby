<script setup lang="ts">
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';

/** What a screen shows when its data could not load: the reason, and a retry. Never a blank screen. */
defineProps<{ error: string; title?: string; compact?: boolean }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="le" :class="{ compact }" role="alert">
    <Icon name="warn" :size="compact ? 16 : 20" class="ic" />
    <div class="grow">
      <div class="strong small">{{ title ?? 'Could not load this' }}</div>
      <div class="tiny muted msg">{{ error }}</div>
    </div>
    <Btn size="sm" icon="refresh" @click="$emit('retry')">Retry</Btn>
  </div>
</template>

<style scoped>
.le { display: flex; align-items: center; gap: 14px; padding: 18px 20px; border: 1px dashed color-mix(in srgb, var(--bad) 45%, var(--line)); border-radius: var(--r-lg); background: color-mix(in srgb, var(--bad-bg) 50%, transparent); }
.le.compact { padding: 12px 14px; }
.ic { color: var(--bad); }
.msg { overflow-wrap: anywhere; }
</style>
