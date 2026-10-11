<script setup lang="ts">
import type { BrandStatus } from '@shared/types';
import { STATUS_LABEL } from '@/components/common/login';

/** Window status: open (live dot) · opening (spinner) · closed (quiet) · error (with the reason on hover). */
defineProps<{ status: BrandStatus; error?: string | null; compact?: boolean }>();
</script>

<template>
  <Transition name="swap" mode="out-in">
    <span :key="status" class="bs" :class="[`s-${status}`, { compact }]" :title="status === 'error' ? error || 'Chrome stopped unexpectedly' : undefined">
      <span v-if="status === 'opening'" class="spin" aria-hidden="true" />
      <span v-else class="d" aria-hidden="true" />
      <span class="t">{{ STATUS_LABEL[status] ?? status }}</span>
    </span>
  </Transition>
</template>

<style scoped>
.bs { display: inline-flex; align-items: center; gap: 7px; height: 22px; padding: 0 9px 0 8px; border-radius: var(--r-pill); font-size: var(--fs-xs); font-weight: 500; white-space: nowrap; max-width: 100%; }
.compact { padding: 0; height: auto; background: none !important; box-shadow: none !important; }
.t { overflow: hidden; text-overflow: ellipsis; }
.d { position: relative; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.s-open { background: var(--good-bg); color: var(--good); }
.s-open .d::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: currentColor; animation: ff-pulse 2.4s var(--ease-out) infinite; }
.s-opening { background: var(--info-bg); color: var(--info); }
.s-closed { color: var(--muted); box-shadow: inset 0 0 0 1px var(--line); }
.s-closed .d { background: var(--faint); }
.s-error { background: var(--bad-bg); color: var(--bad); cursor: help; }
.spin { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: ff-spin .7s linear infinite; flex: none; }
</style>
