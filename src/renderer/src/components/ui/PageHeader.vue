<script setup lang="ts">
import Icon from './Icon.vue';

/**
 * Editorial page header: mono eyebrow, a large title that rises out of a mask, actions on the
 * title's row (their bottom edge on the title's bottom edge, on every page), then up to two quiet
 * lines under it: the default slot is the META line (counts, status chips, "3 posts · Synced"),
 * `description` / #description is the sentence that explains the page. They never share a line.
 * No breadcrumbs — `back` is a single link up.
 */
defineProps<{ eyebrow?: string; title: string; back?: { to: string; label: string }; description?: string }>();
</script>

<template>
  <header class="page-header">
    <div class="ph" :class="{ 'has-actions': !!$slots.actions }">
      <RouterLink v-if="back" :to="back.to" class="back"><Icon name="arrow-left" :size="14" /><span>{{ back.label }}</span></RouterLink>
      <div v-if="eyebrow" class="label eyebrow">{{ eyebrow }}</div>
      <h1 class="display title"><span class="mask"><span>{{ title }}</span></span></h1>
      <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
      <div v-if="$slots.default" class="sub"><slot /></div>
      <p v-if="description || $slots.description" class="desc"><slot name="description">{{ description }}</slot></p>
    </div>
  </header>
</template>

<style scoped>
.page-header { container-type: inline-size; padding-bottom: var(--s5); margin-bottom: var(--s6); border-bottom: 1px solid var(--line); min-width: 0; }
/* Wide: the actions sit on the title's row, their bottom edge on the title's bottom edge, on every
   page; the meta line and the description run full width under both. Narrow (the header under
   760px): one column, and the actions come last, under the text, starting at the left. */
.ph { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "back back" "eyebrow eyebrow" "title actions" "sub sub" "desc desc"; column-gap: var(--s5); align-items: end; }
.back { grid-area: back; justify-self: start; }
.eyebrow { grid-area: eyebrow; justify-self: start; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
/* A real "/": an upright bar leaning like the //FF slash (12.5° off vertical). */
.eyebrow::before { content: ''; width: 1.5px; height: 11px; background: var(--fg); transform: skewX(calc(var(--slash) * -1)); }
.title { grid-area: title; min-width: 0; overflow-wrap: anywhere; text-wrap: balance; }
.actions { grid-area: actions; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
.sub { grid-area: sub; margin-top: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap; font-size: var(--fs-base); text-wrap: pretty; min-width: 0; }
.desc { grid-area: desc; margin-top: 12px; color: var(--muted); font-size: var(--fs-base); line-height: 1.5; max-width: 78ch; text-wrap: pretty; }
.sub + .desc { margin-top: 6px; }
@container (max-width: 760px) {
  .ph { grid-template-columns: minmax(0, 1fr); grid-template-areas: "back" "eyebrow" "title" "sub" "desc" "actions"; }
  .actions { justify-content: flex-start; margin-top: 18px; }
}
.back { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--muted); margin-bottom: 14px; transition: color 200ms, gap 300ms var(--ease-out); }
.back:hover { color: var(--fg); gap: 9px; }
@media (pointer: coarse) { .back { padding: 10px 12px 10px 0; margin: -10px 0 4px; } }
/* Phones: the actions become a full-width bar — buttons share each row evenly, so a
   lone "…" never ends up stranded on a line of its own. */
@media (max-width: 560px) { .actions { width: 100%; gap: 6px; } .actions > :deep(.btn) { flex: 1 1 auto; padding-left: 12px; padding-right: 12px; } .actions > :deep(.btn .inner) { gap: 6px; } .actions > :deep(.menu-root) { flex: none; } }
</style>
