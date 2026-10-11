<script setup lang="ts">
import { computed } from 'vue';
import Modal from '@/components/ui/Modal.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import { api, fileUrl } from '@/lib/api';
import { fail } from '@/composables/toast';

/** Screenshot viewer: a strip of images, one shown large; ← → step through, Esc closes. */
const props = defineProps<{ images: { path: string; label?: string }[]; index: number | null }>();
const emit = defineEmits<{ 'update:index': [v: number | null] }>();
const cur = computed(() => (props.index == null ? null : props.images[props.index] ?? null));
const go = (d: number) => { if (props.index == null || !props.images.length) return; emit('update:index', (props.index + d + props.images.length) % props.images.length); };
function key(e: KeyboardEvent) { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); }
// one separator style for the platform (paths can mix \ from Windows APIs and / from joins)
const shownPath = computed(() => (cur.value ? (window.cubby?.platform === 'win32' ? cur.value.path.replace(/\//g, '\\') : cur.value.path) : ''));
async function reveal() { try { if (cur.value) await api('app.revealPath', { path: cur.value.path }); } catch (e) { fail(e); } }
</script>

<template>
  <Modal :open="index != null" :title="cur?.label ?? 'Screenshot'" :eyebrow="images.length > 1 ? `${(index ?? 0) + 1} of ${images.length}` : undefined" size="xl" @update:open="v => !v && emit('update:index', null)">
    <div class="zoom" tabindex="0" @keydown="key">
      <button v-if="images.length > 1" type="button" class="nav l" aria-label="Previous" @click="go(-1)"><Icon name="chevron-left" :size="18" /></button>
      <img v-if="cur" :src="fileUrl(cur.path)" :alt="cur.label ?? 'Screenshot'" />
      <button v-if="images.length > 1" type="button" class="nav r" aria-label="Next" @click="go(1)"><Icon name="chevron" :size="18" /></button>
    </div>
    <template #footer>
      <span class="grow tiny muted ellipsis code" :title="shownPath">{{ shownPath }}</span>
      <Btn size="sm" icon="folder" @click="reveal">Show in folder</Btn>
    </template>
  </Modal>
</template>

<style scoped>
.zoom { position: relative; display: grid; place-items: center; background: var(--panel-2); border-radius: var(--r-lg); min-height: 240px; }
.zoom:focus-visible { outline-offset: -2px; }
img { max-width: 100%; max-height: calc(100vh - 240px); object-fit: contain; border-radius: var(--r); }
.nav { position: absolute; top: 50%; translate: 0 -50%; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow-1); }
.nav:hover { border-color: var(--fg); }
.l { left: 10px; } .r { right: 10px; }
</style>
