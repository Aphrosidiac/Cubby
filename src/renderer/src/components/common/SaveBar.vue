<script setup lang="ts">
import Btn from '@/components/ui/Btn.vue';

/** Sticky "unsaved changes" bar: slides up when a form is dirty; Discard / Save. Ctrl+S is the caller's. */
defineProps<{ show: boolean; busy?: boolean; disabled?: boolean; label?: string; saveLabel?: string }>();
defineEmits<{ save: []; discard: [] }>();
</script>

<template>
  <Transition name="savebar">
    <div v-if="show" class="sb" role="region" aria-label="Unsaved changes">
      <span class="d" />
      <span class="small grow">{{ label ?? 'Unsaved changes' }}</span>
      <Btn size="sm" variant="subtle" :disabled="busy" @click="$emit('discard')">Discard</Btn>
      <Btn size="sm" variant="primary" icon="check" :loading="busy" :disabled="disabled" @click="$emit('save')">{{ saveLabel ?? 'Save changes' }}</Btn>
    </div>
  </Transition>
</template>

<style scoped>
.sb { position: sticky; bottom: 16px; z-index: 50; display: flex; align-items: center; gap: 10px; margin-top: 24px; padding: 8px 8px 8px 16px; border-radius: 12px; background: var(--ink); color: var(--bone); box-shadow: var(--shadow-3); }
[data-theme='dark'] .sb { background: #1c1c1a; border: 1px solid #2a2a27; }
.sb :deep(.v-subtle) { color: rgba(243, 239, 228, .8); }
.sb :deep(.v-subtle .sweep) { background: rgba(243, 239, 228, .1); }
/* the bar is Ink in both themes: its primary action is the inverse pill (Bone on Ink) */
.sb :deep(.v-primary) { background: var(--bone); color: var(--ink); }
.sb :deep(.v-primary .sweep) { background: #fff; }
.d { width: 7px; height: 7px; border-radius: 50%; background: var(--lime); }
.savebar-enter-active { transition: opacity 260ms var(--ease-out), transform 420ms var(--ease-out); }
.savebar-leave-active { transition: opacity 160ms var(--ease-cut), transform 160ms var(--ease-cut); }
.savebar-enter-from, .savebar-leave-to { opacity: 0; transform: translateY(12px); }
</style>
