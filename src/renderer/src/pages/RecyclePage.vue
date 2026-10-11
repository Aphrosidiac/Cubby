<script setup lang="ts">
// Recycle bin (PLAN 6.12): deleted brands stay 30 days with their profiles; Restore or Delete forever.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { BrandRow } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import DataTable from '@/components/ui/DataTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import LoadError from '@/components/common/LoadError.vue';
import { serialText } from '@/components/common/login';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail, ok } from '@/composables/toast';
import { date, dateTime } from '@/lib/format';

const DAYS = 30;
const list = useLoad(() => api('brands.list', { filter: { deleted: true } }), { topics: ['brands.changed'] });
const rows = computed(() => [...(list.data.value ?? [])].sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')));
const left = (b: BrandRow) => Math.max(0, Math.ceil((new Date(b.deletedAt ?? Date.now()).getTime() + DAYS * 864e5 - Date.now()) / 864e5));
const busy = ref<string | null>(null);

async function restore(bs: BrandRow[]) {
  busy.value = bs.length === 1 ? `r-${bs[0].id}` : 'all';
  try { await api('brands.restore', { ids: bs.map(b => b.id) }); ok(bs.length === 1 ? `${bs[0].name} restored` : `${bs.length} brands restored`); }
  catch (e) { fail(e, 'Could not restore'); } finally { busy.value = null; }
}
async function purge(bs: BrandRow[], all = false) {
  const one = bs.length === 1 && !all;
  if (!(await confirm({
    title: one ? `Delete ${bs[0].name} forever?` : `Empty the recycle bin?`,
    body: one ? 'Its Chrome profile — logins, cookies, extensions, history — and its saved accounts are deleted from this computer. This cannot be undone.' : `${bs.length} brand${bs.length === 1 ? '' : 's'} and their Chrome profiles, logins and saved accounts are deleted from this computer. This cannot be undone.`,
    confirm: one ? 'Delete forever' : 'Empty recycle bin', danger: true
  }))) return;
  busy.value = one ? `p-${bs[0].id}` : 'purge';
  try { await api('brands.purge', { ids: bs.map(b => b.id) }); ok(one ? `${bs[0].name} deleted` : 'Recycle bin emptied'); }
  catch (e) { fail(e, 'Could not delete'); } finally { busy.value = null; }
}
// Narrow windows (the 980 px minimum): accounts fold away and "deleted forever in" moves under the date,
// so the row never runs past the window.
const mq = window.matchMedia('(max-width: 1180px)');
const narrow = ref(mq.matches);
const onMq = (e: MediaQueryListEvent) => (narrow.value = e.matches);
onMounted(() => mq.addEventListener('change', onMq));
onBeforeUnmount(() => mq.removeEventListener('change', onMq));
const cols = computed(() => narrow.value
  ? [
      { key: 'name', label: 'Brand' },
      { key: 'deletedAt', label: 'Deleted', sortable: true },
      { key: 'actions', label: '', align: 'right' as const }
    ]
  : [
      { key: 'name', label: 'Brand' },
      { key: 'accounts', label: 'Accounts', hideSm: true },
      { key: 'deletedAt', label: 'Deleted', sortable: true },
      { key: 'left', label: 'Deleted forever in' },
      { key: 'actions', label: '', align: 'right' as const }
    ]);
const leftText = (b: BrandRow) => (left(b) === 0 ? 'Today' : `${left(b)} day${left(b) === 1 ? '' : 's'}`);
</script>

<template>
  <div class="page">
    <PageHeader eyebrow="Recycle bin" title="Recycle bin">
      <span>Deleted brands are kept {{ DAYS }} days with their logins, then removed for good.</span>
      <template v-if="rows.length" #actions>
        <Btn size="sm" icon="undo" :loading="busy === 'all'" @click="restore(rows)">Restore all</Btn>
        <Btn size="sm" variant="danger" icon="trash" :loading="busy === 'purge'" @click="purge(rows, true)">Empty recycle bin</Btn>
      </template>
    </PageHeader>

    <LoadError v-if="list.error.value" :error="list.error.value" title="Could not load the recycle bin" @retry="list.reload()" />
    <DataTable v-else :columns="cols" :rows="rows" :loading="list.loading.value" :clickable="false">
      <template #cell-name="{ row }">
        <div class="nm"><BrandAvatar :brand="row" :size="30" class="dim" /><div class="nm-t" :title="row.name"><div class="strong ellipsis">{{ row.name }}</div><div class="tiny muted code ellipsis">{{ serialText(row.serial) }}{{ row.groupName ? ` · ${row.groupName}` : '' }}</div></div></div>
      </template>
      <template #cell-accounts="{ row }">
        <div class="row gap-2"><PlatformIcon v-for="a in row.accounts" :key="a.id" :platform="a.platform" :size="15" :title="a.handle" /><span v-if="!row.accounts.length" class="faint">—</span></div>
      </template>
      <template #cell-deletedAt="{ row }">
        <div class="small nowrap" :title="dateTime(row.deletedAt)">{{ date(row.deletedAt) }}</div>
        <div v-if="narrow" class="tiny nowrap num" :class="left(row) <= 3 ? 'soon' : 'muted'">{{ left(row) === 0 ? 'Deleted forever today' : `Deleted forever in ${leftText(row)}` }}</div>
      </template>
      <template #cell-left="{ row }"><span class="small nowrap num" :class="{ soon: left(row) <= 3 }">{{ leftText(row) }}</span></template>
      <template #cell-actions="{ row }">
        <div class="row gap-2 end nowrap">
          <Btn size="sm" icon="undo" :loading="busy === `r-${row.id}`" @click="restore([row])">Restore</Btn>
          <Btn size="sm" variant="danger" :loading="busy === `p-${row.id}`" @click="purge([row])">Delete forever</Btn>
        </div>
      </template>
      <template #empty>
        <EmptyState icon="recycle" title="The recycle bin is empty" body="Brands you delete wait here for 30 days, logins and all, in case you change your mind.">
          <Btn size="sm" to="/" icon="arrow-left">Back to brands</Btn>
        </EmptyState>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.nm { display: flex; align-items: center; gap: 12px; min-width: 0; }
.nm-t { min-width: 0; max-width: 260px; }
.dim { filter: grayscale(.6); opacity: .8; }
.soon { color: var(--bad); font-weight: 500; }
</style>
