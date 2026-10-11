<script setup lang="ts">
import type { AccountSummary } from '@shared/types';
import PlatformIcon from './PlatformIcon.vue';
import LoginDot from './LoginDot.vue';
import { accountTip } from './login';

/** One account on a brand row: the platform glyph with its login dot on the corner, details on hover. */
withDefaults(defineProps<{ account: Pick<AccountSummary, 'platform' | 'handle' | 'loginState' | 'cookieExpiresAt'>; size?: number }>(), { size: 16 });
</script>

<template>
  <span class="ab" :class="`s-${account.loginState}`" :title="accountTip(account)">
    <PlatformIcon :platform="account.platform" :size="size" />
    <LoginDot :state="account.loginState" :size="7" ring class="d" />
  </span>
</template>

<style scoped>
.ab { position: relative; display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; color: var(--fg-2); background: var(--panel-2); flex: none; }
.s-expired { color: var(--bad); background: var(--bad-bg); }
.s-expiring { color: var(--warn); background: var(--warn-bg); }
.d { position: absolute; right: -2px; bottom: -2px; }
</style>
