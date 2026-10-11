<script setup lang="ts">
import { computed } from 'vue';
import { STATUS } from './status';

/**
 * Status chip. Pass `status` (a system status like OVERDUE / ACTIVE) and it
 * finds its words and tone; or pass `tone` + a label in the slot. The chip
 * cross-fades when a status changes live.
 */
const props = defineProps<{ status?: string | null; tone?: string; dot?: boolean; size?: 'sm' | 'md' }>();
const s = computed(() => (props.status ? STATUS[props.status] : null));
const tone = computed(() => props.tone ?? s.value?.tone ?? 'neutral');
</script>

<template>
  <Transition name="swap" mode="out-in">
    <span :key="status ?? tone" class="chip" :class="[`t-${tone}`, size === 'sm' ? 'sm' : '']">
      <span v-if="dot !== false" class="d" :class="{ live: tone === 'signal' }" />
      <slot>{{ s?.label ?? status }}</slot>
    </span>
  </Transition>
</template>

<style scoped>
.chip { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px 0 8px; border-radius: var(--r-pill); font-size: var(--fs-xs); font-weight: 500; letter-spacing: .01em; white-space: nowrap; background: var(--panel-2); color: var(--fg-2); }
.chip.sm { height: 19px; font-size: var(--fs-2xs); padding: 0 7px; gap: 5px; }
.d { position: relative; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.t-good { background: var(--good-bg); color: var(--good); }
.t-warn { background: var(--warn-bg); color: var(--warn); }
.t-bad { background: var(--bad-bg); color: var(--bad); }
.t-info { background: var(--info-bg); color: var(--info); }
.t-muted { background: transparent; color: var(--muted); box-shadow: inset 0 0 0 1px var(--line); }
.t-ink { background: var(--fg); color: var(--bg); }
.t-signal { background: var(--ink); color: var(--lime); }
.t-signal .d { background: var(--lime); }
.live::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--lime); animation: ff-pulse 1.8s var(--ease-out) infinite; }
</style>
