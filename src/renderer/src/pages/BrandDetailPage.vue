<script setup lang="ts">
// Brand detail (PLAN 6.3): header with status and window controls; tabs (?tab=) for overview,
// accounts, settings, cookies, extensions, posts and activity.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BrandRow } from '@shared/types';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Tabs from '@/components/ui/Tabs.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import AccountBadge from '@/components/common/AccountBadge.vue';
import LoadError from '@/components/common/LoadError.vue';
import BrandStatus from '@/components/brands/BrandStatus.vue';
import ExportBrandsModal from '@/components/brands/ExportBrandsModal.vue';
import OverviewTab from '@/components/brands/detail/OverviewTab.vue';
import AccountsTab from '@/components/brands/detail/AccountsTab.vue';
import SettingsTab from '@/components/brands/detail/SettingsTab.vue';
import CookiesTab from '@/components/brands/detail/CookiesTab.vue';
import ExtensionsTab from '@/components/brands/detail/ExtensionsTab.vue';
import PostsTab from '@/components/brands/detail/PostsTab.vue';
import ActivityTab from '@/components/brands/detail/ActivityTab.vue';
import { loginUrls, useBrandActions } from '@/components/brands/actions';
import { serialText } from '@/components/common/login';
import { api, on } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail, ok } from '@/composables/toast';

const route = useRoute();
const router = useRouter();
const act = useBrandActions();
const id = computed(() => String(route.params.id ?? ''));
const brand = useLoad(() => api('brands.get', { id: id.value }), { topics: ['brands.changed', 'accounts.changed'], deps: [id] });
// window / taskbar title names the brand
watch(() => brand.data.value?.name, (n) => { if (n) document.title = `${n} — Cubby`; }, { immediate: true });
const b = computed<BrandRow | null>(() => brand.data.value);
const off = on('brand.status', e => { if (b.value && e.id === b.value.id) brand.data.value = { ...b.value, status: e.status, statusError: e.error ?? null, lastOpenedAt: e.status === 'open' ? new Date().toISOString() : b.value.lastOpenedAt }; });
onBeforeUnmount(off);

const TABS = ['overview', 'accounts', 'settings', 'cookies', 'extensions', 'posts', 'activity'] as const;
type Tab = (typeof TABS)[number];
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'overview'),
  set: t => void router.replace({ query: { ...route.query, tab: t === 'overview' ? undefined : t } })
});
const tabs = computed(() => [
  { value: 'overview', label: 'Overview' },
  { value: 'accounts', label: 'Accounts', count: b.value?.accounts.length || null },
  { value: 'settings', label: 'Settings' },
  { value: 'cookies', label: 'Cookies' },
  { value: 'extensions', label: 'Extensions' },
  { value: 'posts', label: 'Posts', count: b.value?.upcoming || null },
  { value: 'activity', label: 'Activity' }
]);
document.title = 'Cubby';
watch(b, v => { if (v) document.title = `${v.name} — Cubby`; });
onBeforeUnmount(() => (document.title = 'Cubby'));

const exporting = ref(false);
const isOpen = computed(() => b.value?.status === 'open' || b.value?.status === 'opening');
/** In the recycle bin: nothing that opens its Chrome works until it is restored. */
const binned = computed(() => !!b.value?.deletedAt);
const daysLeft = computed(() => (b.value?.deletedAt ? Math.max(0, Math.ceil((new Date(b.value.deletedAt).getTime() + 30 * 864e5 - Date.now()) / 864e5)) : 0));
const revealProfile = () => { if (b.value) api('app.revealPath', { path: b.value.profileDir }).catch(e => fail(e)); };
const more = computed(() => {
  if (!b.value) return [];
  return [
    { label: 'Open login pages', icon: 'key', disabled: !b.value.accounts.length, run: () => void act.open(b.value!, loginUrls(b.value!)) },
    { label: 'Health check', icon: 'pulse', disabled: !b.value.accounts.length, run: () => void act.health(b.value!) },
    { label: 'Show profile folder', icon: 'folder', run: revealProfile },
    { label: 'Export…', icon: 'download', run: () => (exporting.value = true) },
    { divider: true, label: '' },
    { label: 'Delete', icon: 'trash', danger: true, run: () => void act.remove([b.value!], () => router.push('/')) }
  ];
});
const binBusy = ref<'restore' | 'purge' | null>(null);
async function restore() {
  if (!b.value || binBusy.value) return;
  binBusy.value = 'restore';
  try { await api('brands.restore', { ids: [b.value.id] }); ok(`${b.value.name} restored`); } catch (e) { fail(e, 'Could not restore'); } finally { binBusy.value = null; }
}
async function purge() {
  if (!b.value || binBusy.value) return;
  const name = b.value.name;
  if (!(await confirm({ title: `Delete ${name} forever?`, body: 'Its Chrome profile — logins, cookies, extensions, history — and its saved accounts are deleted from this computer. This cannot be undone.', confirm: 'Delete forever', danger: true }))) return;
  binBusy.value = 'purge';
  try { await api('brands.purge', { ids: [b.value.id] }); ok(`${name} deleted`); void router.push('/recycle'); } catch (e) { fail(e, 'Could not delete'); } finally { binBusy.value = null; }
}
const notFound = computed(() => !!brand.error.value && /not found/i.test(brand.error.value));
</script>

<template>
  <div class="page bd">
    <RouterLink to="/" class="back"><Icon name="arrow-left" :size="14" /><span>Brands</span></RouterLink>

    <EmptyState v-if="notFound" icon="cubby" title="This brand no longer exists" body="It may have been deleted for good from the recycle bin."><Btn to="/" icon="arrow-left">Back to brands</Btn></EmptyState>
    <LoadError v-else-if="brand.error.value && !b" :error="brand.error.value" title="Could not load this brand" @retry="brand.reload()" />

    <template v-else>
      <header class="hd-wrap">
        <div v-if="b" class="hd">
          <BrandAvatar :brand="b" :size="64" class="av" />
          <div class="id">
            <div class="label meta"><span class="code">{{ serialText(b.serial) }}</span><template v-if="b.groupName"><span class="sl" /><span class="ellipsis" :title="b.groupName">{{ b.groupName }}</span></template></div>
            <h1 class="display title" :title="b.name"><span class="mask"><span class="clamp">{{ b.name }}</span></span></h1>
            <div class="sub">
              <BrandStatus :status="b.status" :error="b.statusError" />
              <span v-if="b.accounts.length" class="accts"><AccountBadge v-for="a in b.accounts" :key="a.id" :account="a" /></span>
              <span v-for="t in b.tags" :key="t" class="tg" :title="t">{{ t }}</span>
            </div>
          </div>
          <div v-if="!binned" class="acts">
            <Btn v-if="isOpen" icon="front" :disabled="b.status !== 'open'" @click="act.front(b)">Bring to front</Btn>
            <Btn icon="globe" variant="subtle" @click="act.openUrl(b)">Open URL…</Btn>
            <Btn v-if="isOpen" :loading="act.pending.has(b.id) || b.status === 'opening'" @click="act.close(b)">Close</Btn>
            <Btn v-else variant="primary" icon="open" :loading="act.pending.has(b.id)" @click="act.open(b)">{{ b.status === 'error' ? 'Reopen' : 'Open' }}</Btn>
            <Menu :items="more" :width="220">
              <button type="button" class="sq" aria-label="More actions" title="More actions"><Icon name="more" :size="18" :stroke="3" /></button>
            </Menu>
          </div>
        </div>
        <div v-else class="hd" aria-busy="true">
          <div class="skel av" style="width: 64px; height: 64px; border-radius: 16px" />
          <div class="id"><div class="skel-line" style="width: 80px" /><div class="skel" style="width: 260px; max-width: 100%; height: 44px; margin-top: 12px" /><div class="skel-line" style="width: 180px; margin-top: 14px" /></div>
        </div>
      </header>

      <div v-if="b?.deletedAt" class="binned" role="status">
        <Icon name="recycle" :size="16" />
        <span class="small msg">This brand is in the recycle bin — restore it to open it again. It is deleted for good in {{ daysLeft }} day{{ daysLeft === 1 ? '' : 's' }}.</span>
        <span class="bin-acts">
          <Btn size="sm" variant="danger" icon="trash" :loading="binBusy === 'purge'" :disabled="binBusy === 'restore'" @click="purge">Delete forever</Btn>
          <Btn size="sm" variant="primary" icon="undo" :loading="binBusy === 'restore'" :disabled="binBusy === 'purge'" @click="restore">Restore</Btn>
        </span>
      </div>

      <Tabs v-model="tab" :tabs="tabs" class="tabs" />

      <div v-if="b" class="tab-body">
        <Transition name="fade" mode="out-in">
          <OverviewTab v-if="tab === 'overview'" :key="`o${b.id}`" :brand="b" @tab="t => (tab = t as Tab)" />
          <AccountsTab v-else-if="tab === 'accounts'" :key="`a${b.id}`" :brand="b" />
          <SettingsTab v-else-if="tab === 'settings'" :key="`s${b.id}`" :brand="b" />
          <CookiesTab v-else-if="tab === 'cookies'" :key="`c${b.id}`" :brand="b" />
          <ExtensionsTab v-else-if="tab === 'extensions'" :key="`e${b.id}`" :brand="b" />
          <PostsTab v-else-if="tab === 'posts'" :key="`p${b.id}`" :brand="b" />
          <ActivityTab v-else :key="`l${b.id}`" :brand="b" />
        </Transition>
      </div>
      <div v-else class="tab-body"><div class="skel-line" style="width: 50%" /><div class="skel-line mt-3" style="width: 35%" /></div>
    </template>

    <ExportBrandsModal v-if="b" v-model:open="exporting" :ids="[b.id]" :names="[b.name]" />
  </div>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--muted); margin-bottom: 18px; transition: color 200ms, gap 300ms var(--ease-out); }
.back:hover { color: var(--fg); gap: 9px; }
.hd-wrap { container-type: inline-size; padding-bottom: 22px; }
.hd { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: end; column-gap: 20px; row-gap: 18px; }
.id { min-width: 0; }
.acts { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
/* not enough room beside a long name: the actions move to their own row */
@container (max-width: 860px) { .hd { grid-template-columns: auto minmax(0, 1fr); } .acts { grid-column: 1 / -1; justify-content: flex-start; flex-wrap: wrap; } }
.meta { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; min-width: 0; }
.sl { width: 1.5px; height: 11px; flex: none; background: var(--fg); transform: skewX(calc(var(--slash) * -1)); }
.title .mask { display: block; }
.title .clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; padding-bottom: .1em; margin-bottom: -.1em; }
.sub { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; min-width: 0; }
.accts { display: inline-flex; gap: 5px; flex-wrap: wrap; }
.tg { height: 22px; max-width: 220px; line-height: 22px; padding: 0 9px; border-radius: var(--r-pill); background: var(--panel-2); font-size: var(--fs-xs); font-weight: 500; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sq { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--line-strong); color: var(--fg); transition: border-color 200ms, background-color 200ms; }
.sq:hover { border-color: var(--fg); background: var(--panel-2); }
.sq:active { background: var(--line); }
.binned { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; padding: 10px 10px 10px 16px; margin-bottom: 16px; border-radius: var(--r-lg); background: var(--warn-bg); color: var(--warn); }
.binned .msg { flex: 1 1 300px; color: var(--fg-2); }
.bin-acts { display: flex; gap: 8px; margin-left: auto; }
.tabs { margin-bottom: 22px; position: sticky; top: var(--topbar); z-index: 20; background: var(--bg); }
.tab-body { min-height: 300px; }
</style>
