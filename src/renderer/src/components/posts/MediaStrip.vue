<script setup lang="ts">
import { ref } from 'vue';
import type { MediaAsset } from '@shared/types';
import Icon from '@/components/ui/Icon.vue';
import Btn from '@/components/ui/Btn.vue';
import { fileUrl } from '@/lib/api';
import { droppedPaths, isFileDrag } from '@/components/media/fit';
import { clock } from './time';

/**
 * The post's media: thumbnails in posting order (drag or ←/→ to reorder), a drop zone for files
 * straight from Explorer, and the library picker. Emits `files` with dropped paths; the page adds them.
 */
const props = defineProps<{ assets: MediaAsset[]; multi: boolean; busy?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ 'update:assets': [v: MediaAsset[]]; files: [paths: string[]]; library: []; open: [a: MediaAsset] }>();

const over = ref(false);
let depth = 0;
const enter = (e: DragEvent) => { if (!isFileDrag(e)) return; depth++; over.value = true; };
const leave = () => { depth = Math.max(0, depth - 1); if (!depth) over.value = false; };
function dropFiles(e: DragEvent) {
  depth = 0; over.value = false;
  if (!isFileDrag(e)) return;
  const paths = droppedPaths(e);
  if (paths.length) emit('files', props.multi ? paths : paths.slice(0, 1));
}

// reorder by dragging a thumbnail (internal drag, no files)
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function move(from: number, to: number) {
  if (from === to || to < 0 || to >= props.assets.length) return;
  const next = [...props.assets];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  emit('update:assets', next);
}
function dropOn(i: number, e: DragEvent) {
  if (isFileDrag(e)) return dropFiles(e);
  if (dragFrom.value != null) move(dragFrom.value, i);
  dragFrom.value = dragOver.value = null;
}
const remove = (i: number) => emit('update:assets', props.assets.filter((_, j) => j !== i));
function key(i: number, e: KeyboardEvent) {
  if (e.key === 'ArrowLeft' && (e.altKey || e.shiftKey)) { e.preventDefault(); move(i, i - 1); }
  if (e.key === 'ArrowRight' && (e.altKey || e.shiftKey)) { e.preventDefault(); move(i, i + 1); }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i); }
}
</script>

<template>
  <div class="ms" :class="{ over, disabled }" @dragenter.prevent="enter" @dragover.prevent @dragleave="leave" @drop.prevent="dropFiles">
    <div v-if="assets.length" class="thumbs">
      <div v-for="(a, i) in assets" :key="a.id" class="th" :class="{ dragging: dragFrom === i, target: dragOver === i && dragFrom !== i }" tabindex="0"
        :draggable="multi && assets.length > 1" :aria-label="`${i + 1}. ${a.filename}${multi ? ' — Shift+←/→ to move, Delete to remove' : ''}`"
        @dragstart="dragFrom = i" @dragend="dragFrom = dragOver = null" @dragenter.prevent="dragOver = i" @drop.prevent.stop="dropOn(i, $event)" @keydown="key(i, $event)" @dblclick="emit('open', a)">
        <img v-if="a.thumb" :src="fileUrl(a.thumb)" alt="" draggable="false" />
        <span v-else class="ph"><Icon :name="a.kind === 'video' ? 'video' : 'image'" :size="18" /></span>
        <span v-if="multi && assets.length > 1" class="n num">{{ i + 1 }}</span>
        <span v-if="a.kind === 'video'" class="d num">{{ clock(a.durationMs) }}</span>
        <button type="button" class="x" :aria-label="`Remove ${a.filename}`" @click.stop="remove(i)"><Icon name="close" :size="11" :stroke="2" /></button>
      </div>
      <button v-if="multi" type="button" class="th add" :disabled="disabled" aria-label="Add more media" @click="emit('library')"><Icon name="plus" :size="18" /></button>
    </div>
    <div class="zone" :class="{ compact: assets.length > 0 }">
      <Icon name="upload" :size="assets.length ? 15 : 20" />
      <span class="small">
        <template v-if="busy">Adding to the library…</template>
        <template v-else-if="assets.length && !multi">Drop a file to replace, or</template>
        <template v-else>Drop {{ multi ? 'files' : 'a file' }} from Explorer here, or</template>
      </span>
      <Btn size="sm" icon="image" :disabled="disabled || busy" @click="emit('library')">Pick from library</Btn>
    </div>
    <p v-if="multi && assets.length > 1" class="tiny muted hint">Drag thumbnails to change the order (or focus one and press Shift + ←/→). The first one is the cover.</p>
  </div>
</template>

<style scoped>
.ms { position: relative; border: 1.5px dashed var(--line-strong); border-radius: var(--r-lg); padding: 12px; transition: border-color 200ms, background-color 200ms; }
.ms.over { border-color: var(--fg); background: var(--panel); }
.ms.disabled { opacity: .6; }
.thumbs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.th { position: relative; width: 92px; height: 92px; border-radius: 6px; overflow: hidden; background: var(--panel-2); display: grid; place-items: center; flex: none; cursor: grab; transition: transform 200ms var(--ease-out), box-shadow 200ms, opacity 200ms; }
.th img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.th.dragging { opacity: .4; }
.th.target { box-shadow: -4px 0 0 var(--lime), -5px 0 0 var(--ink); }
.th:focus-visible { outline-offset: 2px; }
.ph { color: var(--faint); }
.n { position: absolute; top: 5px; left: 5px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: var(--ink); color: var(--lime); font-size: var(--fs-2xs); font-weight: 600; display: grid; place-items: center; }
.d { position: absolute; right: 5px; bottom: 5px; padding: 0 5px; height: 16px; line-height: 16px; border-radius: 3px; background: rgb(11 11 10 / .72); color: #f3efe4; font-family: var(--mono); font-size: var(--fs-2xs); }
.x { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: rgb(11 11 10 / .7); color: #f3efe4; opacity: 0; transition: opacity 160ms; }
.th:hover .x, .th:focus-within .x, .x:focus-visible { opacity: 1; }
.add { cursor: pointer; border: 1px dashed var(--line-strong); background: transparent; color: var(--muted); }
.add:hover { border-color: var(--fg); color: var(--fg); }
.zone { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; padding: 22px 8px; color: var(--muted); text-align: center; }
.zone.compact { padding: 4px 0 0; justify-content: flex-start; }
.hint { margin-top: 8px; }
</style>
