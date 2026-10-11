<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from './Icon.vue';

/** Drop a file (or click). Emits the File; the caller uploads. Shows a sweep while `busy`. */
const props = defineProps<{ accept?: string; busy?: boolean; label?: string; hint?: string; compact?: boolean }>();
// Phones have nothing to drop: "Drop the receipt or click to choose" reads "Tap to choose the receipt".
const touch = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches;
const text = computed(() => { const l = props.label ?? 'Drop a file or click to choose'; return touch ? l.replace(/^Drop (.+?) or click to choose$/, 'Tap to choose $1') : l; });
const emit = defineEmits<{ file: [f: File] }>();
const over = ref(false);
const input = ref<HTMLInputElement | null>(null);
function drop(e: DragEvent) { over.value = false; const f = e.dataTransfer?.files?.[0]; if (f) emit('file', f); }
function pick(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) emit('file', f); (e.target as HTMLInputElement).value = ''; }
</script>

<template>
  <div class="drop" :class="{ over, busy, compact }" role="button" tabindex="0" @click="input?.click()" @keydown.enter="input?.click()" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="drop">
    <input ref="input" type="file" :accept="accept" hidden @change="pick" />
    <Icon name="upload" :size="compact ? 16 : 20" />
    <div><div class="strong small">{{ busy ? 'Uploading…' : text }}</div><div v-if="hint && !compact" class="tiny muted">{{ hint }}</div></div>
    <span v-if="busy" class="sweep" />
  </div>
</template>

<style scoped>
.drop { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 22px; border: 1.5px dashed var(--line-strong); border-radius: var(--r-lg); color: var(--muted); cursor: pointer; transition: border-color 240ms, background-color 240ms, color 240ms, transform 300ms var(--ease-out); text-align: left; }
.drop.compact { padding: 12px; }
.drop:hover, .drop.over { border-color: var(--fg); color: var(--fg); background: var(--panel); }
.drop.over { transform: scale(1.01); }
.sweep { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--lime) 35%, transparent) 50%, transparent 70%); animation: sweep 1.1s linear infinite; }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
</style>
