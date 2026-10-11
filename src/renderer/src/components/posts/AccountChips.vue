<script setup lang="ts">
import type { AccountSummary } from '@shared/types';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import LoginDot from '@/components/common/LoginDot.vue';
import Icon from '@/components/ui/Icon.vue';

/**
 * A brand's accounts as toggle chips: platform glyph, handle, login dot. Accounts listed in
 * `unavailable` (e.g. X for a reel) are shown but can't be ticked; the value says why.
 */
const props = defineProps<{ accounts: Pick<AccountSummary, 'id' | 'platform' | 'handle' | 'loginState'>[]; modelValue: string[]; disabled?: boolean; unavailable?: Record<string, string> }>();
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>();
function toggle(id: string) {
  if (props.unavailable?.[id]) return;
  emit('update:modelValue', props.modelValue.includes(id) ? props.modelValue.filter(x => x !== id) : [...props.modelValue, id]);
}
const handle = (h: string) => (h.startsWith('@') || h.includes('/') ? h : `@${h}`);
const LOGIN: Record<string, string> = { ok: 'Logged in', expiring: 'Login expires soon', expired: 'Login expired — log in again before posting', unknown: 'Login not checked yet' };
const tip = (a: Pick<AccountSummary, 'id' | 'handle' | 'loginState'>) => [handle(a.handle), props.unavailable?.[a.id], LOGIN[a.loginState]].filter(Boolean).join(' · ');
const on = (id: string) => props.modelValue.includes(id) && !props.unavailable?.[id];
</script>

<template>
  <div class="chips" role="group" aria-label="Accounts">
    <button v-for="a in accounts" :key="a.id" type="button" class="ac" :class="{ on: on(a.id), na: !!unavailable?.[a.id] }" :aria-pressed="on(a.id)" :aria-disabled="!!unavailable?.[a.id] || undefined" :disabled="disabled"
      :title="tip(a)" @click="toggle(a.id)">
      <span class="box"><Icon v-if="on(a.id)" name="check" :size="11" :stroke="2.2" /></span>
      <PlatformIcon :platform="a.platform" :size="15" colored />
      <span class="h ellipsis">{{ handle(a.handle) }}</span>
      <LoginDot :state="a.loginState" />
    </button>
  </div>
</template>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.ac { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px 0 9px; max-width: 280px; min-width: 0; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); font-size: var(--fs-sm); font-weight: 500; color: var(--fg-2); transition: border-color 160ms, background-color 160ms, color 160ms, opacity 160ms; }
.ac:hover:not(:disabled):not(.na) { border-color: var(--line-strong); color: var(--fg); }
.ac:active:not(:disabled):not(.na) { background: var(--panel-hover); }
.ac.on { border-color: var(--fg); color: var(--fg); background: var(--bg-elev); }
.ac:disabled { opacity: .55; cursor: not-allowed; }
.ac.na { border-style: dashed; color: var(--muted); background: transparent; cursor: not-allowed; }
.ac.na .h { text-decoration: line-through; text-decoration-color: var(--line-strong); }
.ac.na :deep(.pi), .ac.na .box { opacity: .55; }
.box { width: 16px; height: 16px; border-radius: 4px; display: grid; place-items: center; box-shadow: inset 0 0 0 1.5px var(--line-strong); transition: background-color 160ms, box-shadow 160ms; flex: none; }
.on .box { background: var(--fg); color: var(--bg); box-shadow: none; }
.h { min-width: 0; }
</style>
