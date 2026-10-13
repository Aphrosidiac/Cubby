<script setup lang="ts">
import type { Actor } from '@shared/types';
import Icon from '@/components/ui/Icon.vue';

/** Who did it: you · Claude · scheduler · flow · API. Claude gets a small lime dot. */
defineProps<{ actor: Actor | string }>();
const META: Record<string, { label: string; icon: string }> = {
  you: { label: 'You', icon: 'users' },
  claude: { label: 'Claude', icon: 'claude' },
  scheduler: { label: 'Scheduler', icon: 'clock' },
  flow: { label: 'Flow', icon: 'flow' },
  api: { label: 'API', icon: 'api' }
};
</script>

<template>
  <span class="actor" :class="`a-${actor}`"><span v-if="actor === 'claude'" class="sig" aria-hidden="true" /><Icon v-else :name="META[actor]?.icon ?? 'info'" :size="12" />{{ META[actor]?.label ?? actor }}</span>
</template>

<style scoped>
/* Neutral chips: who did it is information, not a state — no warning amber, no lime surface.
   Claude keeps one small lime signal dot (rule: lime only as a dot, never a fill or text). */
.actor { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 99px; font-size: var(--fs-xs); font-weight: 500; background: var(--panel-2); color: var(--fg-2); white-space: nowrap; }
.sig { width: 7px; height: 7px; margin: 0 1px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 55%, transparent); flex: none; }
.a-claude { color: var(--fg); box-shadow: inset 0 0 0 1px var(--line-strong); }
.a-api { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
</style>
