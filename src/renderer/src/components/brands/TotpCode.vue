<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { api } from '@/lib/api';

/**
 * The live 2FA code for one account, with a countdown ring and copy. Polls accounts.totp once a
 * second only while it is on screen and the window is visible; the secret itself never reaches here.
 */
const props = defineProps<{ accountId: string }>();
const code = ref<string | null>(null);
const left = ref(30);
const err = ref<string | null>(null);
const copied = ref(false);
const root = ref<HTMLElement | null>(null);
let timer = 0;
let visible = true;
let inView = true;
let io: IntersectionObserver | null = null;

async function tick() {
  if (!visible || !inView) return;
  try { const r = await api('accounts.totp', { id: props.accountId }); code.value = r.code; left.value = r.remainingSec; err.value = null; }
  catch (e) { err.value = (e as Error).message; code.value = null; }
}
const onVis = () => { visible = document.visibilityState === 'visible'; if (visible) void tick(); };
onMounted(() => {
  void tick();
  timer = window.setInterval(tick, 1000);
  document.addEventListener('visibilitychange', onVis);
  if (root.value) { io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) void tick(); }); io.observe(root.value); }
});
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); io?.disconnect(); });

const shown = computed(() => (code.value ? code.value.replace(/^(\d{3})(\d{3})$/, '$1 $2') : '––– –––'));
const C = 2 * Math.PI * 9;
const dash = computed(() => `${(Math.max(0, Math.min(30, left.value)) / 30) * C} ${C}`);
async function copy() {
  if (!code.value) return;
  try { await navigator.clipboard.writeText(code.value); copied.value = true; setTimeout(() => (copied.value = false), 1400); } catch { /* clipboard blocked */ }
}
</script>

<template>
  <div ref="root" class="totp" :class="{ low: left <= 5, err: !!err }" :title="err ?? 'Current 2FA code — click to copy'">
    <button type="button" class="code-btn" :disabled="!code" @click="copy">
      <svg class="ring" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="9" class="bg" />
        <circle cx="11" cy="11" r="9" class="fg" :stroke-dasharray="dash" transform="rotate(-90 11 11)" />
      </svg>
      <span class="digits num">{{ err ? 'Code unavailable' : shown }}</span>
      <span class="cp"><Transition name="swap" mode="out-in"><Icon :key="String(copied)" :name="copied ? 'check' : 'copy'" :size="14" /></Transition></span>
    </button>
    <span v-if="code" class="sec num tiny muted">{{ left }}s</span>
  </div>
</template>

<style scoped>
.totp { display: inline-flex; align-items: center; gap: 8px; }
.code-btn { display: inline-flex; align-items: center; gap: 10px; height: 38px; padding: 0 10px 0 8px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); transition: border-color 160ms; }
.code-btn:hover:not(:disabled) { border-color: var(--fg); }
.code-btn:disabled { cursor: default; }
.digits { font-family: var(--mono); font-size: var(--fs-lg); letter-spacing: .08em; font-weight: 500; min-width: 7.2ch; text-align: left; }
.err .digits { font-family: var(--sans); font-size: var(--fs-sm); letter-spacing: 0; color: var(--muted); }
.ring .bg { fill: none; stroke: var(--line); stroke-width: 2.5; }
.ring .fg { fill: none; stroke: var(--fg); stroke-width: 2.5; stroke-linecap: round; transition: stroke-dasharray 950ms linear; }
.low .ring .fg { stroke: var(--bad); }
.low .digits { color: var(--bad); }
.cp { color: var(--muted); display: grid; }
.sec { min-width: 3ch; }
</style>
