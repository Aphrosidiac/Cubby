<script setup lang="ts">
import { ref } from 'vue';
import type { WatchFolder } from '@shared/types';
import Drawer from '@/components/ui/Drawer.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { useBusy } from '@/composables/busy';
import { confirm } from '@/composables/confirm';
import { ok } from '@/composables/toast';

/** Folders the library watches (e.g. FFAds out/): new files are indexed automatically, gone ones marked missing. */
defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [v: boolean] }>();
const { data, loading, error, reload } = useLoad(() => api('media.folders'), { topics: ['media.changed'] });
const { busy, run } = useBusy();
const tagsFor = ref('');

async function add() {
  await run('add', async () => {
    const [path] = await api('app.pickFiles', { directory: true });
    if (!path) return;
    const tags = tagsFor.value.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
    await api('media.addFolder', { path, tags: tags.length ? tags : undefined });
    tagsFor.value = '';
    ok('Watching folder', path);
    void reload(true);
  }, 'Could not add the folder');
}
async function remove(f: WatchFolder) {
  if (!(await confirm({ title: 'Stop watching this folder?', body: `${f.path}\n\nFiles already in the library stay; new files are no longer picked up.`, confirm: 'Stop watching', danger: true }))) return;
  await run(`rm:${f.id}`, async () => { await api('media.removeFolder', { id: f.id }); void reload(true); });
}
async function rescan() {
  await run('rescan', async () => { const r = await api('media.rescan'); ok('Rescan done', `${r.added} new · ${r.missing} missing`); });
}
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const reveal = (p: string) => void run(`rv:${p}`, () => api('app.revealPath', { path: p }));
</script>

<template>
  <Drawer :open="open" title="Watch folders" eyebrow="Media" :width="520" @update:open="emit('update:open', $event)">
    <p class="small muted">Cubby indexes these folders in place — nothing is copied or moved. New files appear in the library on their own; files that disappear are marked missing.</p>
    <div class="addrow mt-4">
      <input v-model="tagsFor" class="input" placeholder="Tags for its files (optional)" title="Comma separated, e.g. reels, october" aria-label="Tags for the new folder" />
      <Btn variant="primary" icon="folder" :loading="busy === 'add'" @click="add">Add folder…</Btn>
    </div>
    <div class="mt-5">
      <div v-if="loading" class="col"><div v-for="i in 3" :key="i" class="skel-line" style="height: 44px" /></div>
      <EmptyState v-else-if="error" compact icon="warn" title="Watch folders aren't available yet" :body="error"><Btn size="sm" icon="refresh" @click="reload()">Try again</Btn></EmptyState>
      <EmptyState v-else-if="!data?.length" compact icon="folder" title="No folders watched" body="Add a folder such as your exports or renders folder and its media shows up here automatically." />
      <ul v-else class="folders">
        <li v-for="f in data" :key="f.id">
          <Icon name="folder" :size="16" class="fi" />
          <div class="grow">
            <button type="button" class="p ellipsis" :title="`Show ${f.path} in Explorer`" @click="reveal(f.path)">{{ baseName(f.path) }}</button>
            <div class="tiny muted code ellipsis" :title="f.path">{{ f.path }}</div>
            <div v-if="f.tags.length" class="tiny muted ellipsis">{{ f.tags.map(t => `#${t}`).join(' ') }}</div>
          </div>
          <Btn size="sm" variant="subtle" square icon="trash" :title="`Stop watching ${f.path}`" :loading="busy === `rm:${f.id}`" @click="remove(f)" />
        </li>
      </ul>
    </div>
    <template #footer>
      <Btn size="sm" icon="refresh" :loading="busy === 'rescan'" @click="rescan">Rescan now</Btn>
    </template>
  </Drawer>
</template>

<style scoped>
.addrow { display: flex; gap: 8px; }
.folders li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-soft); }
.folders li:first-child { border-top: 0; }
.fi { color: var(--muted); }
.folders .grow { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.addrow .input { flex: 1; min-width: 0; }
.p { display: block; max-width: 100%; text-align: left; color: var(--fg); font-weight: 500; font-size: var(--fs-sm); }
.p:hover { text-decoration: underline; }
</style>
