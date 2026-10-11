<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { BrandRow, Post } from '@shared/types';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import Icon from '@/components/ui/Icon.vue';
import Segmented from '@/components/ui/Segmented.vue';
import DataTable from '@/components/ui/DataTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import LoadError from '@/components/common/LoadError.vue';
import { postStatus, KIND_LABEL } from '@/components/posts/meta';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { fail } from '@/composables/toast';
import { dateTime } from '@/lib/format';

/** This brand's queue and history; a row opens it in the composer, a posted row links to the live post. */
const props = defineProps<{ brand: BrandRow }>();
const router = useRouter();
const list = useLoad(() => api('posts.list', { brandId: props.brand.id, limit: 300 }), { topics: ['posts.changed'] });
const view = ref<'queue' | 'history' | 'all'>('queue');
const QUEUE = ['draft', 'ready_for_approval', 'approved', 'queued', 'running', 'needs_human'];
const inQueue = (p: Post) => QUEUE.includes(p.status);
const rows = computed(() => {
  const all = list.data.value ?? [];
  const f = view.value === 'queue' ? all.filter(inQueue) : view.value === 'history' ? all.filter(p => !inQueue(p)) : all;
  const at = (p: Post) => p.scheduledAt ?? p.createdAt;
  return [...f].sort((a, b) => (view.value === 'queue' ? at(a).localeCompare(at(b)) : at(b).localeCompare(at(a))));
});
const counts = computed(() => { const all = list.data.value ?? []; const q = all.filter(inQueue).length; return { queue: q, history: all.length - q, all: all.length }; });
const platformsOf = (p: Post) => [...new Set(p.accountIds.map(id => props.brand.accounts.find(a => a.id === id)?.platform).filter((x): x is NonNullable<typeof x> => !!x))];
const liveUrl = (p: Post) => p.results.find(r => r.url)?.url ?? null;
const openLive = (p: Post) => { const u = liveUrl(p); if (u) api('app.openExternal', { url: u }).catch(e => fail(e)); };
const cols = [
  { key: 'caption', label: 'Post' },
  { key: 'platforms', label: 'Where' },
  { key: 'scheduledAt', label: 'When', sortable: true },
  { key: 'status', label: 'Status', align: 'right' as const }
];
const go = (p: Post) => router.push(`/compose?post=${p.id}`);
// the table is keyed by view and fed null until loaded, so only live changes flash — not the first load or a filter switch
</script>

<template>
  <div class="posts-tab">
    <div class="bar">
      <Segmented v-model="view" size="sm" :options="[{ value: 'queue', label: 'Queue', count: counts.queue }, { value: 'history', label: 'History', count: counts.history }, { value: 'all', label: 'All', count: counts.all }]" />
      <span class="grow" />
      <Btn size="sm" variant="subtle" icon="calendar" to="/calendar">Calendar</Btn>
      <Btn v-if="!brand.deletedAt" size="sm" variant="primary" icon="compose" :to="`/compose?brand=${brand.id}`">New post</Btn>
    </div>
    <LoadError v-if="list.error.value" :error="list.error.value" title="Could not load posts" @retry="list.reload()" />
    <DataTable v-else :key="view" :columns="cols" :rows="list.data.value ? rows : null" :loading="list.loading.value" @row-click="go">
      <template #cell-caption="{ row }">
        <div class="cap"><div class="small ellipsis" :class="{ muted: !row.caption }" :title="row.caption || undefined">{{ row.caption || 'No caption' }}</div><div class="tiny muted">{{ KIND_LABEL[row.kind as Post['kind']] }}<template v-if="row.assetIds.length"> · {{ row.assetIds.length }} file{{ row.assetIds.length === 1 ? '' : 's' }}</template></div></div>
      </template>
      <template #cell-platforms="{ row }"><div class="row gap-1 nowrap"><PlatformIcon v-for="p in platformsOf(row)" :key="p" :platform="p" :size="15" /></div></template>
      <template #cell-scheduledAt="{ row }"><span class="small nowrap">{{ row.scheduledAt ? dateTime(row.scheduledAt) : '—' }}</span></template>
      <template #cell-status="{ row }">
        <div class="row gap-2 end">
          <button v-if="liveUrl(row)" type="button" class="link tiny nowrap" title="Open the live post" @click.stop="openLive(row)">View <Icon name="external" :size="11" class="inl" /></button>
          <Chip :tone="postStatus(row.status).tone" size="sm">{{ postStatus(row.status).label }}</Chip>
        </div>
      </template>
      <template #empty>
        <EmptyState compact icon="compose" :title="view === 'history' ? 'Nothing posted yet' : 'Nothing in the queue'" body="Compose a post for this brand — it is paced per account and waits for approval if the brand needs it.">
          <Btn v-if="!brand.deletedAt" size="sm" icon="compose" :to="`/compose?brand=${brand.id}`">New post</Btn>
        </EmptyState>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.posts-tab { container-type: inline-size; }
/* the caption gives way first so the table never scrolls sideways */
.cap { max-width: min(420px, 30cqw); min-width: 0; }
.inl { display: inline; vertical-align: -1px; }
</style>
