<script setup lang="ts">
// Media library (PLAN 6.7): files indexed in place; grid + list, filters, drop from Explorer, watch folders.
import { computed, ref, watch } from 'vue';
import type { MediaAsset } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Select from '@/components/ui/Select.vue';
import Segmented from '@/components/ui/Segmented.vue';
import DataTable from '@/components/ui/DataTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import MediaTile from '@/components/media/MediaTile.vue';
import AssetDrawer from '@/components/media/AssetDrawer.vue';
import WatchFoldersDrawer from '@/components/media/WatchFoldersDrawer.vue';
import { MEDIA_EXT, aspectLabel, droppedPaths, isFileDrag, platformSummary } from '@/components/media/fit';
import { clock } from '@/components/posts/time';
import { api, fileUrl } from '@/lib/api';
import { bytes, shortDate } from '@/lib/format';
import { useLoad } from '@/composables/useLoad';
import { fail, ok, toast } from '@/composables/toast';
import type { Column } from '@/components/ui/types';

const q = ref('');
const qDebounced = ref('');
let t = 0;
watch(q, v => { clearTimeout(t); t = window.setTimeout(() => (qDebounced.value = v.trim()), 220); });
const tag = ref<string | null>(null);
const kind = ref<'all' | 'video' | 'image'>('all');
const view = ref<'grid' | 'list'>((() => { try { return (localStorage.getItem('cubby-media-view') as 'grid' | 'list') || 'grid'; } catch { return 'grid'; } })());
watch(view, v => { try { localStorage.setItem('cubby-media-view', v); } catch { /* ignore */ } });

const { data, loading, error, reload } = useLoad(
  () => api('media.list', { q: qDebounced.value || undefined, tag: tag.value || undefined, kind: kind.value === 'all' ? undefined : kind.value }),
  { topics: ['media.changed'], deps: [qDebounced, tag, kind] }
);

// tag choices grow with everything we've seen (the server filters by tag, so a filtered list alone would shrink them)
const seenTags = ref(new Set<string>());
watch(data, d => { if (!d) return; const s = new Set(seenTags.value); d.forEach(a => a.tags.forEach(x => s.add(x))); seenTags.value = s; });
const tagOptions = computed(() => [{ value: null, label: 'All tags' }, ...[...seenTags.value].sort().map(x => ({ value: x, label: `#${x}` }))]);
const filtered = computed(() => !!(qDebounced.value || tag.value || kind.value !== 'all'));

const current = ref<MediaAsset | null>(null);
const foldersOpen = ref(false);
const adding = ref(0);

async function addPaths(paths: string[]) {
  if (!paths.length) return;
  adding.value = paths.length;
  try {
    const added = await api('media.add', { paths });
    if (added.length) ok(added.length === 1 ? `Added ${added[0].filename}` : `Added ${added.length} files`);
    else toast('Nothing new to add', { body: 'Those files are already in the library or are not media files.' });
    void reload(true);
  } catch (e) {
    fail(e, 'Could not add the files');
  } finally {
    adding.value = 0;
  }
}
async function pick() {
  try {
    const paths = await api('app.pickFiles', { multi: true, filters: [{ name: 'Media', extensions: MEDIA_EXT }] });
    await addPaths(paths);
  } catch (e) {
    fail(e);
  }
}

// whole-page drop target for files and folders from Explorer
const over = ref(false);
let depth = 0;
const enter = (e: DragEvent) => { if (!isFileDrag(e)) return; depth++; over.value = true; };
const leave = () => { depth = Math.max(0, depth - 1); if (!depth) over.value = false; };
function drop(e: DragEvent) { depth = 0; over.value = false; void addPaths(droppedPaths(e)); }

function onChanged(a: MediaAsset) {
  current.value = a;
  if (data.value) data.value = data.value.map(x => (x.id === a.id ? a : x));
}
function onRemoved(id: string) {
  current.value = null;
  if (data.value) data.value = data.value.filter(x => x.id !== id);
}

const columns: Column[] = [
  { key: 'filename', label: 'File', sortable: true },
  { key: 'kind', label: 'Type', width: '84px', sortable: true },
  { key: 'durationMs', label: 'Length', width: '80px', align: 'right', sortable: true },
  { key: 'aspect', label: 'Aspect', width: '84px', hideSm: true },
  { key: 'fits', label: 'Fits', width: '196px', hideSm: true },
  { key: 'sizeBytes', label: 'Size', width: '90px', align: 'right', sortable: true, hideSm: true },
  { key: 'addedAt', label: 'Added', width: '96px', align: 'right', sortable: true }
];
</script>

<template>
  <div class="page media" @dragenter.prevent="enter" @dragover.prevent @dragleave="leave" @drop.prevent="drop">
    <PageHeader eyebrow="Library" title="Media">
      <span v-if="data">{{ data.length }} {{ data.length === 1 ? 'file' : 'files' }}{{ filtered ? ' match' : '' }}</span>
      <span class="faint">Files stay where they are — the library only indexes them.</span>
      <template #actions>
        <Btn icon="folder" @click="foldersOpen = true">Watch folders</Btn>
        <Btn variant="primary" icon="plus" :loading="adding > 0" @click="pick">Add files</Btn>
      </template>
    </PageHeader>

    <div class="toolbar">
      <label class="search"><Icon name="search" :size="15" /><input v-model="q" placeholder="Search file names and tags" aria-label="Search media" @keydown.esc="q = ''" /></label>
      <Select v-model="tag" variant="pill" :options="tagOptions" aria-label="Filter by tag" :min-width="180" />
      <Segmented v-model="kind" size="sm" :options="[{ value: 'all', label: 'All' }, { value: 'video', label: 'Video', icon: 'video' }, { value: 'image', label: 'Image', icon: 'image' }]" />
      <span class="grow" />
      <Segmented v-model="view" size="sm" :options="[{ value: 'grid', icon: 'grid' }, { value: 'list', icon: 'rows' }]" aria-label="View" />
    </div>

    <Transition name="fade">
      <div v-if="adding" class="addbar small"><span class="spin" />Adding {{ adding }} {{ adding === 1 ? 'file' : 'files' }} — reading length, size and making thumbnails…</div>
    </Transition>

    <div v-if="loading" class="grid-tiles">
      <div v-for="i in 12" :key="i" class="skel tile-skel" :style="{ animationDelay: `${i * 40}ms` }" />
    </div>
    <EmptyState v-else-if="error && !data" icon="warn" title="The media library isn't available yet" :body="error">
      <Btn size="sm" icon="refresh" @click="reload()">Try again</Btn>
    </EmptyState>
    <EmptyState v-else-if="!data?.length && filtered" icon="search" title="Nothing matches" body="Try another search, tag or type.">
      <Btn size="sm" @click="q = ''; tag = null; kind = 'all'">Clear filters</Btn>
    </EmptyState>
    <div v-else-if="!data?.length" class="dropzone-empty" role="button" tabindex="0" @click="pick" @keydown.enter="pick">
      <Icon name="upload" :size="26" />
      <h3 class="h3">Drop videos and images here</h3>
      <p class="small muted">or <span class="link">choose files</span>, or watch a folder so new exports appear on their own. Folders dropped here are indexed too.</p>
      <Btn size="sm" icon="folder" @click.stop="foldersOpen = true">Watch a folder</Btn>
    </div>

    <div v-else-if="view === 'grid'" class="grid-tiles">
      <MediaTile v-for="a in data" :key="a.id" :asset="a" @open="current = a" />
    </div>
    <DataTable v-else :columns="columns" :rows="data" dense :selected="current?.id ?? null" @row-click="r => (current = r as MediaAsset)">
      <template #cell-filename="{ row }">
        <div class="fcell">
          <img v-if="row.thumb" :src="fileUrl(row.thumb)" alt="" class="mini" loading="lazy" />
          <span v-else class="mini ph"><Icon :name="row.kind === 'video' ? 'video' : 'image'" :size="14" /></span>
          <div class="grow">
            <div class="ellipsis strongish">{{ row.filename }}<span v-if="row.missing" class="miss">missing</span></div>
            <div v-if="row.tags.length" class="tiny muted ellipsis">{{ row.tags.map((x: string) => `#${x}`).join(' ') }}</div>
          </div>
        </div>
      </template>
      <template #cell-kind="{ row }"><span class="small">{{ row.kind === 'video' ? 'Video' : 'Image' }}</span></template>
      <template #cell-durationMs="{ row }"><span class="num small">{{ row.kind === 'video' ? clock(row.durationMs) : '—' }}</span></template>
      <template #cell-aspect="{ row }"><span class="num small">{{ aspectLabel(row) }}</span></template>
      <template #cell-fits="{ row }">
        <span class="fits">
          <span v-for="f in platformSummary(row as MediaAsset)" :key="f.platform" class="fit" :class="`l-${f.level}`" :title="`${f.platform}: ${f.level}`"><PlatformIcon :platform="f.platform" :size="12" /></span>
        </span>
      </template>
      <template #cell-sizeBytes="{ row }"><span class="num small">{{ bytes(row.sizeBytes) }}</span></template>
      <template #cell-addedAt="{ row }"><span class="small muted">{{ shortDate(row.addedAt) }}</span></template>
    </DataTable>

    <Transition name="fade">
      <div v-if="over" class="dropveil"><div class="dropcard"><Icon name="upload" :size="28" /><div class="h2">Drop to add to the library</div><div class="small muted">Files and folders are indexed where they are.</div></div></div>
    </Transition>

    <AssetDrawer :asset="current" @close="current = null" @changed="onChanged" @removed="onRemoved" />
    <WatchFoldersDrawer v-model:open="foldersOpen" />
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: var(--s5); }
.search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--muted); width: min(320px, 100%); transition: border-color 150ms; }
.search:focus-within { border-color: var(--focus-border); }
.search input { flex: 1; border: 0; background: none; outline: none; color: var(--fg); min-width: 0; }
.search input:focus-visible { box-shadow: none; outline: none; }
.grid-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); gap: 14px; }
.tile-skel { aspect-ratio: 1 / 1.22; border-radius: var(--r-lg); }
.addbar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin-bottom: var(--s4); border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line); }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 1.6px solid currentColor; border-right-color: transparent; animation: ff-spin .7s linear infinite; flex: none; }
.dropzone-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 64px 20px; border: 1.5px dashed var(--line-strong); border-radius: var(--r-lg); color: var(--muted); cursor: pointer; transition: border-color 200ms, background-color 200ms; }
.dropzone-empty:hover { border-color: var(--fg); background: var(--panel); color: var(--fg); }
.dropzone-empty p { max-width: 420px; }
.dropveil { position: fixed; inset: 0; z-index: 700; background: color-mix(in srgb, var(--bg) 70%, transparent); backdrop-filter: blur(2px); display: grid; place-items: center; pointer-events: none; }
.dropcard { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 56px; border: 2px dashed var(--fg); border-radius: 14px; background: var(--panel); box-shadow: var(--shadow-3); }
.fcell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mini { width: 36px; height: 36px; border-radius: 4px; object-fit: cover; flex: none; background: var(--panel-2); }
.mini.ph { display: grid; place-items: center; color: var(--faint); }
.strongish { font-weight: 500; }
.miss { margin-left: 8px; font-size: var(--fs-2xs); color: var(--bad); font-family: var(--mono); text-transform: uppercase; }
.fits { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.fit { width: 20px; height: 18px; border-radius: 4px; display: grid; place-items: center; }
.l-ok { background: var(--good-bg); color: var(--good); }
.l-warn { background: var(--warn-bg); color: var(--warn); }
.l-bad { background: var(--bad-bg); color: var(--bad); opacity: .75; }
</style>
