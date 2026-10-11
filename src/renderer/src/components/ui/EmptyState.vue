<script setup lang="ts">
import Icon from './Icon.vue';
defineProps<{ icon?: string; title: string; body?: string; compact?: boolean }>();
</script>

<template>
  <div class="ff-empty" :class="{ compact }">
    <div class="art" aria-hidden="true">
      <Icon v-if="icon" :name="icon" :size="compact ? 18 : 22" class="ic" />
    </div>
    <h3 class="h3">{{ title }}</h3>
    <p v-if="body" class="muted small">{{ body }}</p>
    <div v-if="$slots.default" class="acts"><slot /></div>
  </div>
</template>

<style scoped>
.ff-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 56px 20px; gap: 8px; animation: ff-rise .7s var(--ease-out) backwards; }
.ff-empty.compact { padding: 28px 16px; }
.art { position: relative; width: 64px; height: 64px; display: grid; place-items: center; margin-bottom: 10px; border-radius: 50%; border: 1px dashed var(--line-strong); }
.compact .art { width: 46px; height: 46px; margin-bottom: 4px; }
.ic { color: var(--muted); }
p { max-width: 380px; line-height: 1.55; }
.acts { margin-top: 14px; display: flex; gap: 8px; }
</style>
