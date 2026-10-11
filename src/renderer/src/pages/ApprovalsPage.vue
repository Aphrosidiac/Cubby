<script setup lang="ts">
// Approvals (PLAN 6.6): prepared posts grouped by brand, a screenshot per account; approve all /
// per account, edit, reject with a reason, batch approve. Live on posts.changed.
import { computed, ref, watch } from 'vue';
import type { MediaAsset, Post } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ApprovalCard from '@/components/posts/ApprovalCard.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { brandById, useBrands } from '@/components/posts/meta';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { fail, ok } from '@/composables/toast';
import { confirm } from '@/composables/confirm';

useBrands();
const { data, loading, error, reload } = useLoad(() => api('posts.list', { status: ['ready_for_approval'], limit: 500 }), { topics: ['posts.changed'] });

// media thumbnails for every post on screen, fetched in one call
const media = ref(new Map<string, MediaAsset>());
watch(data, async posts => {
  const ids = [...new Set((posts ?? []).flatMap(p => p.assetIds))].filter(id => !media.value.has(id));
  if (!ids.length) return;
  try { const list = await api('media.list', { ids }); const m = new Map(media.value); list.forEach(a => m.set(a.id, a)); media.value = m; } catch { /* thumbnails are optional */ }
});

const groups = computed(() => {
  const by = new Map<string, Post[]>();
  for (const p of [...(data.value ?? [])].sort((a, b) => (a.scheduledAt ?? '9').localeCompare(b.scheduledAt ?? '9'))) {
    if (!by.has(p.brandId)) by.set(p.brandId, []);
    by.get(p.brandId)!.push(p);
  }
  return [...by.entries()].map(([brandId, posts]) => ({ brandId, brand: brandById(brandId), posts }));
});

const selected = ref<string[]>([]);
/** per post, the accounts ticked on its card (all of them unless the person unticked some) */
const picks = ref(new Map<string, string[]>());
const setPicks = (p: Post, ids: string[]) => { const m = new Map(picks.value); m.set(p.id, ids); picks.value = m; };
const partialOf = (id: string) => { const p = data.value?.find(x => x.id === id); const ids = picks.value.get(id); return p && ids && ids.length < p.accountIds.length ? ids : undefined; };
watch(data, d => { const ids = new Set((d ?? []).map(p => p.id)); selected.value = selected.value.filter(id => ids.has(id)); });
const setSel = (id: string, v: boolean) => { selected.value = v ? [...new Set([...selected.value, id])] : selected.value.filter(x => x !== id); };
const groupAll = (posts: Post[]) => posts.every(p => selected.value.includes(p.id));
const toggleGroup = (posts: Post[]) => { const all = groupAll(posts); posts.forEach(p => setSel(p.id, !all)); };

const batching = ref(false);
async function approveSelected() {
  const ids = [...selected.value];
  if (!ids.length) return;
  const empty = ids.filter(id => picks.value.get(id)?.length === 0);
  if (empty.length) { fail(new Error(`${empty.length === 1 ? 'One selected post has' : `${empty.length} selected posts have`} every account unticked — tick at least one, or unselect ${empty.length === 1 ? 'it' : 'them'}.`), 'Nothing to approve'); return; }
  const partialN = ids.filter(id => partialOf(id)).length;
  if (!(await confirm({ title: `Approve ${ids.length} ${ids.length === 1 ? 'post' : 'posts'}?`, body: `Each goes out at its scheduled time (or as soon as pacing allows) on the accounts ticked on its card${partialN ? ` — ${partialN} of them skip${partialN === 1 ? 's' : ''} some accounts` : ''}.`, confirm: 'Approve' }))) return;
  batching.value = true;
  let done = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try { await api('posts.approve', { id, accountIds: partialOf(id) }); done++; } catch (e) { errors.push((e as Error).message); }
  }
  batching.value = false;
  selected.value = [];
  if (done) ok(`Approved ${done} ${done === 1 ? 'post' : 'posts'}`);
  if (errors.length) fail(new Error(errors[0]), `${errors.length} could not be approved`);
  void reload(true);
}
</script>

<template>
  <div class="page approvals">
    <PageHeader eyebrow="Posting" title="Approvals">
      <span v-if="data">{{ data.length ? `${data.length} ${data.length === 1 ? 'post' : 'posts'} waiting` : 'Inbox clear' }}</span>
      <span v-if="data?.length" class="muted">Each was filled in its brand’s window and stopped before the final button.</span>
      <template #actions>
        <Btn v-if="data?.length" variant="ghost" @click="selected = selected.length === data.length ? [] : data.map(p => p.id)">{{ selected.length === data.length ? 'Clear selection' : 'Select all' }}</Btn>
        <Btn v-if="selected.length" variant="signal" icon="check" :loading="batching" @click="approveSelected">Approve {{ selected.length }}</Btn>
      </template>
    </PageHeader>

    <div v-if="loading" class="col gap-4"><div v-for="i in 2" :key="i" class="skel" style="height: 260px; border-radius: 8px" /></div>
    <EmptyState v-else-if="error && !data" icon="warn" title="Approvals aren’t available yet" :body="error"><Btn size="sm" icon="refresh" @click="reload()">Try again</Btn></EmptyState>
    <EmptyState v-else-if="!data?.length" icon="approve" title="Nothing waiting" body="When a post for a brand that needs approval is prepared, it lands here with a screenshot of each filled composer.">
      <Btn size="sm" icon="calendar" to="/calendar">Open calendar</Btn>
    </EmptyState>

    <TransitionGroup v-else tag="div" name="list" class="groups">
      <section v-for="g in groups" :key="g.brandId" class="grp">
        <div class="section-title">
          <div class="row gap-2 minw"><BrandAvatar :brand="g.brand ?? { name: '?' }" :size="22" /><h2 class="h3 ellipsis" :title="g.brand?.name">{{ g.brand?.name ?? 'Unknown brand' }}</h2><span class="tiny muted num">{{ g.posts.length }}</span></div>
          <button type="button" class="small link muted" :aria-label="`${groupAll(g.posts) ? 'Unselect' : 'Select'} every post for ${g.brand?.name ?? 'this brand'}`" @click="toggleGroup(g.posts)">{{ groupAll(g.posts) ? 'Unselect these' : 'Select these' }}</button>
        </div>
        <TransitionGroup tag="div" name="list" class="cards">
          <ApprovalCard v-for="p in g.posts" :key="p.id" :post="p" :media="media" :selected="selected.includes(p.id)" @update:selected="v => setSel(p.id, v)" @picked="ids => setPicks(p, ids)" @done="reload(true)" />
        </TransitionGroup>
      </section>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.groups { display: flex; flex-direction: column; gap: var(--s7); }
.cards { display: flex; flex-direction: column; gap: var(--s4); }
.minw { min-width: 0; }
</style>
