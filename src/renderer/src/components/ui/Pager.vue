<script setup lang="ts">
import Icon from './Icon.vue';
defineProps<{ page: number; pages: number; total: number; limit: number }>();
defineEmits<{ 'update:page': [p: number] }>();
</script>

<template>
  <div v-if="pages > 1" class="pager">
    <span class="muted small num">{{ (page - 1) * limit + 1 }}–{{ Math.min(page * limit, total) }} of {{ total }}</span>
    <div class="row gap-1">
      <button class="pb" :disabled="page <= 1" aria-label="Previous page" @click="$emit('update:page', page - 1)"><Icon name="chevron-left" :size="15" /></button>
      <span class="num small">{{ page }} / {{ pages }}</span>
      <button class="pb" :disabled="page >= pages" aria-label="Next page" @click="$emit('update:page', page + 1)"><Icon name="chevron" :size="15" /></button>
    </div>
  </div>
</template>

<style scoped>
.pager { display: flex; justify-content: space-between; align-items: center; padding: 16px 4px; }
.pb { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--line); transition: border-color 200ms, background-color 200ms; }
.pb:hover:not(:disabled) { border-color: var(--fg); background: var(--panel-2); }
.pb:disabled { opacity: .35; cursor: not-allowed; }
</style>
