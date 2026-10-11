<script setup lang="ts">
import Icon from './Icon.vue';

/**
 * Editorial page header: mono eyebrow, a large title that rises out of a mask,
 * a quiet line of context, actions on the right. No breadcrumbs — `back` is a
 * single link up.
 */
defineProps<{ eyebrow?: string; title: string; back?: { to: string; label: string } }>();
</script>

<template>
  <header class="page-header">
    <div class="left">
      <RouterLink v-if="back" :to="back.to" class="back"><Icon name="arrow-left" :size="14" /><span>{{ back.label }}</span></RouterLink>
      <div v-if="eyebrow" class="label eyebrow">{{ eyebrow }}</div>
      <h1 class="display title"><span class="mask"><span>{{ title }}</span></span></h1>
      <div v-if="$slots.default" class="sub"><slot /></div>
    </div>
    <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s5); padding-bottom: var(--s5); margin-bottom: var(--s6); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.left { min-width: 0; flex: 1 1 420px; }
.eyebrow { margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
/* A real "/": an upright bar leaning like the //FF slash (12.5° off vertical). */
.eyebrow::before { content: ''; width: 1.5px; height: 11px; background: var(--fg); transform: skewX(calc(var(--slash) * -1)); }
.title { overflow-wrap: anywhere; }
.sub { margin-top: 12px; color: var(--muted); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--fs-base); }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.back { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--muted); margin-bottom: 14px; transition: color 200ms, gap 300ms var(--ease-out); }
.back:hover { color: var(--fg); gap: 9px; }
@media (pointer: coarse) { .back { padding: 10px 12px 10px 0; margin: -10px 0 4px; } }
/* Phones: the actions become a full-width bar — buttons share each row evenly, so a
   lone "…" never ends up stranded on a line of its own. */
@media (max-width: 560px) { .actions { width: 100%; gap: 6px; } .actions > :deep(.btn) { flex: 1 1 auto; padding-left: 12px; padding-right: 12px; } .actions > :deep(.btn .inner) { gap: 6px; } .actions > :deep(.menu-root) { flex: none; } }
</style>
