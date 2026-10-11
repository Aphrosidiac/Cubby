<script setup lang="ts">
// Activity (PLAN 6.9): everything done by you / Claude / scheduler / flows / API. Filters, infinite
// scroll (activity.list before=<id>), live prepend on activity.new, CSV export.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Activity } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Select from '@/components/ui/Select.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ActorChip from '@/components/activity/ActorChip.vue';
import ImageZoom from '@/components/media/ImageZoom.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { detailLine, humanAction } from '@/components/activity/humanize';
import { brandById, useBrands } from '@/components/posts/meta';
import { fmtStamp, tz } from '@/components/posts/time';
import { api, fileUrl, on } from '@/lib/api';
import { ago } from '@/lib/format';
import { fail, toast } from '@/composables/toast';

const brands = useBrands();
const PAGE = 60;
const brand = ref<string | null>(null);
const actor = ref<string | null>(null);
const action = ref('');
const q = ref('');
const deb = ref({ action: '', q: '' });
let t = 0;
watch([action, q], () => { clearTimeout(t); t = window.setTimeout(() => (deb.value = { action: action.value.trim(), q: q.value.trim() }), 250); });

const rows = ref<Activity[]>([]);
const loading = ref(true);
const more = ref(false);
const end = ref(false);
const error = ref<string | null>(null);
let seq = 0;
const filters = () => ({ brandId: brand.value ?? undefined, actor: actor.value ?? undefined, action: deb.value.action || undefined, q: deb.value.q || undefined });

async function loadFirst() {
  const my = ++seq;
  loading.value = true; end.value = false; error.value = null;
  try {
    const r = await api('activity.list', { ...filters(), limit: PAGE });
    if (my !== seq) return;
    rows.value = r; end.value = r.length < PAGE;
  } catch (e) { if (my === seq) error.value = (e as Error).message; }
  finally { if (my === seq) loading.value = false; }
}
async function loadMore() {
  if (more.value || end.value || loading.value || !rows.value.length) return;
  const my = seq;
  more.value = true;
  try {
    const r = await api('activity.list', { ...filters(), limit: PAGE, before: rows.value[rows.value.length - 1].id });
    if (my !== seq) return;
    rows.value = [...rows.value, ...r]; end.value = r.length < PAGE;
  } catch (e) { fail(e, 'Could not load older activity'); }
  finally { more.value = false; }
}
watch([brand, actor, deb], loadFirst, { deep: true });
onMounted(loadFirst);

// infinite scroll: a sentinel under the list
const sentinel = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;
onMounted(() => { io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) void loadMore(); }, { rootMargin: '400px' }); if (sentinel.value) io.observe(sentinel.value); });
watch(sentinel, (el, old) => { if (old) io?.unobserve(old); if (el) io?.observe(el); });

// live: new rows that match the filters slide in at the top
const fresh = ref(new Set<number>());
function matches(a: Activity) {
  const f = filters();
  if (f.brandId && a.brandId !== f.brandId) return false;
  if (f.actor && a.actor !== f.actor) return false;
  if (f.action && !a.action.includes(f.action)) return false;
  if (f.q && !JSON.stringify([a.action, a.brandName, a.detail]).toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}
const off = on('activity.new', a => {
  if (loading.value || !matches(a) || rows.value.some(r => r.id === a.id)) return;
  rows.value = [a, ...rows.value];
  fresh.value = new Set([...fresh.value, a.id]);
  setTimeout(() => { const s = new Set(fresh.value); s.delete(a.id); fresh.value = s; }, 1800);
});
onBeforeUnmount(() => { off(); io?.disconnect(); });

const open = ref(new Set<number>());
const toggle = (id: number) => { const s = new Set(open.value); s.has(id) ? s.delete(id) : s.add(id); open.value = s; };
const zoomImgs = computed(() => rows.value.filter(r => r.screen).map(r => ({ path: r.screen!, label: `${humanAction(r).text} · ${fmtStamp(r.at)}` })));
const zoom = ref<number | null>(null);
const zoomOf = (p: string) => (zoom.value = zoomImgs.value.findIndex(z => z.path === p));

const exporting = ref(false);
async function exportCsv() {
  exporting.value = true;
  try {
    const r = await api('activity.exportCsv', { brandId: brand.value ?? undefined, actor: actor.value ?? undefined });
    toast(`Exported ${r.count} rows`, { tone: 'good', body: r.path, action: { label: 'Show file', run: () => void api('app.revealPath', { path: r.path }).catch(e => fail(e)) } });
  } catch (e) { fail(e, 'Could not export'); }
  finally { exporting.value = false; }
}

const brandOptions = computed(() => [{ value: null, label: 'All brands' }, ...brands.list.map(b => ({ value: b.id, label: b.name }))]);
const actorOptions = [{ value: null, label: 'Everyone' }, { value: 'you', label: 'You' }, { value: 'claude', label: 'Claude' }, { value: 'scheduler', label: 'Scheduler' }, { value: 'flow', label: 'Flows' }, { value: 'api', label: 'API' }];
const filtered = computed(() => !!(brand.value || actor.value || deb.value.action || deb.value.q));
const clear = () => { brand.value = null; actor.value = null; action.value = ''; q.value = ''; };
// day dividers
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz() });
</script>

<template>
  <div class="page activity">
    <PageHeader eyebrow="Control" title="Activity">
      <span>Everything done by you, Claude, the scheduler, flows and the API — append-only.</span>
      <template #actions><Btn icon="download" :loading="exporting" @click="exportCsv">Export CSV</Btn></template>
    </PageHeader>

    <div class="toolbar">
      <label class="search"><Icon name="search" :size="15" /><input v-model="q" placeholder="Search details" aria-label="Search activity" @keydown.esc="q = ''" /></label>
      <Select v-model="brand" variant="pill" :options="brandOptions" aria-label="Brand" :min-width="170" />
      <Select v-model="actor" variant="pill" :options="actorOptions" aria-label="Who" :min-width="150" />
      <label class="search narrow"><Icon name="filter" :size="15" /><input v-model="action" placeholder="Action, e.g. posts." aria-label="Filter by action" class="code-in" /></label>
      <Btn v-if="filtered" size="sm" variant="subtle" @click="clear">Clear</Btn>
    </div>

    <div v-if="loading" class="col gap-2"><div v-for="i in 8" :key="i" class="skel-line" style="height: 40px" :style="{ animationDelay: `${i * 50}ms` }" /></div>
    <EmptyState v-else-if="error" icon="warn" title="Could not load activity" :body="error"><Btn size="sm" icon="refresh" @click="loadFirst">Try again</Btn></EmptyState>
    <EmptyState v-else-if="!rows.length" :icon="filtered ? 'search' : 'activity'" :title="filtered ? 'Nothing matches' : 'No activity yet'" :body="filtered ? 'Try fewer filters.' : 'Everything that changes something in Cubby is recorded here.'">
      <Btn v-if="filtered" size="sm" @click="clear">Clear filters</Btn>
    </EmptyState>

    <div v-else class="tbl" role="table" aria-label="Activity">
      <div class="th" role="row"><span>Time</span><span>Who</span><span>Brand</span><span>What</span><span /></div>
      <template v-for="(r, i) in rows" :key="r.id">
        <div v-if="i === 0 || dayOf(rows[i - 1].at) !== dayOf(r.at)" class="day label">{{ dayOf(r.at) }}</div>
        <div class="tr" :class="{ fresh: fresh.has(r.id), opened: open.has(r.id), failed: humanAction(r).failed, guard: humanAction(r).guard }" role="row">
          <span class="time small num" :title="fmtStamp(r.at)">{{ ago(r.at) }}</span>
          <span><ActorChip :actor="r.actor" /></span>
          <span class="brand small">
            <template v-if="r.brandId"><BrandAvatar :brand="brandById(r.brandId) ?? { name: r.brandName ?? '?' }" :size="18" /><span class="ellipsis">{{ r.brandName ?? brandById(r.brandId)?.name ?? '—' }}</span></template>
            <span v-else class="faint">—</span>
          </span>
          <button type="button" class="what" :aria-expanded="open.has(r.id)" @click="toggle(r.id)">
            <span class="act small"><Icon v-if="humanAction(r).guard" name="shield" :size="13" class="gi" />{{ humanAction(r).text }}</span>
            <span class="det tiny ellipsis">{{ detailLine(r) }}</span>
          </button>
          <span class="end">
            <button v-if="r.screen" type="button" class="thumb" :aria-label="'Open screenshot'" @click="zoomOf(r.screen)"><img :src="fileUrl(r.screen)" alt="" loading="lazy" /></button>
            <Icon name="chevron-down" :size="14" class="chev" :class="{ rot: open.has(r.id) }" />
          </span>
        </div>
        <div v-if="open.has(r.id)" class="json">
          <div class="tiny muted mb-2">{{ fmtStamp(r.at) }} · <span class="code">{{ r.action }}</span><template v-if="(r.detail as any)?.via"> · via token “{{ (r.detail as any).via }}”</template></div>
          <pre class="code">{{ JSON.stringify(r.detail, null, 2) }}</pre>
        </div>
      </template>
      <div ref="sentinel" class="sent">
        <span v-if="more" class="tiny muted row gap-2"><span class="spin" />Loading older…</span>
        <span v-else-if="end" class="tiny faint">That’s everything{{ filtered ? ' that matches' : '' }}.</span>
        <button v-else type="button" class="tiny link muted" @click="loadMore">Load older</button>
      </div>
    </div>

    <ImageZoom v-model:index="zoom" :images="zoomImgs" />
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: var(--s5); }
.search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--muted); width: min(260px, 100%); }
.search.narrow { width: 200px; }
.search:focus-within { border-color: var(--focus-border); }
.search input { flex: 1; border: 0; background: none; outline: none; color: var(--fg); min-width: 0; }
.search input:focus-visible { box-shadow: none; outline: none; }
.code-in { font-family: var(--mono); font-size: var(--fs-xs); }
.tbl { --cols: 92px 112px minmax(110px, 170px) minmax(0, 1fr) 84px; }
.th, .tr { display: grid; grid-template-columns: var(--cols); gap: 12px; align-items: center; }
.th { position: sticky; top: var(--topbar); z-index: 2; background: var(--bg); padding: 10px 4px; border-bottom: 1px solid var(--fg); font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.day { padding: 16px 4px 6px; }
.tr { padding: 8px 4px; border-bottom: 1px solid var(--line-soft); min-height: 48px; transition: background-color 160ms; }
.tr:hover, .tr.opened { background: var(--panel-hover); }
.tr.fresh { animation: ff-flash 1.6s var(--ease-out); box-shadow: inset 3px 0 0 var(--lime); }
.tr.failed .act { color: var(--bad); }
.tr.guard .act { color: var(--warn); }
.gi { display: inline; vertical-align: -2px; margin-right: 5px; }
.time { color: var(--muted); white-space: nowrap; }
.brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.what { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 0; text-align: left; padding: 2px 0; }
.act { font-weight: 500; }
.det { color: var(--muted); max-width: 100%; }
.end { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.thumb img { width: 44px; height: 30px; object-fit: cover; object-position: top; border-radius: 4px; border: 1px solid var(--line); }
.thumb:hover img { border-color: var(--fg); }
.chev { color: var(--faint); transition: transform 240ms var(--ease-out); }
.rot { transform: rotate(180deg); }
.json { padding: 10px 14px 14px; border-bottom: 1px solid var(--line-soft); background: var(--panel); }
.json pre { margin: 0; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; color: var(--fg-2); font-size: var(--fs-xs); }
.sent { display: flex; justify-content: center; padding: 22px 0 8px; min-height: 40px; }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: ff-spin .7s linear infinite; }
</style>
