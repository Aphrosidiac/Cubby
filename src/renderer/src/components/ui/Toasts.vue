<script setup lang="ts">
import { dismiss, toasts } from '@/composables/toast';
import Icon from './Icon.vue';
const ICON: Record<string, string> = { good: 'check', bad: 'warn', warn: 'warn', signal: 'bolt', neutral: 'info' };
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`t-${t.tone}`" role="status">
        <span class="ic"><Icon :name="ICON[t.tone]" :size="15" /></span>
        <div class="grow">
          <div class="tt">{{ t.title }}</div>
          <div v-if="t.body" class="tb">{{ t.body }}</div>
        </div>
        <button v-if="t.action" class="act" @click="t.action.run(); dismiss(t.id)">{{ t.action.label }}</button>
        <button class="x" aria-label="Dismiss" @click="dismiss(t.id)"><Icon name="close" :size="13" /></button>
        <span class="bar" :style="{ animationDuration: `${t.ms}ms` }" />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts { position: fixed; right: 20px; bottom: 20px; z-index: 1200; display: flex; flex-direction: column; gap: 10px; align-items: flex-end; width: min(380px, calc(100vw - 32px)); }
.toast { position: relative; overflow: hidden; width: 100%; display: flex; align-items: flex-start; gap: 12px; padding: 14px 14px 16px 16px; border-radius: 10px; background: var(--ink); color: var(--bone); box-shadow: var(--shadow-3); }
[data-theme='dark'] .toast { background: #1c1c1a; border: 1px solid #2a2a27; }
.ic { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 50%; background: rgba(243, 239, 228, .1); animation: ff-tick .5s var(--ease-out) backwards .1s; }
.t-good .ic, .t-signal .ic { background: var(--lime); color: var(--ink); }
.t-bad .ic { background: #ff8a80; color: var(--ink); }
.t-warn .ic { background: #f0bb4a; color: var(--ink); }
.tt { font-weight: 600; font-size: var(--fs-base); line-height: 1.35; padding-top: 3px; }
.tb { font-size: var(--fs-sm); color: rgba(243, 239, 228, .7); margin-top: 3px; line-height: 1.45; }
.act { font-size: var(--fs-sm); font-weight: 600; color: var(--lime); padding: 4px 2px; }
.x { color: rgba(243, 239, 228, .5); padding: 4px; transition: color 200ms; } .x:hover { color: var(--bone); }
/* Phones: toasts drop in from the top — the bottom edge belongs to the thumb, the
   portal's tab bar and the pay / accept bars. */
@media (max-width: 560px) {
  .toasts { top: calc(10px + env(safe-area-inset-top)); bottom: auto; left: 10px; right: 10px; width: auto; flex-direction: column-reverse; align-items: stretch; }
  .x { padding: 8px; margin: -4px -6px 0 0; }
}
.bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; background: var(--lime); transform-origin: left; animation: shrink linear forwards; opacity: .8; }
@keyframes shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
</style>
