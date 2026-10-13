<script setup lang="ts">
// Calendar & queue (PLAN 6.5): month / week / list across brands, colour = brand, drag to
// reschedule (pacing re-checked by posts.reschedule), click for the post drawer, slots per brand.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FullCalendar from '@fullcalendar/vue3';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import enGb from '@fullcalendar/core/locales/en-gb';
import type { CalendarOptions, EventDropArg, EventInput, EventClickArg, DatesSetArg } from '@fullcalendar/core';
import type { Post, PostStatus } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import StatusChip from '@/components/posts/StatusChip.vue';
import Icon from '@/components/ui/Icon.vue';
import Select from '@/components/ui/Select.vue';
import Segmented from '@/components/ui/Segmented.vue';
import PostDrawer from '@/components/posts/PostDrawer.vue';
import SlotsModal from '@/components/posts/SlotsModal.vue';
import { KIND_LABEL, POST_STATUS, RESCHEDULABLE, brandMark, brandName, postStatus, useBrands } from '@/components/posts/meta';
import { fmtWhen, toWall, tzLabel, wallDateToIso } from '@/components/posts/time';
import { api } from '@/lib/api';
import { onTopics } from '@/lib/live';
import { fail, ok, toast } from '@/composables/toast';
import { useShortcuts } from '@/composables/shortcuts';

const route = useRoute();
const router = useRouter();
const brands = useBrands();

type View = 'dayGridMonth' | 'timeGridWeek' | 'listMonth';
const VIEWS: View[] = ['dayGridMonth', 'timeGridWeek', 'listMonth'];
const view = ref<View>((() => { try { const v = localStorage.getItem('cubby-cal-view') as View; return VIEWS.includes(v) ? v : 'dayGridMonth'; } catch { return 'dayGridMonth'; } })());
watch(view, v => { try { localStorage.setItem('cubby-cal-view', v); } catch { /* ignore */ } cal.value?.getApi().changeView(v); cal.value?.getApi().refetchEvents(); });
const title = ref('');
const brandFilter = ref<string | null>(typeof route.query.brand === 'string' ? route.query.brand : null);
const statusFilter = ref<string>('active');
const openPost = ref<string | null>(null);
const slotsOpen = ref(route.query.slots === '1');
const loadError = ref<string | null>(null);
const count = ref<number | null>(null);
const loading = ref(true);
const cal = shallowRef<InstanceType<typeof FullCalendar> | null>(null);

const STATUS_OPTIONS = [
  { value: 'active', label: 'All but cancelled' },
  { value: 'all', label: 'Every status' },
  ...(Object.keys(POST_STATUS) as PostStatus[]).map(s => ({ value: s, label: POST_STATUS[s].label }))
];
const brandOptions = computed(() => [{ value: null, label: 'All brands' }, ...brands.list.map(b => ({ value: b.id, label: b.name }))]);
const statusArg = () => (statusFilter.value === 'all' ? undefined : statusFilter.value === 'active' ? (Object.keys(POST_STATUS) as PostStatus[]).filter(s => s !== 'cancelled') : [statusFilter.value]);
const nowWallMs = () => new Date(toWall(new Date()) + 'Z').getTime();
const draggable = (p: Post) => RESCHEDULABLE.includes(p.status) && !!p.scheduledAt && new Date(p.scheduledAt).getTime() > Date.now();

/**
 * A post is an instant. It shows as an hour-long block cut at midnight, so a late post never spills
 * into the next day; in the week grid a post after 23:25 is drawn from 23:25 (the smallest block
 * still has to fit above midnight) — its label keeps the real time, and a drag keeps the offset.
 */
const LATE = '23:25';
function toEvent(p: Post): EventInput {
  const real = toWall(p.scheduledAt!);
  const start = view.value === 'timeGridWeek' && real.slice(11, 16) > LATE ? `${real.slice(0, 11)}${LATE}:00` : real;
  const s = new Date(start + 'Z').getTime();
  const midnight = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10) + 1);
  return {
    id: p.id, start, end: new Date(Math.min(s + 3600_000, midnight)).toISOString().slice(0, 19), allDay: false, title: p.caption || KIND_LABEL[p.kind],
    startEditable: draggable(p), durationEditable: false, backgroundColor: 'transparent', borderColor: 'transparent', textColor: 'inherit',
    classNames: [`st-${p.status}`], extendedProps: { post: p, shiftMs: new Date(real + 'Z').getTime() - s }
  };
}
/** "9 pm", "9:30 pm" in the posting timezone */
const shortTime = (iso: string) => {
  const [hh, mm] = toWall(iso).slice(11, 16).split(':').map(Number);
  return `${hh % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 ? 'am' : 'pm'}`;
};
/** What an event chip shows (one lookup per render). */
function ev(p: Post) {
  const s = postStatus(p.status);
  const name = brandName(p.brandId);
  return { name, mark: brandMark(p.brandId), status: s.label, tone: s.tone, caption: p.caption || `${KIND_LABEL[p.kind]} post`, tip: `${name} · ${s.label}${p.scheduledAt ? ` · ${fmtWhen(p.scheduledAt)}` : ''}\n${p.caption || KIND_LABEL[p.kind] + ' post'}${draggable(p) ? '\nDrag to move it.' : ''}` };
}

const options = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
  locale: enGb,
  initialView: view.value,
  headerToolbar: false,
  timeZone: 'UTC', // events are fed as wall times in Settings.timezone
  now: () => toWall(new Date()),
  firstDay: 1,
  height: 'auto', // the page scrolls, the calendar never scrolls inside it
  dayMaxEvents: 4,
  nowIndicator: true,
  allDaySlot: false,
  slotDuration: '00:30:00',
  defaultTimedEventDuration: '01:00',
  eventMinHeight: 26,
  slotEventOverlap: false,
  displayEventEnd: false,
  dayHeaderFormat: view.value === 'timeGridWeek' ? { weekday: 'short', day: 'numeric', omitCommas: true } : { weekday: 'short' },
  eventTimeFormat: { hour: 'numeric', minute: '2-digit', hour12: true, omitZeroMinute: true },
  slotLabelFormat: { hour: 'numeric', hour12: true },
  listDayFormat: { weekday: 'long', day: 'numeric', month: 'long' },
  listDaySideFormat: false,
  moreLinkContent: (a) => `+${a.num} more`,
  editable: true,
  eventDurationEditable: false,
  noEventsContent: 'No posts in this range.',
  events: async (info, success, failure) => {
    loading.value = true;
    try {
      const list = await api('posts.list', { brandId: brandFilter.value ?? undefined, status: statusArg(), from: wallDateToIso(info.start), to: wallDateToIso(info.end), limit: 1000 });
      const scheduled = list.filter(p => p.scheduledAt);
      count.value = scheduled.length;
      loadError.value = null;
      success(scheduled.map(toEvent));
    } catch (e) {
      loadError.value = (e as Error).message;
      count.value = null;
      failure(e as Error);
    } finally {
      loading.value = false;
    }
  },
  eventDidMount: (a) => { a.el.setAttribute('data-post', a.event.id); },
  datesSet: (a: DatesSetArg) => { title.value = a.view.title; },
  eventClick: (a: EventClickArg) => { a.jsEvent.preventDefault(); openPost.value = a.event.id; },
  eventAllow: (span) => span.start.getTime() >= nowWallMs() + 60_000,
  eventDrop: async (a: EventDropArg) => {
    const p = a.event.extendedProps.post as Post;
    const iso = new Date(new Date(wallDateToIso(a.event.start!)).getTime() + (a.event.extendedProps.shiftMs ?? 0)).toISOString();
    try {
      const r = await api('posts.reschedule', { id: p.id, scheduledAt: iso });
      a.event.setExtendedProp('post', r);
      if (r.error && r.error.startsWith('Heads up')) toast('Moved — but pacing will push it back', { tone: 'warn', body: r.error.replace(/^Heads up: /, ''), ms: 9000 });
      else ok('Rescheduled', `${brandName(r.brandId)} · ${fmtWhen(r.scheduledAt)}`);
    } catch (e) {
      a.revert();
      fail(e, 'Could not reschedule');
    }
  }
}));

const api_ = () => cal.value?.getApi();
const prev = () => api_()?.prev();
const next = () => api_()?.next();
const today = () => api_()?.today();
const refetch = () => api_()?.refetchEvents();
watch([brandFilter, statusFilter], refetch);
watch(brandFilter, b => { if ((route.query.brand ?? null) !== b) void router.replace({ query: { ...route.query, brand: b ?? undefined } }); });
const off = onTopics(['posts.changed'], refetch);
onBeforeUnmount(off);
// not while the post drawer or a modal is on top (← / → would move the calendar behind it)
const free = (fn: () => void) => () => { if (!document.querySelector('[role="dialog"][aria-modal="true"]')) fn(); };
useShortcuts({ ArrowLeft: free(prev), ArrowRight: free(next), t: free(today), m: free(() => (view.value = 'dayGridMonth')), w: free(() => (view.value = 'timeGridWeek')), l: free(() => (view.value = 'listMonth')) });

// posts with no time never appear on the grid (drafts, "as soon as approved") — list them under it so they're not lost
const unscheduled = ref<Post[]>([]);
async function loadUnscheduled() {
  try { unscheduled.value = (await api('posts.list', { brandId: brandFilter.value ?? undefined, status: statusArg(), limit: 200 })).filter(p => !p.scheduledAt); }
  catch { unscheduled.value = []; }
}
onMounted(loadUnscheduled);
watch([brandFilter, statusFilter], loadUnscheduled);
const offD = onTopics(['posts.changed'], loadUnscheduled);
onBeforeUnmount(offD);

watch(() => route.query.slots, v => { if (v === '1') slotsOpen.value = true; });
watch(slotsOpen, o => { if (!o && route.query.slots) void router.replace({ query: { ...route.query, slots: undefined } }); });
const viewOptions = [{ value: 'dayGridMonth', label: 'Month' }, { value: 'timeGridWeek', label: 'Week' }, { value: 'listMonth', label: 'List' }];
</script>

<template>
  <div class="page calendar">
    <PageHeader eyebrow="Posting" title="Calendar">
      <span>Every brand’s posts in {{ tzLabel() }}. Drag a post to move it; pacing is re-checked.</span>
      <template #actions>
        <Btn icon="clock" @click="slotsOpen = true">Posting slots</Btn>
        <Btn variant="primary" icon="compose" :to="{ path: '/compose', query: brandFilter ? { brand: brandFilter } : {} }">New post</Btn>
      </template>
    </PageHeader>

    <div class="toolbar">
      <div class="nav">
        <button type="button" class="nb" aria-label="Previous" title="Previous (←)" @click="prev"><Icon name="chevron-left" :size="16" /></button>
        <button type="button" class="nb" aria-label="Next" title="Next (→)" @click="next"><Icon name="chevron" :size="16" /></button>
        <Btn size="sm" title="Today (T)" @click="today">Today</Btn>
        <h2 class="h2 ttl nowrap">{{ title }}</h2>
        <span class="tiny muted num cnt nowrap" :class="{ dim: loading }">{{ count === null ? '' : `${count} ${count === 1 ? 'post' : 'posts'}` }}</span>
      </div>
      <div class="filters">
        <Select v-model="brandFilter" variant="pill" :options="brandOptions" aria-label="Brand" :min-width="170" />
        <Select v-model="statusFilter" variant="pill" :options="STATUS_OPTIONS" aria-label="Status" :min-width="170" />
        <Segmented v-model="view" size="sm" :options="viewOptions" />
      </div>
    </div>

    <div v-if="loadError" class="loaderr small"><Icon name="warn" :size="14" /><span class="grow">Posts aren’t available — {{ loadError }}</span><button type="button" class="link" @click="refetch">Retry</button></div>

    <div class="cal-wrap" :class="[`v-${view}`, { loading }]">
      <FullCalendar ref="cal" :options="options">
        <template #eventContent="arg">
          <div v-for="e in [ev(arg.event.extendedProps.post)]" :key="arg.event.id" class="ev" :style="{ '--bc': e.mark }" :title="e.tip">
            <span class="bar" />
            <span class="hd">
              <span v-if="arg.view.type !== 'listMonth'" class="t num">{{ shortTime(arg.event.extendedProps.post.scheduledAt) }}</span>
              <span class="b ellipsis">{{ e.name }}</span>
              <span class="sd" :class="`st-${arg.event.extendedProps.post.status}`" role="img" :aria-label="e.status">
                <i class="dot" />
                <span v-if="arg.view.type === 'listMonth'" class="sl">{{ e.status }}</span>
              </span>
            </span>
            <span v-if="arg.view.type !== 'dayGridMonth'" class="c ellipsis">{{ e.caption }}</span>
          </div>
        </template>
      </FullCalendar>
    </div>

    <section v-if="unscheduled.length" class="drafts">
      <div class="section-title"><h2 class="h3">Not scheduled</h2><span class="tiny muted num">{{ unscheduled.length }}</span></div>
      <ul>
        <li v-for="d in unscheduled" :key="d.id">
          <button type="button" class="draft" :data-post="d.id" @click="openPost = d.id">
            <span class="swatch" :style="{ background: brandMark(d.brandId) }" />
            <span class="small strong nowrap bn ellipsis" :title="brandName(d.brandId)">{{ brandName(d.brandId) }}</span>
            <span class="small muted nowrap">{{ KIND_LABEL[d.kind] }}</span>
            <span class="grow small ellipsis" :title="d.caption">{{ d.caption || 'No caption' }}</span>
            <span v-if="d.status === 'ready_for_approval' || d.status === 'approved'" class="tiny muted nowrap">As soon as approved</span>
            <StatusChip size="sm" :status="d.status" />
            <Icon name="arrow" :size="14" class="go" />
          </button>
        </li>
      </ul>
    </section>

    <div class="legend tiny muted" aria-label="Key">
      <span class="lg"><span class="lbar" aria-hidden="true" />Brand colour</span>
      <span class="lsep" aria-hidden="true" />
      <span v-for="(s, k) in POST_STATUS" :key="k" class="lg"><span class="sd" :class="`st-${k}`"><i class="dot" /></span>{{ s.label }}</span>
    </div>

    <PostDrawer :post-id="openPost" @close="openPost = null" />
    <SlotsModal v-model:open="slotsOpen" :brand-id="brandFilter ?? brands.list[0]?.id ?? null" />
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; margin-bottom: var(--s4); }
.nav { display: flex; align-items: center; gap: 6px; min-width: 0; }
.filters { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.nb { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line); display: grid; place-items: center; color: var(--fg); transition: border-color 200ms, background-color 200ms; flex: none; }
.nb:hover { border-color: var(--fg); background: var(--panel-2); }
.nb:active { background: var(--panel-hover); }
.ttl { margin: 0 4px 0 8px; }
.cnt { min-width: 52px; transition: opacity 200ms; }
.cnt.dim { opacity: .5; }
.loaderr { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: var(--r-lg); background: var(--warn-bg); color: var(--warn); margin-bottom: var(--s4); }
.cal-wrap { transition: opacity 200ms; container-type: inline-size; }
/* narrow month cells: the brand matters more than the time (the time is in the tooltip and the drawer) */
@container (max-width: 760px) { .v-dayGridMonth .ev .t { display: none; } .v-dayGridMonth .ev { padding-right: 4px; gap: 4px; } }
.ev { position: relative; display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 2px 6px 2px 9px; border-radius: 4px; background: color-mix(in srgb, var(--bc) 13%, var(--panel)); color: var(--fg); font-size: var(--fs-xs); line-height: 1.35; overflow: hidden; cursor: pointer; }
.ev .bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--bc); }
.ev .t { color: var(--fg-2); font-weight: 500; flex: none; }
.ev .b { font-weight: 600; flex: 0 1 auto; min-width: 0; }
.ev .c { color: var(--fg-2); flex: 1 1 auto; min-width: 0; }
.ev .hd { display: contents; }
.ev .c { order: 1; }
.ev .sd { order: 2; }
/* week: two short lines — time · brand · status dot, then the caption — cut at the bottom of the block, never squashed */
.v-timeGridWeek .ev { flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 1px; height: 100%; padding-top: 3px; padding-bottom: 3px; }
.v-timeGridWeek .ev > * { flex: none; }
.v-timeGridWeek .ev .hd { display: flex; align-items: center; gap: 5px; min-width: 0; }
.v-listMonth .ev { background: none; padding: 0 0 0 12px; font-size: var(--fs-sm); gap: 10px; }
.v-listMonth .ev .bar { width: 3px; border-radius: 2px; }
.sd { flex: none; display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: var(--fs-2xs); font-family: var(--mono); text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
.sl { white-space: nowrap; }
/* status key: hollow = still to come · filled = done · ink ring with a lime centre = waiting for you to approve · bullseye = needs you */
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; box-sizing: border-box; }
.st-draft .dot { box-shadow: inset 0 0 0 1.5px var(--muted); }
/* an Ink ring round the lime centre, with a hairline of Bone outside it: the ring reads on pale chips, the hairline keeps it on dark panels */
.st-ready_for_approval .dot { background: var(--lime); box-shadow: inset 0 0 0 2px var(--ink), 0 0 0 1px var(--bone); }
.st-ready_for_approval { color: var(--fg); }
.st-approved .dot { box-shadow: inset 0 0 0 1.5px var(--good); }
.st-approved { color: var(--good); }
.st-queued .dot { box-shadow: inset 0 0 0 1.5px var(--info); }
.st-queued { color: var(--info); }
.st-running .dot { background: var(--warn); animation: cal-blink 1.6s ease-in-out infinite; }
@keyframes cal-blink { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .st-running .dot { animation: none; } }
.st-running { color: var(--warn); }
.st-needs_human .dot { background: radial-gradient(circle, var(--bad) 0 1.5px, transparent 2px); box-shadow: inset 0 0 0 1.5px var(--bad); }
.st-needs_human { color: var(--bad); }
.st-posted .dot { background: var(--good); }
.st-posted { color: var(--good); }
.st-failed .dot { background: var(--bad); }
.st-failed { color: var(--bad); }
.st-cancelled .dot { background: var(--muted); }
.drafts { margin-top: var(--s6); }
.draft { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 6px; border-bottom: 1px solid var(--line-soft); text-align: left; border-radius: var(--r); min-width: 0; }
.draft:hover { background: var(--panel-hover); }
.draft .bn { max-width: 240px; flex: 0 1 auto; }
.draft .go { opacity: 0; transition: opacity 200ms; flex: none; }
.draft:hover .go, .draft:focus-visible .go { opacity: 1; }
.swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: var(--s5); }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.lg .sd { margin: 0; }
.lbar { width: 3px; height: 12px; border-radius: 2px; background: var(--fg-2); flex: none; }
.lsep { width: 1px; height: 12px; background: var(--line); align-self: center; }
</style>

<style>
/* FullCalendar on FF tokens (light and dark follow the variables) */
.cal-wrap .fc {
  --fc-border-color: var(--line);
  --fc-page-bg-color: var(--panel);
  --fc-neutral-bg-color: var(--panel-2);
  --fc-neutral-text-color: var(--muted);
  --fc-today-bg-color: color-mix(in srgb, var(--fg) 3%, transparent); /* neutral: today is marked by the Ink day badge */
  --fc-now-indicator-color: var(--bad);
  --fc-highlight-color: color-mix(in srgb, var(--fg) 8%, transparent);
  --fc-event-bg-color: transparent;
  --fc-event-border-color: transparent;
  --fc-event-text-color: var(--fg);
  --fc-event-selected-overlay-color: transparent;
  --fc-list-event-hover-bg-color: var(--panel-hover);
  --fc-more-link-bg-color: transparent;
  --fc-more-link-text-color: var(--muted);
  --fc-small-font-size: var(--fs-xs);
  font-family: var(--sans);
  font-size: var(--fs-sm);
  color: var(--fg);
}
.cal-wrap .fc .fc-scrollgrid { border-radius: var(--r-lg); overflow: hidden; background: var(--panel); }
.cal-wrap .fc .fc-col-header-cell { background: var(--bg-elev); }
.cal-wrap .fc .fc-col-header-cell-cushion { padding: 8px 6px; font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.cal-wrap .fc .fc-day-today .fc-col-header-cell-cushion { color: var(--fg); }
.cal-wrap .fc .fc-daygrid-day-number { padding: 6px 8px; font-size: var(--fs-xs); color: var(--fg-2); font-variant-numeric: tabular-nums; }
/* days outside the month: a quieter cell, numbers still readable (≥ 4.5:1) */
.cal-wrap .fc .fc-daygrid-day.fc-day-other { background: color-mix(in srgb, var(--bg) 70%, var(--panel)); }
.cal-wrap .fc .fc-day-other .fc-daygrid-day-top { opacity: 1; }
.cal-wrap .fc .fc-day-other .fc-daygrid-day-number { color: var(--muted); }
.cal-wrap .fc .fc-day-today .fc-daygrid-day-number { background: var(--fg); color: var(--bg); border-radius: 99px; margin: 4px; padding: 2px 7px; font-weight: 600; }
.cal-wrap .fc .fc-daygrid-day-frame { min-height: 96px; }
.cal-wrap .fc .fc-daygrid-event { margin: 1px 4px 2px; padding: 0; border: 0; border-radius: 4px; }
.cal-wrap .fc .fc-daygrid-event-harness { margin-top: 1px; }
.cal-wrap .fc .fc-daygrid-dot-event:hover, .cal-wrap .fc .fc-daygrid-event:hover { background: none; }
.cal-wrap .fc .fc-daygrid-event:hover .ev, .cal-wrap .fc .fc-timegrid-event:hover .ev { background: color-mix(in srgb, var(--bc) 22%, var(--panel)); }
.cal-wrap .fc .fc-daygrid-more-link { font-size: var(--fs-xs); color: var(--muted); padding: 1px 6px; margin: 0 4px; }
.cal-wrap .fc .fc-daygrid-more-link:hover { color: var(--fg); background: none; text-decoration: underline; }
.cal-wrap .fc .fc-popover { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow-2); overflow: hidden; }
.cal-wrap .fc .fc-popover-header { background: var(--bg-elev); color: var(--fg); padding: 8px 10px; font-size: var(--fs-xs); font-weight: 600; }
.cal-wrap .fc .fc-popover-close { color: var(--muted); opacity: 1; }
.cal-wrap .fc .fc-popover-close:hover { color: var(--fg); }
.cal-wrap .fc .fc-popover-body { padding: 6px 2px; }
.cal-wrap .fc .fc-timegrid-slot { height: 24px; }
.cal-wrap .fc .fc-timegrid-slot-minor { border-top-style: dotted; border-top-color: var(--line-soft); }
.cal-wrap .fc .fc-timegrid-slot-label-cushion, .cal-wrap .fc .fc-timegrid-axis-cushion { font-size: var(--fs-2xs); font-family: var(--mono); color: var(--muted); text-transform: uppercase; }
.cal-wrap .fc .fc-timegrid-col.fc-day-today { background: var(--fc-today-bg-color); }
.cal-wrap .fc .fc-timegrid-event { border-radius: 4px; box-shadow: none; }
.cal-wrap .fc .fc-timegrid-event .fc-event-main { padding: 0; height: 100%; }
.cal-wrap .fc .fc-timegrid-event-harness-inset .fc-timegrid-event { box-shadow: 0 0 0 1px var(--panel); }
.cal-wrap .fc .fc-timegrid-now-indicator-line { border-width: 1.5px 0 0; }
.cal-wrap .fc .fc-event { cursor: pointer; }
.cal-wrap .fc .fc-event:focus-visible { outline: 2px solid var(--lime); outline-offset: 1px; box-shadow: 0 0 0 4px rgba(11, 11, 10, .9); }
.cal-wrap .fc .fc-event:focus::after { background: none; }
.cal-wrap .fc .fc-event.fc-event-dragging { opacity: .85; }
.cal-wrap .fc .fc-event-mirror { opacity: .75; }
.cal-wrap .fc .fc-list { border-radius: var(--r-lg); overflow: hidden; background: var(--panel); border-color: var(--line); }
.cal-wrap .fc .fc-list-table { width: 100%; }
.cal-wrap .fc .fc-list-day-cushion { background: var(--bg-elev); padding: 8px 14px; font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.cal-wrap .fc .fc-list-day.fc-day-today .fc-list-day-cushion { color: var(--fg); }
.cal-wrap .fc .fc-list-event td { padding: 9px 14px; border-color: var(--line-soft); vertical-align: middle; }
.cal-wrap .fc .fc-list-event-time { color: var(--fg-2); font-variant-numeric: tabular-nums; width: 96px; white-space: nowrap; }
.cal-wrap .fc .fc-list-event-graphic { display: none; }
/* the title cell takes the remaining width and never grows past it, so long captions truncate */
.cal-wrap .fc .fc-list-event-title { width: 100%; max-width: 0; }
.cal-wrap .fc .fc-list-event:hover td { background: var(--panel-hover); }
.cal-wrap .fc .fc-list-empty { background: var(--panel); color: var(--muted); min-height: 160px; }
.cal-wrap .fc .fc-highlight { background: var(--fc-highlight-color); }
.cal-wrap .fc a { color: inherit; }
</style>
