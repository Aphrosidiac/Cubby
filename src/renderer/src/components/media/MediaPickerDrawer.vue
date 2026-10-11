<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MediaAsset } from '@shared/types';
import Drawer from '@/components/ui/Drawer.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Segmented from '@/components/ui/Segmented.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import MediaTile from './MediaTile.vue';
import AssetDrawer from './AssetDrawer.vue';
import { api } from '@/lib/api';

/**
 * Choose media for a post from the library. Multi-select keeps click order (that order is the
 * carousel order); "Attach" hands back the chosen assets.
 */
const props = defineProps<{ open: boolean; selected: string[]; multi?: boolean; kind?: 'video' | 'image' | null }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; pick: [assets: MediaAsset[]] }>();

const list = ref<MediaAsset[] | null>(null);
const error = ref<string | null>(null);
const q = ref('');
const kind = ref<'all' | 'video' | 'image'>('all');
const chosen = ref<string[]>([]);
const peek = ref<MediaAsset | null>(null);

watch(() => props.open, async o => {
  if (!o) return;
  chosen.value = [...props.selected];
  kind.value = props.kind ?? 'all';
  error.value = null;
  try { list.value = await api('media.list', {}); } catch (e) { error.value = (e as Error).message; list.value = list.value ?? null; }
});

const shown = computed(() => {
  const t = q.value.trim().toLowerCase();
  return (list.value ?? []).filter(a => !a.missing && (kind.value === 'all' || a.kind === kind.value) && (!t || `${a.filename} ${a.tags.join(' ')}`.toLowerCase().includes(t)));
});
function toggle(a: MediaAsset) {
  const i = chosen.value.indexOf(a.id);
  if (i >= 0) chosen.value = chosen.value.filter(x => x !== a.id);
  else chosen.value = props.multi ? [...chosen.value, a.id] : [a.id];
}
function attach() {
  const byId = new Map((list.value ?? []).map(a => [a.id, a]));
  emit('pick', chosen.value.map(id => byId.get(id)).filter((a): a is MediaAsset => !!a));
  emit('update:open', false);
}
</script>

<template>
  <Drawer :open="open" title="Attach from library" eyebrow="Media" :width="760" @update:open="emit('update:open', $event)">
    <template #head>
      <div class="bar mt-3">
        <label class="search"><Icon name="search" :size="15" /><input v-model="q" placeholder="Search" aria-label="Search media" /></label>
        <Segmented v-model="kind" size="sm" :options="[{ value: 'all', label: 'All' }, { value: 'video', label: 'Video' }, { value: 'image', label: 'Image' }]" />
      </div>
    </template>
    <EmptyState v-if="error" compact icon="warn" title="The media library isn't available yet" :body="error" />
    <div v-else-if="list === null" class="grid"><div v-for="i in 8" :key="i" class="skel" style="aspect-ratio: 1; border-radius: 8px" /></div>
    <EmptyState v-else-if="!shown.length" compact icon="image" :title="list.length ? 'Nothing matches' : 'The library is empty'" :body="list.length ? 'Try another search or type.' : 'Close this and drop files onto the composer, or add them on the Media page.'" />
    <div v-else class="grid">
      <MediaTile v-for="a in shown" :key="a.id" :asset="a" selectable compact :selected="chosen.includes(a.id)" :order="multi ? chosen.indexOf(a.id) + 1 || null : null" @toggle="toggle(a)" @open="peek = a" />
    </div>
    <template #footer>
      <span class="grow small muted">{{ chosen.length ? `${chosen.length} chosen${multi && chosen.length > 1 ? ' — numbers are the order' : ''}` : multi ? 'Click to choose; order follows your clicks' : 'Click one to choose it' }}</span>
      <Btn variant="subtle" @click="emit('update:open', false)">Cancel</Btn>
      <Btn variant="primary" :disabled="!chosen.length" @click="attach">Attach{{ chosen.length ? ` ${chosen.length}` : '' }}</Btn>
    </template>
  </Drawer>
  <AssetDrawer :asset="peek" @close="peek = null" @removed="peek = null" />
</template>

<style scoped>
.bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.search { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--muted); width: 240px; }
.search input { flex: 1; border: 0; background: none; outline: none; color: var(--fg); min-width: 0; font-size: var(--fs-sm); }
.search input:focus-visible { box-shadow: none; outline: none; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 10px; }
</style>
