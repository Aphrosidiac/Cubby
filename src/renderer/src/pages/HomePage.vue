<script setup lang="ts">
// Brands home (PLAN 6.1): every brand with its group, tags, login health and window status;
// search + filters, sort, drag to reorder, batch actions, window tools, CSV / .brand import.
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BrandRow } from '@shared/types';
import { PLATFORMS } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Modal from '@/components/ui/Modal.vue';
import Field from '@/components/ui/Field.vue';
import Select from '@/components/ui/Select.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import LoadError from '@/components/common/LoadError.vue';
import BrandTable, { type SortKey } from '@/components/brands/BrandTable.vue';
import BrandCards from '@/components/brands/BrandCards.vue';
import BrandSidebar from '@/components/brands/BrandSidebar.vue';
import GroupSelect from '@/components/brands/GroupSelect.vue';
import TagInput from '@/components/brands/TagInput.vue';
import ExportBrandsModal from '@/components/brands/ExportBrandsModal.vue';
import type { BrandFilter } from '@/components/brands/filter';
import { useBrandActions } from '@/components/brands/actions';
import { downloadCsvTemplate, importBrandFile, pickCsvAndCreate } from '@/components/brands/importers';
import { api, on } from '@/lib/api';
import type { In } from '@shared/contract';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail, ok, toast } from '@/composables/toast';
import { LOGIN_LABEL } from '@/components/common/login';

const router = useRouter();
const route = useRoute();
const act = useBrandActions();

// ── remembered view prefs ──
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const view = ref<'table' | 'cards'>(read('cubby-brands-view') === 'cards' ? 'cards' : 'table');
watch(view, v => store('cubby-brands-view', v));
const sort = ref<{ key: SortKey; dir: 1 | -1 } | null>((() => { try { return JSON.parse(read('cubby-brands-sort') ?? 'null'); } catch { return null; } })());
watch(sort, v => store('cubby-brands-sort', JSON.stringify(v)), { deep: true });
const sideOpen = ref(read('cubby-brands-side') !== 'closed');
watch(sideOpen, v => store('cubby-brands-side', v ? 'open' : 'closed'));
// below ~820px of page width the groups/tags column becomes a panel opened with the toggle
const root = ref<HTMLElement | null>(null);
const width = ref(1200);
const narrow = computed(() => width.value < 820);
const overlay = ref(false);
const showSide = computed(() => (narrow.value ? overlay.value : sideOpen.value));
function toggleSide() { if (narrow.value) overlay.value = !overlay.value; else sideOpen.value = !sideOpen.value; }
// the list column narrows: the three filter pills fold into one "Filters" popover so the toolbar stays one line
const mainEl = ref<HTMLElement | null>(null);
const mainW = ref(900);
const compact = computed(() => mainW.value < 760);
const filtersOpen = ref(false);
let ro: ResizeObserver | null = null;
const outside = (e: MouseEvent) => {
  const t = e.target as HTMLElement;
  if (overlay.value && !t.closest('.side, .side-tg, .modal-root, .menu')) overlay.value = false;
  if (filtersOpen.value && !t.closest('.fpop, .ftg, .ff-select-pop')) filtersOpen.value = false;
};
onMounted(() => {
  ro = new ResizeObserver(ens => { for (const en of ens) { if (en.target === root.value) width.value = en.contentRect.width; else mainW.value = en.contentRect.width; } });
  if (root.value) ro.observe(root.value);
  if (mainEl.value) ro.observe(mainEl.value);
  document.addEventListener('mousedown', outside);
});
watch(mainEl, (el, old) => { if (old) ro?.unobserve(old); if (el) ro?.observe(el); }, { flush: 'post' });
watch(compact, c => { if (!c) filtersOpen.value = false; });
onBeforeUnmount(() => { ro?.disconnect(); document.removeEventListener('mousedown', outside); });

// ── filter + search ──
const filter = reactive<BrandFilter>({});
const q = ref(typeof route.query.q === 'string' ? route.query.q : '');
// opened from a .brand file (Explorer / Finder double-click → `/?import=<path>`)
watch(() => route.query.import, async (p) => {
  if (typeof p !== 'string' || !p) return;
  void router.replace({ query: { ...route.query, import: undefined } });
  await importBrandFile(p);
}, { immediate: true });
const qLive = ref(q.value);
let qt = 0;
watch(q, v => { clearTimeout(qt); qt = window.setTimeout(() => (qLive.value = v.trim()), 140); });
function setFilter(f: BrandFilter) { overlay.value = false; for (const k of Object.keys(filter) as (keyof BrandFilter)[]) delete filter[k]; Object.assign(filter, f); selected.value = new Set(); }
const clean = computed(() => Object.fromEntries(Object.entries(filter).filter(([, v]) => !!v)) as BrandFilter);
const active = computed(() => !!qLive.value || Object.keys(clean.value).length > 0);
function clearAll() { setFilter({}); q.value = ''; qLive.value = ''; }

const TOPICS = ['brands.changed', 'accounts.changed'];
const all = useLoad(() => api('brands.list', {}), { topics: TOPICS });
const filtered = useLoad(() => (active.value ? api('brands.list', { filter: { ...clean.value, q: qLive.value || undefined } as NonNullable<In<'brands.list'>>['filter'] }) : Promise.resolve(null)), {
  topics: TOPICS, deps: [() => JSON.stringify(clean.value), qLive]
});
// while the first filtered result is on its way, keep showing the rows already on screen
// (no flash back to the skeleton on the first keystroke)
const rows = shallowRef<BrandRow[] | null>(null);
watchEffect(() => {
  const next = active.value ? filtered.data.value : all.data.value;
  if (next !== null || !active.value) rows.value = next;
});
const loading = computed(() => all.loading.value || (active.value && filtered.loading.value && !filtered.data.value));
const groups = useLoad(() => api('groups.list'), { topics: ['brands.changed'] });
const tags = useLoad(() => api('tags.list'), { topics: ['brands.changed'] });
const groupColor = (id: string | null) => groups.data.value?.find(g => g.id === id)?.color ?? null;

// window status arrives as events: patch the row in place, never refetch-and-flicker
const offStatus = on('brand.status', ({ id, status, error }) => {
  const patch = (list: BrandRow[] | null) => list?.map(b => (b.id === id ? { ...b, status, statusError: error ?? null, lastOpenedAt: status === 'open' ? new Date().toISOString() : b.lastOpenedAt } : b)) ?? null;
  all.data.value = patch(all.data.value);
  if (filtered.data.value) filtered.data.value = patch(filtered.data.value);
  if (filter.status) void filtered.reload(true);
});
onBeforeUnmount(offStatus);

const counts = computed(() => {
  const a = all.data.value ?? [];
  return {
    total: all.data.value ? a.length : null,
    open: a.filter(b => b.status === 'open' || b.status === 'opening').length,
    relogin: a.filter(b => b.accounts.some(x => x.loginState === 'expired')).length,
    ungrouped: a.filter(b => !b.groupId).length
  };
});
const openIds = computed(() => (all.data.value ?? []).filter(b => b.status === 'open').map(b => b.id));

// ── selection + batch ──
const selected = ref(new Set<string>());
watch(rows, r => { if (!r) return; const ids = new Set(r.map(b => b.id)); const keep = [...selected.value].filter(id => ids.has(id)); if (keep.length !== selected.value.size) selected.value = new Set(keep); });
const selRows = computed(() => (all.data.value ?? []).filter(b => selected.value.has(b.id)));
const batchBusy = ref<string | null>(null);
async function batch(action: 'open' | 'close' | 'health', label: string) {
  const ids = [...selected.value];
  batchBusy.value = action;
  try {
    const r = await api('brands.batch', { ids, action });
    if (r.errors.length) toast(`${label} ${r.ok} of ${ids.length} — ${r.errors.length} failed`, { tone: 'warn', body: r.errors.slice(0, 3).join(' · ') });
    else ok(`${label} ${r.ok} brand${r.ok === 1 ? '' : 's'}`);
  } catch (e) { fail(e, `${label} failed`); } finally { batchBusy.value = null; }
}
async function batchDelete() { if (await act.remove(selRows.value)) selected.value = new Set(); }

const bulk = ref<{ kind: 'move' | 'addTags' | 'removeTags'; ids: string[]; groupId: string | null; tags: string[] } | null>(null);
const bulkBusy = ref(false);
const bulkTitle = computed(() => {
  const b = bulk.value;
  if (!b) return '';
  const what = b.ids.length === 1 ? (all.data.value?.find(x => x.id === b.ids[0])?.name ?? '1 brand') : `${b.ids.length} brands`;
  return b.kind === 'move' ? `Move ${what} to a group` : b.kind === 'addTags' ? `Add tags to ${what}` : `Remove tags from ${what}`;
});
const tagsOfSelection = computed(() => [...new Set((all.data.value ?? []).filter(b => bulk.value?.ids.includes(b.id)).flatMap(b => b.tags))]);
async function runBulk() {
  const b = bulk.value;
  if (!b) return;
  if (b.kind !== 'move' && !b.tags.length) return;
  bulkBusy.value = true;
  try {
    const r = await api('brands.batch', { ids: b.ids, action: b.kind, groupId: b.kind === 'move' ? b.groupId : undefined, tags: b.kind === 'move' ? undefined : b.tags });
    if (r.errors.length) toast(`${r.ok} updated, ${r.errors.length} failed`, { tone: 'warn', body: r.errors.slice(0, 3).join(' · ') });
    else ok(b.kind === 'move' ? 'Moved' : b.kind === 'addTags' ? 'Tags added' : 'Tags removed');
    bulk.value = null;
  } catch (e) { fail(e); } finally { bulkBusy.value = false; }
}
const menuExtra = (b: BrandRow) => [
  { label: 'Move to group…', icon: 'folder', run: () => (bulk.value = { kind: 'move', ids: [b.id], groupId: b.groupId, tags: [] }) },
  { label: 'Export…', icon: 'download', run: () => openExport([b.id]) }
];

const exporting = ref<string[] | null>(null);
const exportNames = computed(() => (exporting.value ?? []).map(id => all.data.value?.find(b => b.id === id)?.name ?? ''));
function openExport(ids: string[]) { exporting.value = ids; }

// ── window tools ──
const arranging = ref<string | null>(null);
async function arrange(mode: 'tile' | 'cascade') {
  const ids = selRows.value.filter(b => b.status === 'open').map(b => b.id);
  arranging.value = mode;
  try { await api('brands.arrange', { mode, ids: ids.length ? ids : undefined }); } catch (e) { fail(e, mode === 'tile' ? 'Could not tile windows' : 'Could not cascade windows'); } finally { arranging.value = null; }
}
async function closeAll() {
  const n = openIds.value.length;
  if (!(await confirm({ title: n === 1 ? 'Close the open brand window?' : `Close all ${n} open brand windows?`, body: n === 1 ? 'Logins and tabs are kept — Chrome restores them next time the brand opens.' : 'Logins and tabs are kept — Chrome restores them next time each brand opens.', confirm: n === 1 ? 'Close it' : 'Close all' }))) return;
  arranging.value = 'close';
  try { await api('brands.closeAll'); ok(n === 1 ? 'Brand window closed' : 'All brand windows closed'); } catch (e) { fail(e); } finally { arranging.value = null; }
}

// ── reorder (only when the list is in its own order) ──
const reorderable = computed(() => !sort.value && view.value === 'table');
async function reorder(subset: string[]) {
  const full = (all.data.value ?? []).map(b => b.id);
  const set = new Set(subset);
  const slots = full.map((id, i) => (set.has(id) ? i : -1)).filter(i => i >= 0);
  const next = [...full];
  slots.forEach((slot, k) => (next[slot] = subset[k]));
  const byId = new Map((all.data.value ?? []).map(b => [b.id, b]));
  all.data.value = next.map(id => byId.get(id)!).filter(Boolean);
  if (filtered.data.value) { const fb = new Map(filtered.data.value.map(b => [b.id, b])); filtered.data.value = subset.map(id => fb.get(id)!).filter(Boolean); }
  try { await api('brands.reorder', { ids: next }); } catch (e) { fail(e, 'Could not save the new order'); void all.reload(true); }
}

// ── import ──
const importMenu = [
  { label: 'Batch create from CSV…', icon: 'file', run: () => void pickCsvAndCreate() },
  { label: 'Download CSV template', icon: 'download', run: downloadCsvTemplate },
  { divider: true, label: '' },
  { label: 'Import .brand export…', icon: 'upload', run: () => void importBrandFile() }
];

// ── filter options ──
const platformOpts = [{ value: null, label: 'Any platform' }, ...PLATFORMS.filter(p => p !== 'custom').map(p => ({ value: p, label: PLATFORM_SPECS[p].name }))];
const loginOpts = [{ value: null, label: 'Any login' }, { value: 'ok', label: LOGIN_LABEL.ok }, { value: 'expiring', label: LOGIN_LABEL.expiring }, { value: 'relogin', label: LOGIN_LABEL.expired }, { value: 'unknown', label: LOGIN_LABEL.unknown }];
const statusOpts = [{ value: null, label: 'Any status' }, { value: 'open', label: 'Open' }, { value: 'opening', label: 'Opening' }, { value: 'closed', label: 'Closed' }, { value: 'error', label: 'Error' }];
const groupName = computed(() => (filter.groupId === 'none' ? 'No group' : groups.data.value?.find(g => g.id === filter.groupId)?.name ?? 'Group'));
const setF = (k: keyof BrandFilter, v: string | null) => { if (v) filter[k] = v; else delete filter[k]; };
/** how many of the three toolbar filters are set (shown on the folded "Filters" button) */
const pillCount = computed(() => [filter.platform, filter.loginState, filter.status].filter(Boolean).length);
const VIEWS = [{ value: 'table', icon: 'rows', label: 'Table view' }, { value: 'cards', icon: 'grid', label: 'Card view' }] as const;

function goDetail(b: BrandRow) { void router.push(`/brands/${b.id}`); }

// `/` focuses search here (before the layout's palette shortcut sees it); Esc clears it
const search = ref<HTMLInputElement | null>(null);
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  // a focused checkbox (just used to select rows) is not "typing": Esc should still clear the selection
  const typing = !!t && (t.isContentEditable || ['TEXTAREA', 'SELECT'].includes(t.tagName) || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)));
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); search.value?.focus(); search.value?.select(); }
  else if (e.key === 'Escape' && filtersOpen.value && !document.querySelector('.ff-select-pop')) { filtersOpen.value = false; }
  else if (e.key === 'Escape' && overlay.value) { overlay.value = false; }
  else if (e.key === 'Escape' && !typing && selected.value.size && !document.querySelector('.modal-root, .drawer-root, .menu, .ff-select-pop, .ff-picker-pop')) selected.value = new Set();
}
onMounted(() => window.addEventListener('keydown', onKey, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));

const summary = computed(() => {
  const c = counts.value;
  if (c.total === null) return '';
  const parts = [`${c.total} brand${c.total === 1 ? '' : 's'}`];
  if (c.open) parts.push(`${c.open} open`);
  if (c.relogin) parts.push(`${c.relogin} need${c.relogin === 1 ? 's' : ''} relogin`);
  return parts.join(' · ');
});
const firstRun = computed(() => all.data.value !== null && all.data.value.length === 0);
</script>

<template>
  <div ref="root" class="page home" :class="{ 'side-closed': !showSide || narrow, narrow }">
    <PageHeader eyebrow="Home" title="Brands">
      <span v-if="summary">{{ summary }}</span>
      <template #actions>
        <div v-if="!firstRun" class="tools" role="group" aria-label="Window tools">
          <Btn variant="subtle" icon="tile" :loading="arranging === 'tile'" :disabled="!openIds.length" title="Tile open brand windows (the selected ones, if any)" @click="arrange('tile')">Tile</Btn>
          <Btn variant="subtle" icon="cascade" :loading="arranging === 'cascade'" :disabled="!openIds.length" title="Cascade open brand windows" @click="arrange('cascade')">Cascade</Btn>
          <Btn variant="subtle" icon="close" :loading="arranging === 'close'" :disabled="!openIds.length" title="Close every open brand window" @click="closeAll">Close all</Btn>
        </div>
        <Menu :items="importMenu" :width="240">
          <Btn icon="upload" icon-right="chevron-down">Import</Btn>
        </Menu>
      </template>
    </PageHeader>

    <LoadError v-if="all.error.value && !all.data.value" :error="all.error.value" title="Could not load your brands" @retry="all.reload()" />

    <EmptyState v-else-if="firstRun" icon="cubby" title="Create your first brand" body="Each brand gets its own sealed Chrome profile — its own logins, cookies and extensions — opened from here like AdsPower. Start with one, or bring several in from a CSV.">
      <Btn variant="primary" icon="plus" to="/brands/new">New brand</Btn>
      <Btn icon="file" @click="pickCsvAndCreate">Import CSV</Btn>
      <Btn variant="subtle" icon="upload" @click="importBrandFile()">Import .brand</Btn>
    </EmptyState>

    <div v-else class="layout">
      <Transition name="pop"><aside v-show="showSide" class="side">
        <div v-if="narrow" class="ov-head"><span class="label">Brand views</span><button type="button" class="ov-x" aria-label="Close" @click="overlay = false"><Icon name="close" :size="14" /></button></div>
        <BrandSidebar :filter="clean" :groups="groups.data.value" :tags="tags.data.value" :total="counts.total" :relogin="counts.relogin" :open="counts.open" :ungrouped="counts.ungrouped" @set="setFilter" />
      </aside></Transition>

      <section ref="mainEl" class="main">
        <div class="toolbar">
          <button type="button" class="side-tg" :aria-pressed="showSide" :aria-label="showSide ? 'Hide groups and tags' : 'Show groups and tags'" :title="showSide ? 'Hide groups and tags' : 'Show groups and tags'" @click="toggleSide"><Icon name="sidebar" :size="16" /></button>
          <label class="search" title="Search by name, handle, tag, #serial or notes">
            <Icon name="search" :size="15" />
            <input ref="search" v-model="q" placeholder="Search brands…" aria-label="Search brands by name, handle, tag, serial or notes" spellcheck="false" @keydown.esc="q = ''; ($event.target as HTMLInputElement).blur()" />
            <button v-if="q" type="button" class="clr" aria-label="Clear search" title="Clear search" @click="q = ''"><Icon name="close" :size="12" /></button>
            <kbd v-else class="keys" title="Press / to search">/</kbd>
          </label>
          <template v-if="!compact">
            <Select :model-value="filter.platform ?? null" :options="platformOpts" variant="pill" aria-label="Platform" :min-width="180" @update:model-value="v => setF('platform', v)" />
            <Select :model-value="filter.loginState ?? null" :options="loginOpts" variant="pill" aria-label="Login state" :min-width="170" @update:model-value="v => setF('loginState', v)" />
            <Select :model-value="filter.status ?? null" :options="statusOpts" variant="pill" aria-label="Status" :min-width="150" @update:model-value="v => setF('status', v)" />
          </template>
          <div v-else class="fwrap">
            <button type="button" class="ftg" :class="{ on: filtersOpen || pillCount }" :aria-expanded="filtersOpen" aria-haspopup="dialog" @click="filtersOpen = !filtersOpen">
              <Icon name="filter" :size="15" /><span>Filters</span><span v-if="pillCount" class="fcount num">{{ pillCount }}</span>
            </button>
            <Transition name="pop">
              <div v-if="filtersOpen" class="fpop" role="dialog" aria-label="Filters" @keydown.esc.stop="filtersOpen = false">
                <Select :model-value="filter.platform ?? null" :options="platformOpts" aria-label="Platform" @update:model-value="v => setF('platform', v)" />
                <Select :model-value="filter.loginState ?? null" :options="loginOpts" aria-label="Login state" @update:model-value="v => setF('loginState', v)" />
                <Select :model-value="filter.status ?? null" :options="statusOpts" aria-label="Status" @update:model-value="v => setF('status', v)" />
                <button v-if="pillCount" type="button" class="link small freset" @click="setF('platform', null); setF('loginState', null); setF('status', null)">Reset these filters</button>
              </div>
            </Transition>
          </div>
          <div class="grow" />
          <div class="vt" role="group" aria-label="View">
            <button v-for="o in VIEWS" :key="o.value" type="button" :aria-pressed="view === o.value" :aria-label="o.label" :title="o.label" @click="view = o.value"><Icon :name="o.icon" :size="15" /></button>
          </div>
        </div>

        <TransitionGroup tag="div" name="list" class="chips">
          <button v-if="filter.groupId" key="g" type="button" class="fchip" @click="setF('groupId', null)"><span class="label">Group</span>{{ groupName }}<Icon name="close" :size="11" /></button>
          <button v-if="filter.tag" key="t" type="button" class="fchip" @click="setF('tag', null)"><span class="label">Tag</span>{{ filter.tag }}<Icon name="close" :size="11" /></button>
          <span key="n" class="small muted num">{{ !active ? `${counts.total ?? 0} brand${counts.total === 1 ? '' : 's'}` : filtered.data.value ? `${filtered.data.value.length} of ${counts.total ?? 0}` : 'Filtering…' }}{{ selected.size ? ` · ${selected.size} selected` : '' }}</span>
          <button v-if="active" key="c" type="button" class="link small" @click="clearAll">Clear all</button>
        </TransitionGroup>

        <LoadError v-if="active && filtered.error.value" :error="filtered.error.value" compact class="mb-3" @retry="filtered.reload()" />

        <BrandTable v-if="view === 'table'" v-model:selected="selected" v-model:sort="sort" :rows="rows" :loading="loading" :reorderable="reorderable" :menu-extra="menuExtra" :group-color="groupColor"
          @detail="goDetail" @reorder="reorder" @tag="t => setF('tag', t)">
          <template #empty>
            <EmptyState compact icon="search" title="No brands match" :body="qLive ? `Nothing matches “${qLive}” with these filters.` : 'No brand fits these filters.'"><Btn size="sm" @click="clearAll">Clear filters</Btn></EmptyState>
          </template>
        </BrandTable>
        <BrandCards v-else v-model:selected="selected" :rows="rows" :loading="loading" :menu-extra="menuExtra" :group-color="groupColor" @detail="goDetail" @tag="t => setF('tag', t)">
          <template #empty>
            <EmptyState compact icon="search" title="No brands match" body="No brand fits this search and these filters."><Btn size="sm" @click="clearAll">Clear filters</Btn></EmptyState>
          </template>
        </BrandCards>
        <p v-if="rows?.length && view === 'table'" class="tiny muted hint">
          <span class="keys">Enter opens a brand’s window · Shift+Enter shows its page · Space selects{{ reorderable ? ' · Drag the grip to reorder' : ' · Clear the sort to drag-reorder' }}</span>
        </p>
      </section>
    </div>

    <Transition name="bar">
      <div v-if="selected.size" class="batch" role="toolbar" aria-label="Batch actions">
        <span class="cnt"><span class="num">{{ selected.size }}</span> selected</span>
        <span class="sep" />
        <button type="button" :disabled="!!batchBusy" @click="batch('open', 'Opened')"><Icon name="open" :size="15" /><span>{{ batchBusy === 'open' ? 'Opening…' : 'Open' }}</span></button>
        <button type="button" :disabled="!!batchBusy" @click="batch('close', 'Closed')"><Icon name="close" :size="15" /><span>Close</span></button>
        <button type="button" title="Move to group" @click="bulk = { kind: 'move', ids: [...selected], groupId: null, tags: [] }"><Icon name="folder" :size="15" /><span class="lbl">Move</span></button>
        <Menu :items="[{ label: 'Add tags…', icon: 'plus', run: () => (bulk = { kind: 'addTags', ids: [...selected], groupId: null, tags: [] }) }, { label: 'Remove tags…', icon: 'close', run: () => (bulk = { kind: 'removeTags', ids: [...selected], groupId: null, tags: [] }) }]" :width="180" align="left">
          <button type="button" title="Add or remove tags"><Icon name="tag" :size="15" /><span class="lbl">Tags</span></button>
        </Menu>
        <button type="button" title="Check logins" :disabled="!!batchBusy" @click="batch('health', 'Checked')"><Icon name="pulse" :size="15" /><span class="lbl">{{ batchBusy === 'health' ? 'Checking…' : 'Health check' }}</span></button>
        <button type="button" title="Export to a .brand file" @click="openExport([...selected])"><Icon name="download" :size="15" /><span class="lbl">Export</span></button>
        <button type="button" class="danger" title="Move to the recycle bin" @click="batchDelete"><Icon name="trash" :size="15" /><span class="lbl">Delete</span></button>
        <span class="sep" />
        <button type="button" class="x" aria-label="Clear selection" title="Clear selection (Esc)" @click="selected = new Set()"><Icon name="close" :size="14" /></button>
      </div>
    </Transition>

    <Modal :open="!!bulk" :title="bulkTitle" size="sm" @update:open="v => !v && (bulk = null)">
      <div v-if="bulk" class="col gap-4">
        <Field v-if="bulk.kind === 'move'" label="Group"><GroupSelect v-model="bulk.groupId" /></Field>
        <Field v-else :label="bulk.kind === 'addTags' ? 'Tags to add' : 'Tags to remove'" :hint="bulk.kind === 'addTags' ? 'Enter or comma after each tag. New tags are created.' : undefined">
          <TagInput v-model="bulk.tags" :suggestions="bulk.kind === 'removeTags' ? tagsOfSelection : (tags.data.value ?? []).map(t => t.name)" :placeholder="bulk.kind === 'removeTags' ? 'Pick tags these brands have…' : 'Add a tag…'" />
        </Field>
      </div>
      <template #footer>
        <Btn variant="subtle" @click="bulk = null">Cancel</Btn>
        <Btn variant="primary" :loading="bulkBusy" :disabled="!!bulk && bulk.kind !== 'move' && !bulk.tags.length" @click="runBulk">{{ bulk?.kind === 'move' ? 'Move' : bulk?.kind === 'addTags' ? 'Add tags' : 'Remove tags' }}</Btn>
      </template>
    </Modal>

    <ExportBrandsModal :open="!!exporting" :ids="exporting ?? []" :names="exportNames" @update:open="v => !v && (exporting = null)" />
  </div>
</template>

<style scoped>
.tools { display: flex; gap: 2px; padding-right: 8px; margin-right: 4px; border-right: 1px solid var(--line); }
/* text-weight buttons lead the group: the first icon sits on the content edge when the actions wrap under the title */
.tools > :deep(.btn:first-child) { margin-left: -17px; }
.layout { display: grid; grid-template-columns: 196px minmax(0, 1fr); gap: 28px; align-items: start; }
.side-closed .layout { grid-template-columns: minmax(0, 1fr); }
.side { position: sticky; top: calc(var(--topbar) + 16px); max-height: calc(100vh - var(--topbar) - 32px); overflow-y: auto; overflow-x: visible; padding-right: 2px; }
.main { min-width: 0; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.side-tg { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px; color: var(--muted); border: 1px solid var(--line); background: var(--panel); flex: none; transition: color 160ms, border-color 160ms; }
.side-tg:hover, .side-tg[aria-pressed='true'] { color: var(--fg); border-color: var(--line-strong); }
.search { display: flex; align-items: center; gap: 8px; flex: 1 1 220px; max-width: 380px; height: 40px; padding: 0 10px 0 14px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--muted); transition: border-color 160ms, box-shadow 160ms; }
.search:focus-within { border-color: var(--focus-border); box-shadow: var(--focus-ring); color: var(--fg); }
.search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--fg); font-size: var(--fs-base); }
.search input:focus, .search input:focus-visible { outline: none; box-shadow: none; }
.search input::placeholder { color: var(--faint); }
.clr { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; color: var(--muted); }
.clr:hover { background: var(--panel-2); color: var(--fg); }
.toolbar :deep(.ff-select.v-pill .pill) { height: 40px; }
.fwrap { position: relative; flex: none; }
.ftg { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 13px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--fg-2); font-weight: 500; white-space: nowrap; transition: border-color 160ms, color 160ms; }
.ftg:hover, .ftg.on { border-color: var(--line-strong); color: var(--fg); }
.fcount { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; background: var(--fg); color: var(--bg); font-family: var(--mono); font-size: var(--fs-2xs); }
.fpop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 60; width: 240px; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow-2); }
.freset { align-self: flex-start; margin: 2px 2px 0; }
.vt { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: var(--r-pill); background: var(--panel-2); border: 1px solid var(--line-soft); flex: none; }
.vt button { width: 34px; height: 30px; display: grid; place-items: center; border-radius: var(--r-pill); color: var(--muted); transition: background-color 200ms var(--ease-out), color 200ms; }
.vt button:hover { color: var(--fg); }
.vt button[aria-pressed='true'] { background: var(--fg); color: var(--bg); }
.chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: -2px 0 12px; min-height: 26px; }
.fchip { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 9px 0 10px; border-radius: var(--r-pill); background: var(--fg); color: var(--bg); font-size: var(--fs-sm); font-weight: 500; }
.fchip .label { color: color-mix(in srgb, var(--bg) 60%, transparent); }
.fchip:hover { opacity: .85; }
.hint { margin-top: 14px; }

/* batch bar: Ink, floating over the list, Lime only on the count */
.batch { position: fixed; left: var(--sidebar); right: 0; margin-inline: auto; width: max-content; bottom: 22px; z-index: 400; display: flex; align-items: center; gap: 2px; max-width: calc(100vw - var(--sidebar) - 40px); padding: 6px 6px 6px 16px; border-radius: 14px; background: var(--ink); color: var(--bone); box-shadow: var(--shadow-3); flex-wrap: wrap; }
/* ancestor class from the layout: no :global() — `:global(.rail) .batch` compiles to a bare `.rail { … }` */
.rail .batch { left: var(--sidebar-rail); max-width: calc(100vw - var(--sidebar-rail) - 40px); }
[data-theme='dark'] .batch { background: #1c1c1a; border: 1px solid #2a2a27; }
.batch .cnt { font-size: var(--fs-sm); font-weight: 500; margin-right: 6px; white-space: nowrap; }
.batch .cnt .num { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 6px; border-radius: 99px; background: var(--lime); color: var(--ink); font-family: var(--mono); font-size: var(--fs-2xs); margin-right: 4px; }
.batch .sep { width: 1px; height: 22px; background: rgba(243, 239, 228, .14); margin: 0 4px; }
.batch button { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px; border-radius: 9px; font-size: var(--fs-sm); font-weight: 500; color: rgba(243, 239, 228, .86); white-space: nowrap; transition: background-color 140ms, color 140ms; }
.batch button:hover:not(:disabled) { background: rgba(243, 239, 228, .1); color: var(--bone); }
.batch button:disabled { opacity: .5; cursor: progress; }
.batch button.danger { color: #ff9d94; }
.batch button.danger:hover { background: rgba(255, 138, 128, .16); color: #ffb3ac; }
.batch button.x { width: 34px; padding: 0; justify-content: center; }
.narrow .batch { padding-left: 12px; }
.narrow .batch .lbl { display: none; }
.narrow .batch button { padding: 0 9px; }
.bar-enter-active { transition: opacity 260ms var(--ease-out), transform 420ms var(--ease-out); }
.bar-leave-active { transition: opacity 160ms var(--ease-cut), transform 160ms var(--ease-cut); }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translateY(14px); }

/* narrow window: groups and tags become a panel you open with the toggle */
.ov-head { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 8px 10px; margin-bottom: 6px; border-bottom: 1px solid var(--line-soft); }
.ov-x { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; color: var(--muted); }
.ov-x:hover { background: var(--panel-2); color: var(--fg); }
.narrow .side { position: fixed; top: calc(var(--topbar) + 8px); bottom: 12px; left: calc(var(--sidebar) + 12px); width: 230px; max-height: none; z-index: 350; padding: 14px 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-3); }
.rail .narrow .side { left: calc(var(--sidebar-rail) + 12px); }
</style>
