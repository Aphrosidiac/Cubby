<script setup lang="ts">
// The activity log (PLAN 6.9) as one component, used by the Activity page and a brand's Activity tab
// (brandId preset: no brand filter, no brand column). Filters, infinite scroll (activity.list
// before=<id>), live prepend on activity.new, expandable raw detail, screenshots, CSV export.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Activity } from '@shared/types';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Select from '@/components/ui/Select.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ActorChip from '@/components/activity/ActorChip.vue';
import ImageZoom from '@/components/media/ImageZoom.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { activityTone, detailLine, humanAction } from '@/components/activity/humanize';
import { brandById, useBrands } from '@/components/posts/meta';
import { fmtStamp, tz } from '@/components/posts/time';
import { api, fileUrl, on } from '@/lib/api';
import { ago, plural, SEP } from '@/lib/format';
import { fail, toast } from '@/composables/toast';

const props = defineProps<{
  /** show only this brand's activity (the brand filter and the Brand column go away) */
  brandId?: string;
  /** put the Export CSV button at the end of the filter bar (the Activity page has it in its header) */
  exportInBar?: boolean;
  /** what the empty, unfiltered list says */
  emptyBody?: string;
}>();

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
const filters = () => ({ brandId: props.brandId ?? brand.value ?? undefined, actor: actor.value ?? undefined, action: deb.value.action || undefined, q: deb.value.q || undefined });

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
watch([brand, actor, deb, () => props.brandId], loadFirst, { deep: true });
onMounted(loadFirst);

// infinite scroll: a sentinel under the list
const sentinel = ref<HTMLElement | null>(null);
let io: IntersectionObserver | null = null;
onMounted(() => { io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) void loadMore(); }, { rootMargin: '400px' }); if (sentinel.value) io.observe(sentinel.value); });
watch(sentinel, (el, old) => { if (old) io?.unobserve(old); if (el) io?.observe(el); });

// live: new rows that match the filters slide in at the top
const fresh = ref(new Set<number>());
// the same rule the server applies: `action` is a prefix, `*` a wildcard ("posts.*.failed")
const actionRe = (s: string) => new RegExp(`^${s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}`, 'i');
function matches(a: Activity) {
  const f = filters();
  if (f.brandId && a.brandId !== f.brandId) return false;
  if (f.actor && a.actor !== f.actor) return false;
  if (f.action && !actionRe(f.action).test(a.action)) return false;
  if (f.q && !JSON.stringify([a.action, a.brandName, a.detail]).toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}
const off = on('activity.new', a => {
  if (loading.value || !matches(a) || rows.value.some(r => r.id === a.id)) return;
  rows.value = [a, ...rows.value];
  fresh.value = new Set([...fresh.value, a.id]);
  setTimeout(() => { const s = new Set(fresh.value); s.delete(a.id); fresh.value = s; }, 1800);
});
// "just now" ages into "2 minutes ago" without a reload
const tick = ref(0);
const clock = window.setInterval(() => tick.value++, 30_000);
const rel = (iso: string) => { void tick.value; return ago(iso); };
onBeforeUnmount(() => { off(); io?.disconnect(); clearInterval(clock); });

const open = ref(new Set<number>());
const toggle = (id: number) => { const s = new Set(open.value); s.has(id) ? s.delete(id) : s.add(id); open.value = s; };
// screenshots whose file has been deleted: a quiet placeholder instead of a broken image
const gone = ref(new Set<number>());
const missing = (id: number) => { gone.value = new Set([...gone.value, id]); };
const zoomImgs = computed(() => rows.value.filter(r => r.screen && !gone.value.has(r.id)).map(r => ({ path: r.screen!, label: `${humanAction(r).text}${SEP}${fmtStamp(r.at)}` })));
const zoom = ref<number | null>(null);
const zoomOf = (p: string) => (zoom.value = zoomImgs.value.findIndex(z => z.path === p));

const exporting = ref(false);
const canExport = computed(() => loading.value || rows.value.length > 0);
async function exportCsv() {
  exporting.value = true;
  try {
    // the file holds exactly what the filters show
    const r = await api('activity.exportCsv', filters());
    toast(`Exported ${plural(r.count, 'row')}`, { tone: 'good', body: r.path, action: { label: 'Show file', run: () => void api('app.revealPath', { path: r.path }).catch(e => fail(e)) } });
  } catch (e) { fail(e, 'Could not export'); }
  finally { exporting.value = false; }
}
defineExpose({ exportCsv, exporting, canExport });

const brandOptions = computed(() => [{ value: null, label: 'All brands' }, ...brands.list.map(b => ({ value: b.id, label: b.name }))]);
const actorOptions = [{ value: null, label: 'Everyone' }, { value: 'you', label: 'You' }, { value: 'claude', label: 'Claude' }, { value: 'scheduler', label: 'Scheduler' }, { value: 'flow', label: 'Flows' }, { value: 'api', label: 'API' }];
const filtered = computed(() => !!((!props.brandId && brand.value) || actor.value || deb.value.action || deb.value.q));
const clear = () => { brand.value = null; actor.value = null; action.value = ''; q.value = ''; };
// day dividers
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz() });
const brandLabel = (r: Activity) => r.brandName ?? (r.brandId ? brandById(r.brandId)?.name : undefined) ?? 'Deleted brand';
</script>

<template>
  <div class="feed" :class="{ 'no-brand': !!brandId }">
    <div class="toolbar">
      <label class="search"><Icon name="search" :size="15" /><input v-model="q" placeholder="Search details" aria-label="Search activity" @keydown.esc="q = ''" /></label>
      <Select v-if="!brandId" v-model="brand" variant="pill" :options="brandOptions" aria-label="Brand" :min-width="150" />
      <Select v-model="actor" variant="pill" :options="actorOptions" aria-label="Who" :min-width="140" />
      <label class="search narrow" title="An action name or its start, e.g. posts or posts.*.failed"><Icon name="filter" :size="15" /><input v-model="action" placeholder="Action, e.g. posts" aria-label="Filter by action" spellcheck="false" @keydown.esc="action = ''" /></label>
      <Btn v-if="filtered" size="sm" variant="subtle" @click="clear">Clear</Btn>
      <template v-if="exportInBar">
        <span class="grow" />
        <Btn icon="download" :loading="exporting" :disabled="!canExport" :title="canExport ? 'Export what the filters show as a CSV file' : 'Nothing to export'" @click="exportCsv">Export CSV</Btn>
      </template>
    </div>

    <div v-if="loading" class="col gap-2"><div v-for="i in 8" :key="i" class="skel-line" style="height: 40px" :style="{ animationDelay: `${i * 50}ms` }" /></div>
    <EmptyState v-else-if="error" icon="warn" title="Could not load activity" :body="error"><Btn size="sm" icon="refresh" @click="loadFirst">Try again</Btn></EmptyState>
    <EmptyState v-else-if="!rows.length" :icon="filtered ? 'search' : 'activity'" :title="filtered ? 'Nothing matches' : 'No activity yet'" :body="filtered ? 'Try fewer filters.' : (emptyBody ?? 'Everything that changes something in Cubby is recorded here.')">
      <Btn v-if="filtered" size="sm" @click="clear">Clear filters</Btn>
    </EmptyState>

    <div v-else class="tbl" role="table" aria-label="Activity">
      <div class="th tbl-head" role="row"><span role="columnheader">Time</span><span role="columnheader">Who</span><span v-if="!brandId" role="columnheader">Brand</span><span role="columnheader">What</span><span /></div>
      <template v-for="(r, i) in rows" :key="r.id">
        <div v-if="i === 0 || dayOf(rows[i - 1].at) !== dayOf(r.at)" class="day label">{{ dayOf(r.at) }}</div>
        <div class="tr" :class="[{ fresh: fresh.has(r.id), opened: open.has(r.id) }, activityTone(r) && `t-${activityTone(r)}`]" role="row">
          <span class="time small num" :title="fmtStamp(r.at)">{{ rel(r.at) }}</span>
          <span><ActorChip :actor="r.actor" /></span>
          <span v-if="!brandId" class="brand small">
            <template v-if="r.brandId"><BrandAvatar :brand="brandById(r.brandId) ?? { name: r.brandName ?? '?' }" :size="18" /><span class="ellipsis" :title="brandLabel(r)">{{ brandLabel(r) }}</span></template>
            <span v-else class="muted" aria-label="No brand">—</span>
          </span>
          <button type="button" class="what" :aria-expanded="open.has(r.id)" :aria-label="`${humanAction(r).text}${detailLine(r) ? ` — ${detailLine(r)}` : ''}. Show details`" @click="toggle(r.id)">
            <span class="act small ellipsis"><Icon v-if="humanAction(r).guard" name="shield" :size="13" class="gi" />{{ humanAction(r).text }}</span>
            <span v-if="detailLine(r)" class="det tiny ellipsis" :title="detailLine(r).length > 60 ? detailLine(r) : undefined">{{ detailLine(r) }}</span>
          </button>
          <span class="end">
            <span v-if="r.screen && gone.has(r.id)" class="thumb gone" title="Screenshot file is missing"><Icon name="image" :size="14" /></span>
            <button v-else-if="r.screen" type="button" class="thumb" aria-label="Open screenshot" title="Open screenshot" @click="zoomOf(r.screen)"><img :src="fileUrl(r.screen)" alt="" loading="lazy" @error="missing(r.id)" /></button>
            <button type="button" class="exp" :aria-label="open.has(r.id) ? 'Hide details' : 'Show details'" :title="open.has(r.id) ? 'Hide details' : 'Show details'" :aria-expanded="open.has(r.id)" tabindex="-1" @click="toggle(r.id)"><Icon name="chevron-down" :size="14" class="chev" :class="{ rot: open.has(r.id) }" /></button>
          </span>
        </div>
        <div v-if="open.has(r.id)" class="json">
          <div class="tiny muted mb-2">{{ fmtStamp(r.at) }}{{ SEP }}<span class="code">{{ r.action }}</span><template v-if="(r.detail as any)?.via">{{ SEP }}via token “{{ (r.detail as any).via }}”</template></div>
          <pre class="code">{{ JSON.stringify(r.detail, null, 2) }}</pre>
        </div>
      </template>
      <div ref="sentinel" class="sent">
        <span v-if="more" class="tiny muted row gap-2"><span class="spin" />Loading older…</span>
        <span v-else-if="end" class="tiny muted">That’s everything{{ filtered ? ' that matches' : '' }}{{ SEP }}{{ plural(rows.length, 'entry', 'entries') }}</span>
        <button v-else type="button" class="tiny link muted" @click="loadMore">Load older</button>
      </div>
    </div>

    <ImageZoom v-model:index="zoom" :images="zoomImgs" />
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: var(--s5); }
/* the two text filters give way first, so the whole toolbar holds one line at the minimum window */
.search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--muted); flex: 1 1 160px; max-width: 280px; min-width: 130px; transition: border-color var(--t-micro), box-shadow var(--t-micro); }
.search.narrow { flex: 0 1 200px; min-width: 186px; }
.search:hover { border-color: var(--line-strong); }
.search:focus-within { border-color: var(--focus-border); box-shadow: var(--focus-ring); color: var(--fg); }
.search input { flex: 1; border: 0; background: none; outline: none; color: var(--fg); min-width: 0; text-overflow: ellipsis; }
.search input:focus-visible { box-shadow: none; outline: none; }
.search > :deep(.icon), .search > svg { flex: none; }
.tbl { --cols: 92px 112px minmax(110px, 170px) minmax(0, 1fr) 84px; }
.no-brand .tbl { --cols: 92px 112px minmax(0, 1fr) 84px; }
.th, .tr { display: grid; grid-template-columns: var(--cols); gap: 12px; align-items: center; }
/* the header is the kit table header (.tbl-head, as DataTable); sticks under the top bar, or
   under whatever else is sticky above it (--table-top) */
.th { position: sticky; top: var(--table-top, var(--topbar)); z-index: 2; background: var(--table-bg, var(--bg)); padding: 10px 4px; border-bottom: 1px solid var(--fg); }
.day { padding: 16px 4px 6px; }
.tr { padding: 8px 4px; border-bottom: 1px solid var(--line-soft); min-height: 48px; transition: background-color 160ms; }
.tr:hover, .tr.opened { background: var(--panel-hover); }
.tr.fresh { animation: ff-flash 1.6s var(--ease-out); box-shadow: inset 3px 0 0 var(--lime); }
/* one colour map (activityTone): failed or blocked by a guardrail = red */
.tr.t-bad .act { color: var(--bad); }
.gi { display: inline; vertical-align: -2px; margin-right: 5px; }
.time { color: var(--muted); white-space: nowrap; }
.brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.what { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 0; text-align: left; padding: 2px 0; border-radius: var(--r); }
.act { font-weight: 500; max-width: 100%; }
.det { color: var(--muted); max-width: 100%; }
.end { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.thumb { border-radius: 4px; }
.thumb img { width: 44px; height: 30px; object-fit: cover; object-position: top; border-radius: 4px; border: 1px solid var(--line); }
.thumb:hover img { border-color: var(--fg); }
.thumb.gone { display: grid; place-items: center; width: 44px; height: 30px; border: 1px dashed var(--line-strong); color: var(--muted); }
.exp { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; color: var(--muted); transition: background-color var(--t-micro), color var(--t-micro); }
.exp:hover { background: var(--panel-2); color: var(--fg); }
.chev { transition: transform 240ms var(--ease-out); }
.rot { transform: rotate(180deg); }
.json { padding: 10px 14px 14px; border-bottom: 1px solid var(--line-soft); background: var(--panel); }
.json pre { margin: 0; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; color: var(--fg-2); font-size: var(--fs-xs); }
.sent { display: flex; justify-content: center; padding: 22px 0 8px; min-height: 40px; }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: ff-spin .7s linear infinite; }
</style>
