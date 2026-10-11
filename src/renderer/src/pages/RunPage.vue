<script setup lang="ts">
// One run (PLAN 6.8 / 18): header, live log (run.log events + refresh on runs.changed),
// screenshots, error, abort while running, link to the post.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FlowRun, FlowStep, RunLogEntry } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import Icon from '@/components/ui/Icon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ActorChip from '@/components/activity/ActorChip.vue';
import ImageZoom from '@/components/media/ImageZoom.vue';
import { STEP_META } from '@/components/flows/steps';
import PostDrawer from '@/components/posts/PostDrawer.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { brandById, runStatus, useBrands } from '@/components/posts/meta';
import { duration, fmtStamp, fmtWhen } from '@/components/posts/time';
import { api, fileUrl, on } from '@/lib/api';
import { onTopics } from '@/lib/live';
import { fail, ok } from '@/composables/toast';
import { confirm } from '@/composables/confirm';

const route = useRoute();
const router = useRouter();
useBrands();
const id = computed(() => String(route.params.id));
const run = ref<FlowRun | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);
const log = ref<RunLogEntry[]>([]);

async function load(quiet = false) {
  if (!quiet) loading.value = true;
  try {
    const r = await api('runs.get', { id: id.value });
    run.value = r;
    // keep live entries that arrived after the snapshot
    const known = new Set(r.log.map(e => e.at + e.msg));
    log.value = [...r.log, ...log.value.filter(e => !known.has(e.at + e.msg) && e.at > (r.log.at(-1)?.at ?? ''))];
    error.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(id, () => { run.value = null; log.value = []; void load(); }, { immediate: true });

const follow = ref(true);
const logEl = ref<HTMLElement | null>(null);
async function scrollDown() { await nextTick(); if (follow.value && logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight; }
watch(() => log.value.length, scrollDown);
function onScroll() { const el = logEl.value; if (el) follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }

const offs = [
  on('run.log', p => { if (p.runId === id.value) log.value = [...log.value, p.entry]; }),
  onTopics(['runs.changed'], () => void load(true))
];
// clock for the running duration
const now = ref(Date.now());
const tick = window.setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => { offs.forEach(f => f()); clearInterval(tick); });

// step ids in the log -> "3 · Click" (from the flow as it is now; ids it no longer has stay as they are)
const stepNames = ref(new Map<string, string>());
watch(() => run.value?.flowId, async fid => {
  const m = new Map<string, string>();
  if (fid) {
    try {
      const f = await api('flows.get', { id: fid });
      const walk = (list: FlowStep[], prefix: string) => list.forEach((st, i) => {
        const n = `${prefix}${i + 1}`;
        m.set(st.id, `${n} · ${STEP_META[st.type]?.label ?? st.type}`);
        if (st.type === 'if_exists') { walk(st.then, `${n}.`); walk(st.else ?? [], `${n}.`); }
        if (st.type === 'loop_media') walk(st.steps, `${n}.`);
      });
      walk(f.steps, '');
    } catch { /* the flow was deleted: show the raw ids */ }
  }
  stepNames.value = m;
}, { immediate: true });
const stepName = (s: string) => stepNames.value.get(s) ?? s;
const brand = computed(() => brandById(run.value?.brandId));
const st = computed(() => runStatus(run.value?.status ?? 'running'));
const took = computed(() => run.value ? duration((run.value.endedAt ? new Date(run.value.endedAt).getTime() : now.value) - new Date(run.value.startedAt).getTime()) : '—');
const screens = computed(() => {
  const fromLog = log.value.filter(e => e.screen).map(e => ({ path: e.screen!, label: e.step ? `${stepName(e.step)} · ${fmtStamp(e.at)}` : fmtStamp(e.at) }));
  const seen = new Set(fromLog.map(s => s.path));
  return [...fromLog, ...(run.value?.screens ?? []).filter(p => !seen.has(p)).map(p => ({ path: p, label: 'Screenshot' }))];
});
const zoom = ref<number | null>(null);
const zoomPath = (p: string) => (zoom.value = screens.value.findIndex(s => s.path === p));

const aborting = ref(false);
async function abort() {
  if (!(await confirm({ title: 'Abort this run?', body: 'It stops after the current action. Anything half-filled stays on the page for you to check.', confirm: 'Abort', danger: true }))) return;
  aborting.value = true;
  try { await api('runs.abort', { id: id.value }); ok('Aborting…'); void load(true); } catch (e) { fail(e); } finally { aborting.value = false; }
}
const front = () => void api('brands.front', { id: run.value!.brandId }).catch(e => fail(e));
const openPost = ref<string | null>(null);
const copyLog = async () => { try { await navigator.clipboard.writeText(log.value.map(e => `${e.at} ${e.level.toUpperCase()} ${e.step ? `[${e.step}] ` : ''}${e.msg}`).join('\n')); ok('Log copied'); } catch (e) { fail(e); } };
</script>

<template>
  <div class="page run">
    <PageHeader eyebrow="Run" :title="run?.label ?? 'Run'" :back="{ to: '/flows?tab=runs', label: 'Runs' }">
      <template v-if="run">
        <Chip :tone="st.tone">{{ st.label }}</Chip>
        <span class="row gap-2"><BrandAvatar :brand="brand ?? { name: '?' }" :size="18" />{{ brand?.name ?? 'Unknown brand' }}</span>
        <ActorChip :actor="run.actor" />
        <span class="num">{{ took }}</span>
        <span>started {{ fmtWhen(run.startedAt) }}</span>
      </template>
      <template #actions>
        <Btn v-if="run && run.status !== 'needs_human'" icon="front" @click="front">Show window</Btn>
        <Btn v-if="run?.postId" icon="compose" @click="openPost = run.postId">Open post</Btn>
        <Btn v-if="run?.flowId" icon="flow" :to="`/flows/${run.flowId}`">Edit flow</Btn>
        <Btn v-if="run?.status === 'running'" variant="danger" icon="stop" :loading="aborting" @click="abort">Abort</Btn>
      </template>
    </PageHeader>

    <EmptyState v-if="error && !run" icon="warn" title="Could not load this run" :body="error">
      <Btn size="sm" icon="refresh" @click="load()">Try again</Btn><Btn size="sm" @click="router.push('/flows?tab=runs')">All runs</Btn>
    </EmptyState>
    <div v-else-if="loading && !run" class="col gap-4"><div class="skel" style="height: 80px; border-radius: 8px" /><div class="skel" style="height: 320px; border-radius: 8px" /></div>

    <template v-else-if="run">
      <div v-if="run.error" class="errbox" :class="{ human: run.status === 'needs_human', stopped: run.status === 'aborted' }">
        <Icon :name="run.status === 'aborted' ? 'stop' : 'warn'" :size="16" />
        <div class="grow">
          <div class="strong">{{ run.status === 'needs_human' ? 'Stopped — this needs you' : run.status === 'aborted' ? 'Aborted' : 'The run failed' }}</div>
          <div class="small pre">{{ run.error }}</div>
          <div v-if="run.status === 'needs_human'" class="tiny mt-2">Cubby never solves checkpoints or captchas. Finish it in the brand window, then run again.</div>
        </div>
        <Btn v-if="run.status === 'needs_human'" size="sm" icon="front" @click="front">Show window</Btn>
      </div>

      <section v-if="screens.length" class="mb-5">
        <div class="label mb-2">Screenshots</div>
        <div class="strip">
          <button v-for="s in screens" :key="s.path" type="button" class="shot" :title="s.label" @click="zoomPath(s.path)"><img :src="fileUrl(s.path)" alt="" loading="lazy" /><span class="tiny ellipsis">{{ s.label }}</span></button>
        </div>
      </section>

      <section class="logp">
        <div class="lh">
          <span class="label">Log</span>
          <span v-if="run.status === 'running'" class="live tiny"><span class="ld" />live</span>
          <span class="grow" />
          <button type="button" class="tiny muted lk" @click="copyLog">Copy</button>
          <label class="tiny muted row gap-1"><input v-model="follow" type="checkbox" /> Follow</label>
        </div>
        <ol ref="logEl" class="log" @scroll="onScroll">
          <li v-for="(e, i) in log" :key="i" :class="`lv-${e.level}`">
            <span class="t num" :title="fmtWhen(e.at)">{{ fmtStamp(e.at).split(', ').pop() }}</span>
            <span class="m"><span v-if="e.step && !e.msg.includes(e.step)" class="sp">{{ stepName(e.step) }}</span>{{ e.msg }}</span>
            <button v-if="e.screen" type="button" class="si" :aria-label="'Open screenshot'" @click="zoomPath(e.screen)"><Icon name="image" :size="13" /></button>
          </li>
          <li v-if="!log.length" class="empty">{{ run.status === 'running' ? 'Waiting for the first step…' : 'No log entries.' }}</li>
        </ol>
      </section>
    </template>

    <ImageZoom v-model:index="zoom" :images="screens" />
    <PostDrawer :post-id="openPost" @close="openPost = null" />
  </div>
</template>

<style scoped>
.errbox { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; margin-bottom: var(--s5); border-radius: var(--r-lg); background: var(--bad-bg); color: var(--bad); }
.errbox.human { background: var(--warn-bg); color: var(--warn); }
.errbox.stopped { background: var(--panel); color: var(--fg-2); box-shadow: inset 0 0 0 1px var(--line); }
/* a very long run label stays two lines in the header */
.run :deep(.page-header .title .mask > span) { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.errbox .icon { margin-top: 2px; }
.strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.shot { flex: none; width: 180px; display: flex; flex-direction: column; gap: 4px; text-align: left; color: var(--muted); }
.shot img { width: 180px; height: 112px; object-fit: cover; object-position: top; border-radius: 6px; border: 1px solid var(--line); transition: border-color 200ms; }
.shot:hover img { border-color: var(--fg); }
.logp { border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); overflow: hidden; }
.lh { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.lk:hover { color: var(--fg); }
.live { display: inline-flex; align-items: center; gap: 6px; color: var(--fg); }
.ld { width: 7px; height: 7px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 1px var(--ink); animation: ff-pulse 1.6s var(--ease-out) infinite; }
.log { max-height: min(56vh, 560px); min-height: 160px; overflow-y: auto; font-family: var(--mono); font-size: var(--fs-xs); padding: 8px 0; }
.log li { display: flex; gap: 12px; padding: 3px 14px; align-items: baseline; line-height: 1.5; }
.log li:hover { background: var(--panel-hover); }
.t { color: var(--muted); flex: none; width: 84px; white-space: nowrap; }
.m { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--fg-2); }
.sp { display: inline-block; margin-right: 8px; padding: 0 6px; border-radius: 3px; background: var(--panel-2); color: var(--fg); }
.lv-warn .m { color: var(--warn); }
.lv-error .m { color: var(--bad); }
.si { color: var(--muted); flex: none; } .si:hover { color: var(--fg); }
.empty { color: var(--muted); font-family: var(--sans); font-size: var(--fs-sm); padding: 20px 14px !important; }
input[type=checkbox] { accent-color: var(--fg); }
</style>
