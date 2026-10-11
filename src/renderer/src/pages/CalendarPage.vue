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
import type { CalendarOptions, EventDropArg, EventInput, EventClickArg, DatesSetArg } from '@fullcalendar/core';
import type { Post, PostStatus } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Select from '@/components/ui/Select.vue';
import Segmented from '@/components/ui/Segmented.vue';
import PostDrawer from '@/components/posts/PostDrawer.vue';
import SlotsModal from '@/components/posts/SlotsModal.vue';
import { EDITABLE, KIND_LABEL, POST_STATUS, brandColor, brandName, postStatus, useBrands } from '@/components/posts/meta';
import { fmtWhen, toWall, tzLabel, wallDateToIso } from '@/components/posts/time';
import { api } from '@/lib/api';
import { onTopics } from '@/lib/live';
import { fail, ok, toast } from '@/composables/toast';
import { useShortcuts } from '@/composables/shortcuts';

const route = useRoute();
const router = useRouter();
const brands = useBrands();

type View = 'dayGridMonth' | 'timeGridWeek' | 'listMonth';
const view = ref<View>((() => { try { return (localStorage.getItem('cubby-cal-view') as View) || 'dayGridMonth'; } catch { return 'dayGridMonth'; } })());
watch(view, v => { try { localStorage.setItem('cubby-cal-view', v); } catch { /* ignore */ } cal.value?.getApi().changeView(v); });
const title = ref('');
const brandFilter = ref<string | null>(typeof route.query.brand === 'string' ? route.query.brand : null);
const statusFilter = ref<string>('active');
const openPost = ref<string | null>(null);
const slotsOpen = ref(route.query.slots === '1');
const loadError = ref<string | null>(null);
const count = ref<number | null>(null);
const cal = shallowRef<InstanceType<typeof FullCalendar> | null>(null);

const STATUS_OPTIONS = [
  { value: 'active', label: 'All but cancelled' },
  { value: 'all', label: 'Every status' },
  ...(Object.keys(POST_STATUS) as PostStatus[]).map(s => ({ value: s, label: POST_STATUS[s].label }))
];
const brandOptions = computed(() => [{ value: null, label: 'All brands' }, ...brands.list.map(b => ({ value: b.id, label: b.name }))]);
const statusArg = () => (statusFilter.value === 'all' ? undefined : statusFilter.value === 'active' ? (Object.keys(POST_STATUS) as PostStatus[]).filter(s => s !== 'cancelled') : [statusFilter.value]);
const draggable = (p: Post) => EDITABLE.includes(p.status);

function toEvent(p: Post): EventInput {
  return {
    id: p.id, start: toWall(p.scheduledAt!), allDay: false, title: p.caption || KIND_LABEL[p.kind],
    startEditable: draggable(p), durationEditable: false, backgroundColor: 'transparent', borderColor: 'transparent', textColor: 'inherit',
    classNames: [`st-${p.status}`], extendedProps: { post: p }
  };
}

const options = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
  initialView: view.value,
  headerToolbar: false,
  timeZone: 'UTC', // events are fed as wall times in Settings.timezone
  now: () => toWall(new Date()),
  firstDay: 1,
  height: view.value === 'timeGridWeek' ? 660 : 'auto',
  dayMaxEvents: 4,
  nowIndicator: true,
  allDaySlot: false,
  scrollTime: '08:00:00',
  defaultTimedEventDuration: '00:30',
  eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
  slotLabelFormat: { hour: 'numeric', meridiem: 'short' },
  editable: true,
  eventDurationEditable: false,
  noEventsContent: 'No posts in this range.',
  events: async (info, success, failure) => {
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
    }
  },
  datesSet: (a: DatesSetArg) => { title.value = a.view.title; },
  eventClick: (a: EventClickArg) => { a.jsEvent.preventDefault(); openPost.value = a.event.id; },
  eventAllow: (span) => span.start.getTime() >= new Date(toWall(new Date()) + 'Z').getTime() - 60_000,
  eventDrop: async (a: EventDropArg) => {
    const p = a.event.extendedProps.post as Post;
    const iso = wallDateToIso(a.event.start!);
    try {
      const r = await api('posts.reschedule', { id: p.id, scheduledAt: iso });
      a.event.setExtendedProp('post', r);
      if (r.error) toast('Moved — but check pacing', { tone: 'warn', body: r.error });
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
const off = onTopics(['posts.changed'], refetch);
onBeforeUnmount(off);
useShortcuts({ ArrowLeft: prev, ArrowRight: next, t: today, m: () => (view.value = 'dayGridMonth'), w: () => (view.value = 'timeGridWeek'), l: () => (view.value = 'listMonth') });

// drafts with no time never appear on the grid — list them under it so they're not lost
const drafts = ref<Post[]>([]);
async function loadDrafts() {
  try { drafts.value = (await api('posts.list', { brandId: brandFilter.value ?? undefined, status: ['draft'], limit: 100 })).filter(p => !p.scheduledAt); }
  catch { drafts.value = []; }
}
onMounted(loadDrafts);
watch(brandFilter, loadDrafts);
const offD = onTopics(['posts.changed'], loadDrafts);
onBeforeUnmount(offD);

watch(() => route.query.slots, v => { if (v === '1') slotsOpen.value = true; });
watch(slotsOpen, o => { if (!o && route.query.slots) void router.replace({ query: { ...route.query, slots: undefined } }); });
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
        <Btn size="sm" variant="ghost" title="Today (T)" @click="today">Today</Btn>
        <h2 class="h2 ttl">{{ title }}</h2>
        <span v-if="count !== null" class="tiny muted num">{{ count }} {{ count === 1 ? 'post' : 'posts' }}</span>
      </div>
      <div class="filters">
        <Select v-model="brandFilter" variant="pill" :options="brandOptions" aria-label="Brand" :min-width="180" />
        <Select v-model="statusFilter" variant="pill" :options="STATUS_OPTIONS" aria-label="Status" :min-width="190" />
        <Segmented v-model="view" size="sm" :options="[{ value: 'dayGridMonth', label: 'Month' }, { value: 'timeGridWeek', label: 'Week' }, { value: 'listMonth', label: 'List' }]" />
      </div>
    </div>

    <div v-if="loadError" class="loaderr small"><Icon name="warn" :size="14" />Posts aren’t available yet — {{ loadError }}<button type="button" class="link" @click="refetch">Retry</button></div>

    <div class="cal-wrap" :class="`v-${view}`">
      <FullCalendar ref="cal" :options="options">
        <template #eventContent="arg">
          <div class="ev" :style="{ '--bc': brandColor(arg.event.extendedProps.post.brandId) }" :title="`${brandName(arg.event.extendedProps.post.brandId)} · ${postStatus(arg.event.extendedProps.post.status).label}\n${arg.event.extendedProps.post.caption}`">
            <span class="bar" />
            <span v-if="arg.timeText && arg.view.type !== 'listMonth'" class="t num">{{ arg.timeText }}</span>
            <span class="b ellipsis">{{ brandName(arg.event.extendedProps.post.brandId) }}</span>
            <span v-if="arg.view.type !== 'dayGridMonth'" class="c ellipsis">{{ arg.event.extendedProps.post.caption || KIND_LABEL[arg.event.extendedProps.post.kind as keyof typeof KIND_LABEL] }}</span>
            <span class="sd" :class="`tone-${postStatus(arg.event.extendedProps.post.status).tone}`" :aria-label="postStatus(arg.event.extendedProps.post.status).label">
              <template v-if="arg.view.type !== 'dayGridMonth'">{{ postStatus(arg.event.extendedProps.post.status).label }}</template>
            </span>
          </div>
        </template>
      </FullCalendar>
    </div>

    <section v-if="drafts.length" class="drafts">
      <div class="section-title"><h2 class="h3">Drafts without a time</h2><span class="tiny muted num">{{ drafts.length }}</span></div>
      <ul>
        <li v-for="d in drafts" :key="d.id">
          <button type="button" class="draft" @click="openPost = d.id">
            <span class="swatch" :style="{ background: brandColor(d.brandId) }" />
            <span class="small strong nowrap">{{ brandName(d.brandId) }}</span>
            <span class="small muted nowrap">{{ KIND_LABEL[d.kind] }}</span>
            <span class="grow small ellipsis">{{ d.caption || 'No caption' }}</span>
            <Icon name="arrow" :size="14" class="go" />
          </button>
        </li>
      </ul>
    </section>

    <div class="legend tiny muted">
      <span v-for="(s, k) in POST_STATUS" :key="k" class="lg"><span class="sd" :class="`tone-${s.tone}`" />{{ s.label }}</span>
    </div>

    <PostDrawer :post-id="openPost" @close="openPost = null" />
    <SlotsModal v-model:open="slotsOpen" :brand-id="brandFilter ?? brands.list[0]?.id ?? null" />
  </div>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: var(--s4); }
.nav { display: flex; align-items: center; gap: 6px; }
.filters { display: flex; align-items: center; gap: 10px; margin-left: auto; flex: none; }
.nb { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line); display: grid; place-items: center; transition: border-color 200ms, background-color 200ms; }
.nb:hover { border-color: var(--fg); background: var(--panel-2); }
.ttl { margin: 0 6px 0 8px; min-width: 150px; }
.loaderr { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: var(--r-lg); background: var(--warn-bg); color: var(--warn); margin-bottom: var(--s4); }
.loaderr .link { margin-left: auto; }
.ev { position: relative; display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 2px 6px 2px 9px; border-radius: 4px; background: color-mix(in srgb, var(--bc) 13%, var(--panel)); color: var(--fg); font-size: var(--fs-xs); line-height: 1.35; overflow: hidden; cursor: pointer; }
.ev .bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--bc); }
.ev .t { color: var(--fg-2); font-weight: 500; flex: none; }
.ev .b { font-weight: 600; flex: 0 1 auto; }
.ev .c { color: var(--fg-2); flex: 1 1 auto; }
.v-timeGridWeek .ev { flex-wrap: wrap; align-content: flex-start; height: 100%; row-gap: 0; }
.v-listMonth .ev { background: none; padding-left: 10px; font-size: var(--fs-sm); }
.sd { flex: none; display: inline-flex; align-items: center; gap: 5px; margin-left: auto; font-size: var(--fs-2xs); font-family: var(--mono); text-transform: uppercase; letter-spacing: .03em; }
.sd::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.tone-muted { color: var(--faint); } .tone-good { color: var(--good); } .tone-warn { color: var(--warn); } .tone-bad { color: var(--bad); } .tone-info { color: var(--info); } .tone-neutral { color: var(--muted); }
.tone-signal { color: var(--fg); } .tone-signal::before { background: var(--lime); box-shadow: 0 0 0 1px var(--ink); }
.drafts { margin-top: var(--s6); }
.draft { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 6px; border-bottom: 1px solid var(--line-soft); text-align: left; border-radius: var(--r); }
.draft:hover { background: var(--panel-hover); }
.draft .go { opacity: 0; transition: opacity 200ms; }
.draft:hover .go { opacity: 1; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: var(--s5); }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.lg .sd { margin: 0; }
</style>

<style>
/* FullCalendar on FF tokens (light and dark follow the variables) */
.cal-wrap .fc {
  --fc-border-color: var(--line);
  --fc-page-bg-color: var(--bg);
  --fc-neutral-bg-color: var(--panel-2);
  --fc-neutral-text-color: var(--muted);
  --fc-today-bg-color: color-mix(in srgb, var(--lime) 10%, transparent);
  --fc-now-indicator-color: var(--bad);
  --fc-highlight-color: color-mix(in srgb, var(--lime) 22%, transparent);
  --fc-event-bg-color: transparent;
  --fc-event-border-color: transparent;
  --fc-event-text-color: var(--fg);
  --fc-list-event-hover-bg-color: var(--panel-hover);
  --fc-small-font-size: var(--fs-xs);
  font-family: var(--sans);
  font-size: var(--fs-sm);
  color: var(--fg);
}
.cal-wrap .fc .fc-scrollgrid { border-radius: var(--r-lg); overflow: hidden; background: var(--panel); }
.cal-wrap .fc .fc-col-header-cell { background: var(--bg-elev); }
.cal-wrap .fc .fc-col-header-cell-cushion { padding: 8px 6px; font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.cal-wrap .fc .fc-daygrid-day-number { padding: 6px 8px; font-size: var(--fs-xs); color: var(--fg-2); font-variant-numeric: tabular-nums; }
.cal-wrap .fc .fc-day-other .fc-daygrid-day-number { color: var(--faint); }
.cal-wrap .fc .fc-day-today .fc-daygrid-day-number { background: var(--fg); color: var(--bg); border-radius: 99px; margin: 4px; padding: 2px 7px; }
.cal-wrap .fc .fc-daygrid-day-frame { min-height: 96px; }
.cal-wrap .fc .fc-daygrid-event { margin: 1px 4px 2px; padding: 0; border: 0; }
.cal-wrap .fc .fc-daygrid-event-harness { margin-top: 1px; }
.cal-wrap .fc .fc-daygrid-more-link { font-size: var(--fs-xs); color: var(--muted); padding: 1px 6px; }
.cal-wrap .fc .fc-daygrid-more-link:hover { color: var(--fg); background: none; text-decoration: underline; }
.cal-wrap .fc .fc-popover { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow-2); }
.cal-wrap .fc .fc-popover-header { background: var(--bg-elev); padding: 6px 10px; font-size: var(--fs-xs); }
.cal-wrap .fc .fc-timegrid-slot { height: 34px; }
.cal-wrap .fc .fc-timegrid-slot-label-cushion, .cal-wrap .fc .fc-timegrid-axis-cushion { font-size: var(--fs-2xs); font-family: var(--mono); color: var(--muted); text-transform: uppercase; }
.cal-wrap .fc .fc-timegrid-event { border-radius: 4px; box-shadow: none; }
.cal-wrap .fc .fc-timegrid-event .fc-event-main { padding: 0; height: 100%; }
.cal-wrap .fc .fc-timegrid-event-harness-inset .fc-timegrid-event { box-shadow: 0 0 0 1px var(--panel); }
.cal-wrap .fc .fc-event { cursor: pointer; }
.cal-wrap .fc .fc-event:focus-visible { outline: 2px solid var(--lime); }
.cal-wrap .fc .fc-event.fc-event-dragging { opacity: .85; }
.cal-wrap .fc .fc-event-mirror { opacity: .7; }
.cal-wrap .fc .fc-list { border-radius: var(--r-lg); overflow: hidden; background: var(--panel); }
.cal-wrap .fc .fc-list-day-cushion { background: var(--bg-elev); padding: 8px 14px; font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.cal-wrap .fc .fc-list-event td { padding: 8px 14px; border-color: var(--line-soft); }
.cal-wrap .fc .fc-list-event-time { color: var(--fg-2); font-variant-numeric: tabular-nums; width: 90px; }
.cal-wrap .fc .fc-list-event-graphic { display: none; }
.cal-wrap .fc .fc-list-empty { background: var(--panel); color: var(--muted); }
.cal-wrap .fc .fc-highlight { background: var(--fc-highlight-color); }
.cal-wrap .fc a { color: inherit; }
</style>
