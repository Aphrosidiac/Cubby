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
import { fail, ok } from '@/composables/toast';

const route = useRoute();
const router = useRouter();
const act = useBrandActions();
const id = computed(() => String(route.params.id ?? ''));
const brand = useLoad(() => api('brands.get', { id: id.value }), { topics: ['brands.changed', 'accounts.changed'], deps: [id] });
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
const more = computed(() => (b.value ? [
  { label: 'Open login pages', icon: 'key', disabled: !b.value.accounts.length, run: () => void act.open(b.value!, loginUrls(b.value!)) },
  { label: 'Health check', icon: 'pulse', run: () => void act.health(b.value!) },
  { label: 'Show profile folder', icon: 'folder', run: () => void api('app.revealPath', { path: b.value!.profileDir }).catch(e => fail(e)) },
  { label: 'Export…', icon: 'download', run: () => (exporting.value = true) },
  { divider: true, label: '' },
  { label: 'Delete', icon: 'trash', danger: true, run: () => void act.remove([b.value!], () => router.push('/')) }
] : []));
async function restore() {
  if (!b.value) return;
  try { await api('brands.restore', { ids: [b.value.id] }); ok(`${b.value.name} restored`); } catch (e) { fail(e); }
}
const notFound = computed(() => !!brand.error.value && /not found/i.test(brand.error.value));
</script>

<template>
  <div class="page bd">
    <RouterLink to="/" class="back"><Icon name="arrow-left" :size="14" /><span>Brands</span></RouterLink>

    <EmptyState v-if="notFound" icon="cubby" title="This brand no longer exists" body="It may have been deleted for good from the recycle bin."><Btn to="/" icon="arrow-left">Back to brands</Btn></EmptyState>
    <LoadError v-else-if="brand.error.value && !b" :error="brand.error.value" title="Could not load this brand" @retry="brand.reload()" />

    <template v-else>
      <header class="hd">
        <template v-if="b">
          <BrandAvatar :brand="b" :size="64" />
          <div class="grow id">
            <div class="label meta"><span class="code">{{ serialText(b.serial) }}</span><template v-if="b.groupName"><span class="sl" />{{ b.groupName }}</template></div>
            <h1 class="display title"><span class="mask"><span>{{ b.name }}</span></span></h1>
            <div class="sub">
              <BrandStatus :status="b.status" :error="b.statusError" />
              <span v-if="b.accounts.length" class="accts"><AccountBadge v-for="a in b.accounts" :key="a.id" :account="a" /></span>
              <span v-for="t in b.tags" :key="t" class="tg">{{ t }}</span>
            </div>
          </div>
          <div class="acts">
            <Btn v-if="isOpen" icon="front" :disabled="b.status !== 'open'" @click="act.front(b)">Bring to front</Btn>
            <Btn icon="globe" variant="subtle" @click="act.openUrl(b)">Open URL…</Btn>
            <Btn v-if="isOpen" :loading="act.pending.has(b.id) || b.status === 'opening'" @click="act.close(b)">Close</Btn>
            <Btn v-else variant="primary" icon="open" :loading="act.pending.has(b.id)" @click="act.open(b)">{{ b.status === 'error' ? 'Reopen' : 'Open' }}</Btn>
            <Menu :items="more" :width="220">
              <button type="button" class="sq" aria-label="More actions"><Icon name="more" :size="18" :stroke="3" /></button>
            </Menu>
          </div>
        </template>
        <template v-else>
          <div class="skel" style="width: 64px; height: 64px; border-radius: 16px" />
          <div class="grow"><div class="skel-line" style="width: 80px" /><div class="skel" style="width: 260px; height: 44px; margin-top: 12px" /><div class="skel-line" style="width: 180px; margin-top: 14px" /></div>
        </template>
      </header>

      <div v-if="b?.deletedAt" class="binned">
        <Icon name="recycle" :size="16" /><span class="grow small">This brand is in the recycle bin. It is deleted for good 30 days after it was removed.</span>
        <Btn size="sm" variant="primary" icon="undo" @click="restore">Restore</Btn>
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
.hd { display: flex; align-items: flex-end; gap: 20px; padding-bottom: 22px; flex-wrap: wrap; }
.id { min-width: 260px; }
.meta { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.sl { width: 1.5px; height: 11px; background: var(--fg); transform: skewX(calc(var(--slash) * -1)); }
.title { overflow-wrap: anywhere; }
.sub { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.accts { display: inline-flex; gap: 5px; }
.tg { height: 22px; display: inline-flex; align-items: center; padding: 0 9px; border-radius: var(--r-pill); background: var(--panel-2); font-size: var(--fs-xs); font-weight: 500; color: var(--fg-2); }
.sq { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--line-strong); color: var(--fg); transition: border-color 200ms, background-color 200ms; }
.sq:hover { border-color: var(--fg); background: var(--panel-2); }
.acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.binned { display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 16px; margin-bottom: 16px; border-radius: var(--r-lg); background: var(--warn-bg); color: var(--warn); }
.binned .small { color: var(--fg-2); }
.tabs { margin-bottom: 22px; position: sticky; top: var(--topbar); z-index: 20; background: var(--bg); }
.tab-body { min-height: 300px; }
</style>
