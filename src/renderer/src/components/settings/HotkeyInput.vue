<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { isMac } from '@/lib/api';

/**
 * Press the keys to record a global shortcut; stored as an Electron accelerator
 * ("CommandOrControl+Shift+Space"). Needs a modifier; Esc cancels, Backspace clears.
 */
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();
const recording = ref(false);
const live = ref('');
const el = ref<HTMLButtonElement | null>(null);

const KEYMAP: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', '+': 'Plus' };
function keyName(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(e.key)) return null;
  if (e.code.startsWith('Key')) return e.code.slice(3);
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  if (KEYMAP[e.key]) return KEYMAP[e.key];
  if (['Tab', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(e.key)) return e.key;
  return e.key.length === 1 ? e.key.toUpperCase() : null;
}
function mods(e: KeyboardEvent): string[] {
  const m: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) m.push('CommandOrControl');
  if (isMac && e.ctrlKey) m.push('Control');
  if (!isMac && e.metaKey) m.push('Super');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey) m.push('Shift');
  return m;
}
function onKey(e: KeyboardEvent) {
  if (!recording.value) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { stop(); return; }
  if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) { emit('update:modelValue', ''); stop(); return; }
  const m = mods(e);
  const k = keyName(e);
  live.value = [...m, k ?? ''].filter(Boolean).join('+');
  if (k && m.length) { emit('update:modelValue', [...m, k].join('+')); stop(); }
}
function start() { recording.value = true; live.value = ''; el.value?.focus(); }
function stop() { recording.value = false; live.value = ''; }

/** "CommandOrControl+Shift+Space" → "Ctrl Shift Space" / "⌘ ⇧ Space" */
const pretty = (acc: string) => acc.split('+').filter(Boolean).map(p => (p === 'CommandOrControl' ? (isMac ? '⌘' : 'Ctrl') : p === 'Shift' ? (isMac ? '⇧' : 'Shift') : p === 'Alt' ? (isMac ? '⌥' : 'Alt') : p === 'Control' ? '⌃' : p === 'Super' ? 'Win' : p));
const shown = computed(() => (recording.value ? (live.value ? pretty(live.value) : []) : pretty(props.modelValue)));
</script>

<template>
  <div class="hk">
    <button ref="el" type="button" class="box" :class="{ rec: recording }" @click="recording ? stop() : start()" @keydown="onKey" @blur="stop">
      <template v-if="shown.length"><kbd v-for="(k, i) in shown" :key="i">{{ k }}</kbd></template>
      <span v-else class="ph">{{ recording ? 'Press the keys…' : 'No shortcut' }}</span>
      <span class="grow" />
      <span class="tiny muted">{{ recording ? 'Esc to cancel · Backspace to clear' : 'Click to change' }}</span>
      <Icon v-if="!recording" name="edit" :size="14" class="faint" />
    </button>
  </div>
</template>

<style scoped>
.hk { width: 100%; max-width: 420px; }
.box { width: 100%; max-width: 420px; display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 6px 12px; border-radius: var(--r); border: 1px solid var(--line); background: var(--panel); text-align: left; transition: border-color 160ms, box-shadow 160ms; }
.box:hover { border-color: var(--line-strong); }
.box.rec { border-color: var(--focus-border); box-shadow: var(--focus-ring); }
.box.rec kbd { border-color: var(--fg); color: var(--fg); }
kbd { font-size: var(--fs-xs); padding: 3px 8px; }
.ph { color: var(--faint); font-size: var(--fs-sm); }
</style>
