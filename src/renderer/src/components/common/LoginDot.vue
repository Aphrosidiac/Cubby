<script setup lang="ts">
import { computed } from 'vue';
import type { LoginState } from '@shared/types';
import { LOGIN_LABEL } from './login';

/** Login health as a dot: ok green · expiring amber · expired red · unknown grey. */
const props = withDefaults(defineProps<{ state: LoginState | string; size?: number; ring?: boolean }>(), { size: 7 });
const label = computed(() => LOGIN_LABEL[props.state as LoginState] ?? props.state);
</script>

<template>
  <span class="ld" :class="[`dot-${state}`, { ring }]" :style="{ width: `${size}px`, height: `${size}px` }" role="img" :aria-label="label" />
</template>

<style scoped>
.ld { display: inline-block; flex: none; border-radius: 50%; }
.ring { box-shadow: 0 0 0 2px var(--bg); }
.dot-expired { position: relative; }
.dot-expired::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: inherit; animation: ff-pulse 2.4s var(--ease-out) infinite; }
</style>
