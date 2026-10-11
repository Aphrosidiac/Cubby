<script setup lang="ts">
import type { Actor } from '@shared/types';
import Icon from '@/components/ui/Icon.vue';

/** Who did it: you · Claude · scheduler · flow · API. Claude gets the one Signal accent. */
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
  <span class="actor" :class="`a-${actor}`"><Icon :name="META[actor]?.icon ?? 'info'" :size="12" />{{ META[actor]?.label ?? actor }}</span>
</template>

<style scoped>
.actor { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 99px; font-size: var(--fs-xs); font-weight: 500; background: var(--panel-2); color: var(--fg-2); white-space: nowrap; }
.a-claude { background: var(--ink); color: var(--lime); }
:global([data-theme='dark']) .a-claude { box-shadow: inset 0 0 0 1px var(--line-strong); }
.a-scheduler { background: var(--info-bg); color: var(--info); }
.a-flow { background: var(--warn-bg); color: var(--warn); }
.a-api { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
</style>
