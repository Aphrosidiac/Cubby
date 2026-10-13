<script setup lang="ts">
import { ref } from 'vue';
import Icon from './Icon.vue';
const props = defineProps<{ value: string; label?: string; mono?: boolean }>();
const done = ref(false);
async function copy() {
  try { await navigator.clipboard.writeText(props.value); } catch { const t = document.createElement('textarea'); t.value = props.value; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  done.value = true; setTimeout(() => { done.value = false; }, 1600);
}
</script>

<template>
  <div class="cf">
    <span v-if="label" class="cf-label">{{ label }}</span>
    <div class="box" :class="{ done }">
      <span class="v ellipsis" :class="{ code: mono }" :title="value">{{ value }}</span>
      <button type="button" class="cp" :aria-label="done ? 'Copied' : 'Copy'" @click="copy">
        <Transition name="swap" mode="out-in"><Icon :key="String(done)" :name="done ? 'check' : 'copy'" :size="15" /></Transition>
        <span class="t">{{ done ? 'Copied' : 'Copy' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cf { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
/* the kit's one field-label style (as Field): sans, not mono caps */
.cf-label { font-size: var(--fs-sm); font-weight: 500; color: var(--fg-2); letter-spacing: .002em; }
.box { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 12px; border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--panel); transition: border-color 300ms; min-width: 0; }
.box.done { border-color: var(--fg); }
.v { flex: 1; font-size: var(--fs-sm); color: var(--fg-2); }
.v.code { font-family: var(--mono); font-size: var(--fs-xs); }
.cp { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: var(--r-pill); background: var(--fg); color: var(--bg); font-size: var(--fs-sm); font-weight: 600; transition: background-color 300ms; flex: none; }
.done .cp { background: var(--lime); color: var(--ink); }
</style>
