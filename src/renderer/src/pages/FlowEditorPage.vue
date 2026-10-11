<script setup lang="ts">
// Flow editor (PLAN 6.8): name, brand scope, schedule, step list (nested for If / Loop), recorder.
// /flows/new creates; /flows/:id edits.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import type { Flow, FlowStep, RecipeInfo } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Segmented from '@/components/ui/Segmented.vue';
import Toggle from '@/components/ui/Toggle.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import StepList from '@/components/flows/StepList.vue';
import RunBrandModal from '@/components/flows/RunBrandModal.vue';
import BrandPicker from '@/components/common/BrandPicker.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { countSteps, validateSteps } from '@/components/flows/steps';
import { buildSchedule, cronError, describeSchedule, parseSchedule, type SchedulePreset } from '@/components/flows/cron';
import { brandName, useBrands } from '@/components/posts/meta';
import { fmtWhen } from '@/components/posts/time';
import { api } from '@/lib/api';
import { fail, ok, toast } from '@/composables/toast';
import { confirm } from '@/composables/confirm';
import { useShortcuts } from '@/composables/shortcuts';
import type { MenuItem } from '@/components/ui/types';

const route = useRoute();
const router = useRouter();
const brands = useBrands();

const flow = ref<Flow | null>(null);
const name = ref('');
const scope = ref<Flow['brandScope']>('one');
const brandIds = ref<string[]>([]);
const steps = ref<FlowStep[]>([]);
const enabled = ref(true);
const sched = ref<'off' | 'hourly' | 'daily' | 'weekdays' | 'custom'>('off');
const minute = ref(0);
const at = ref('09:00');
const cron = ref('');
const loading = ref(false);
const loadError = ref<string | null>(null);
const saving = ref(false);
const triedSave = ref(false);
const recipes = ref<RecipeInfo[] | null>(null);
api('flows.recipes').then(r => (recipes.value = r)).catch(() => (recipes.value = null));

const isNew = computed(() => route.params.id === 'new');
function fill(f: Flow | null) {
  flow.value = f;
  name.value = f?.name ?? '';
  scope.value = f?.brandScope ?? 'one';
  brandIds.value = [...(f?.brandIds ?? [])];
  steps.value = JSON.parse(JSON.stringify(f?.steps ?? [{ id: 's_open', type: 'open_brand' }]));
  enabled.value = f?.enabled ?? true;
  const p = parseSchedule(f?.schedule);
  sched.value = p.kind;
  if (p.kind === 'hourly') minute.value = p.minute;
  if (p.kind === 'daily' || p.kind === 'weekdays') at.value = p.time;
  if (p.kind === 'custom') cron.value = p.cron;
  setTimeout(snapshot, 0);
}
async function load() {
  loadError.value = null; triedSave.value = false;
  if (isNew.value) { fill(null); if (typeof route.query.brand === 'string') brandIds.value = [route.query.brand]; return; }
  loading.value = true;
  try { fill(await api('flows.get', { id: String(route.params.id) })); }
  catch (e) { loadError.value = (e as Error).message; }
  finally { loading.value = false; }
}
watch(() => route.params.id, id => { if (id && route.path.startsWith('/flows/')) void load(); }, { immediate: true });

const preset = computed<SchedulePreset>(() => sched.value === 'hourly' ? { kind: 'hourly', minute: minute.value } : sched.value === 'daily' ? { kind: 'daily', time: at.value } : sched.value === 'weekdays' ? { kind: 'weekdays', time: at.value } : sched.value === 'custom' ? { kind: 'custom', cron: cron.value } : { kind: 'off' });
const schedule = computed(() => buildSchedule(preset.value));
watch(scope, s => { if (s === 'one' && brandIds.value.length > 1) brandIds.value = brandIds.value.slice(0, 1); if (s === 'any') brandIds.value = []; });

// ── validation ───────────────────────────────────────────────────────────────
const stepErrors = computed(() => validateSteps(steps.value));
const fieldErrors = computed(() => ({
  name: !name.value.trim() ? 'Give the flow a name' : null,
  brands: scope.value === 'one' && brandIds.value.length !== 1 ? 'Choose the brand it runs on' : scope.value === 'many' && !brandIds.value.length ? 'Choose at least one brand' : null,
  schedule: sched.value === 'custom' ? (cron.value.trim() ? cronError(cron.value) : 'Enter a cron expression') : sched.value !== 'off' && scope.value === 'any' ? 'A scheduled flow needs fixed brands — choose One or Several' : null,
  steps: !steps.value.length ? 'Add at least one step' : null
}));
const problemCount = computed(() => Object.values(fieldErrors.value).filter(Boolean).length + Object.keys(stepErrors.value).length);
const show = (k: keyof typeof fieldErrors.value) => (triedSave.value ? fieldErrors.value[k] : null);
// a cron typo shows as you type; other schedule problems after the first save attempt
const schedMsg = computed(() => (sched.value === 'custom' && cron.value.trim() ? cronError(cron.value) : null) ?? show('schedule'));
const schedText = computed(() => (sched.value === 'custom' && cron.value.trim() && cronError(cron.value) ? 'Schedule needs fixing' : describeSchedule(schedule.value)));
const shownStepErrors =computed(() => (triedSave.value ? stepErrors.value : {}));

// ── save / run / delete ──────────────────────────────────────────────────────
async function save(): Promise<Flow | null> {
  triedSave.value = true;
  if (problemCount.value) { toast(`Fix ${problemCount.value} ${problemCount.value === 1 ? 'thing' : 'things'} before saving`, { tone: 'warn', body: Object.values(fieldErrors.value).find(Boolean) ?? Object.values(stepErrors.value)[0] }); return null; }
  saving.value = true;
  try {
    const body = { name: name.value.trim(), brandScope: scope.value, brandIds: brandIds.value, steps: steps.value, schedule: schedule.value, enabled: enabled.value };
    const f = flow.value ? await api('flows.update', { id: flow.value.id, patch: body }) : await api('flows.create', body);
    const created = !flow.value;
    fill(f);
    ok(created ? 'Flow created' : 'Flow saved', f.schedule && f.enabled && f.nextRunAt ? `Next run ${fmtWhen(f.nextRunAt)}` : undefined);
    if (created) void router.replace(`/flows/${f.id}`);
    return f;
  } catch (e) {
    fail(e, 'Could not save the flow');
    return null;
  } finally {
    saving.value = false;
  }
}
const runOpen = ref(false);
const running = ref(false);
async function runNow() {
  let f = flow.value;
  if (!f || dirty.value) { f = await save(); if (!f) return; }
  if (f.brandScope === 'one' && f.brandIds.length === 1) await doRun(f.brandIds);
  else runOpen.value = true;
}
async function doRun(ids: string[]) {
  if (!flow.value) return;
  running.value = true;
  try {
    const r = await api('flows.run', { id: flow.value.id, brandIds: ids });
    runOpen.value = false;
    toast(r.length > 1 ? `Started ${r.length} runs` : 'Flow started', { tone: 'good', action: r[0] ? { label: 'View run', run: () => void router.push(`/runs/${r[0].id}`) } : undefined });
  } catch (e) { fail(e, 'Could not start the flow'); }
  finally { running.value = false; }
}
async function remove() {
  if (!flow.value) return;
  if (!(await confirm({ title: `Delete “${flow.value.name}”?`, confirm: 'Delete flow', danger: true }))) return;
  try { await api('flows.delete', { id: flow.value.id }); snapshot(); ok('Flow deleted'); void router.push('/flows'); } catch (e) { fail(e); }
}
async function duplicate() {
  if (!flow.value) return;
  try { const c = await api('flows.duplicate', { id: flow.value.id }); ok('Duplicated'); void router.push(`/flows/${c.id}`); } catch (e) { fail(e); }
}

// ── recorder ─────────────────────────────────────────────────────────────────
const recBrand = ref<string | null>(null);
watch(brandIds, ids => { if (!recBrand.value && ids[0]) recBrand.value = ids[0]; }, { immediate: true });
const recording = ref<{ id: string; brandId: string; since: number } | null>(null);
const recBusy = ref(false);
const recTick = ref(0);
let recTimer = 0;
async function recStart() {
  if (!recBrand.value) { toast('Choose the brand to record in', { tone: 'warn' }); return; }
  recBusy.value = true;
  try {
    const r = await api('flows.recordStart', { brandId: recBrand.value });
    recording.value = { id: r.recordingId, brandId: recBrand.value, since: Date.now() };
    recTimer = window.setInterval(() => recTick.value++, 1000);
  } catch (e) { fail(e, 'Could not start recording'); }
  finally { recBusy.value = false; }
}
async function recStop() {
  const r = recording.value; if (!r) return;
  recBusy.value = true;
  try {
    const got = await api('flows.recordStop', { recordingId: r.id });
    steps.value = [...steps.value, ...got];
    toast(got.length ? `Added ${got.length} recorded ${got.length === 1 ? 'step' : 'steps'}` : 'Nothing was recorded', { tone: got.length ? 'good' : 'neutral', body: got.length ? 'Check the selectors — recorded steps are a starting point.' : 'Clicks, typing and page changes in the brand window are captured.' });
  } catch (e) { fail(e, 'Could not stop recording'); }
  finally { recBusy.value = false; recording.value = null; clearInterval(recTimer); }
}
onBeforeUnmount(() => { clearInterval(recTimer); if (recording.value) void api('flows.recordStop', { recordingId: recording.value.id }).catch(() => undefined); });
const recElapsed = computed(() => { void recTick.value; const s = recording.value ? Math.floor((Date.now() - recording.value.since) / 1000) : 0; return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; });

// ── leave guard ──────────────────────────────────────────────────────────────
const snap = ref('');
const state = () => JSON.stringify([name.value, scope.value, brandIds.value, steps.value, enabled.value, schedule.value]);
function snapshot() { snap.value = state(); }
const dirty = computed(() => state() !== snap.value);
onBeforeRouteLeave(async () => {
  if (recording.value) { if (!(await confirm({ title: 'Stop recording and leave?', confirm: 'Stop and leave', danger: true }))) return false; await recStop(); }
  if (!dirty.value) return true;
  return await confirm({ title: 'Leave without saving?', body: 'This flow has changes that are not saved.', confirm: 'Discard changes', cancel: 'Keep editing', danger: true });
});
useShortcuts({ 'mod+s': () => void save() });

const menu = computed<MenuItem[]>(() => [
  { label: 'Duplicate', icon: 'copy', run: () => void duplicate(), disabled: !flow.value },
  { label: 'Run history', icon: 'activity', to: '/flows?tab=runs' },
  { divider: true, label: '' },
  { label: 'Delete flow', icon: 'trash', danger: true, run: () => void remove(), disabled: !flow.value }
]);
const toggleBrand = (id: string) => { brandIds.value = brandIds.value.includes(id) ? brandIds.value.filter(x => x !== id) : [...brandIds.value, id]; };
const oneBrand = computed({ get: () => brandIds.value[0] ?? null, set: (v: string | null) => (brandIds.value = v ? [v] : []) });
</script>

<template>
  <div class="page flow-editor">
    <PageHeader eyebrow="Flow" :title="isNew ? 'New flow' : name || flow?.name || 'Flow'" :back="{ to: '/flows', label: 'Flows' }">
      <span>{{ countSteps(steps) }} {{ countSteps(steps) === 1 ? 'step' : 'steps' }} · {{ schedText }}</span>
      <span v-if="flow?.schedule && flow.enabled && flow.nextRunAt && !dirty">next run {{ fmtWhen(flow.nextRunAt) }}</span>
      <span v-if="dirty" class="unsaved"><span class="udot" />Unsaved changes</span>
      <template #actions>
        <Menu :items="menu" :width="190"><Btn icon="more" square aria-label="More" title="More" /></Menu>
        <Btn icon="play" :loading="running" :disabled="!steps.length" @click="runNow">Run now</Btn>
        <Btn variant="primary" icon="check" :loading="saving" @click="save">{{ isNew ? 'Create flow' : 'Save' }}</Btn>
      </template>
    </PageHeader>

    <EmptyState v-if="loadError" icon="warn" title="Could not open this flow" :body="loadError"><Btn size="sm" to="/flows">Back to flows</Btn></EmptyState>
    <div v-else-if="loading" class="col gap-4"><div class="skel" style="height: 160px; border-radius: 8px" /><div class="skel" style="height: 260px; border-radius: 8px" /></div>

    <div v-else class="ed">
      <Transition name="slide-down">
        <div v-if="recording" class="recbar">
          <div><span class="rdot" /><b>Recording in {{ brandName(recording.brandId) }}</b> — do it once in its window. <span class="num rtime">{{ recElapsed }}</span></div>
          <Btn variant="signal" size="sm" icon="stop" :loading="recBusy" @click="recStop">Stop and add steps</Btn>
        </div>
      </Transition>

      <section class="panel pad setup">
        <div class="grid2">
          <Field label="Name" :error="show('name')" required for="flow-name">
            <input id="flow-name" v-model="name" class="input" placeholder="e.g. Morning login check" />
          </Field>
          <Field label="Runs on" :error="show('brands')">
            <Segmented v-model="scope" size="sm" :options="[{ value: 'one', label: 'One brand' }, { value: 'many', label: 'Several' }, { value: 'any', label: 'Any (pick at run)' }]" />
          </Field>
        </div>
        <div v-if="scope === 'one'" class="mt-4 bp"><BrandPicker v-model="oneBrand" placeholder="Choose the brand…" /></div>
        <div v-else-if="scope === 'many'" class="mt-4 brandgrid">
          <button v-for="b in brands.list" :key="b.id" type="button" class="bchip" :class="{ on: brandIds.includes(b.id) }" :aria-pressed="brandIds.includes(b.id)" @click="toggleBrand(b.id)">
            <BrandAvatar :brand="b" :size="18" /><span class="ellipsis">{{ b.name }}</span><Icon v-if="brandIds.includes(b.id)" name="check" :size="13" />
          </button>
          <span v-if="!brands.list.length" class="small muted">No brands yet.</span>
        </div>
        <p v-else class="tiny muted mt-3">You choose the brand each time you run it. Scheduled flows need fixed brands.</p>

        <div class="hr" />
        <div class="schedgrid">
          <Field label="Schedule" class="schedf">
            <Segmented v-model="sched" size="sm" :options="[{ value: 'off', label: 'Manual' }, { value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }, { value: 'weekdays', label: 'Weekdays' }, { value: 'custom', label: 'Cron' }]" />
          </Field>
          <div class="schedctl">
            <label v-if="sched === 'hourly'" class="inl small">at minute <input v-model.number="minute" type="number" min="0" max="59" class="input mini num" aria-label="Minute" /></label>
            <label v-else-if="sched === 'daily' || sched === 'weekdays'" class="inl small">at <input v-model="at" type="time" class="input tm" aria-label="Time" /></label>
            <label v-else-if="sched === 'custom'" class="inl small grow"><input v-model="cron" class="input code-in" :class="{ invalid: !!schedMsg }" :aria-invalid="!!schedMsg" placeholder="*/30 9-18 * * 1-5" aria-label="Cron expression" spellcheck="false" /></label>
            <span v-if="sched !== 'off' && !schedMsg" class="tiny muted">{{ describeSchedule(schedule) }}</span>
            <span class="grow" />
            <Toggle v-model="enabled" label="Enabled" :hint="sched === 'off' ? 'No schedule — run it any time' : enabled ? 'Runs on its schedule' : 'Paused — skips its schedule'" />
          </div>
        </div>
        <p v-if="schedMsg" class="tiny err mt-2" role="alert">{{ schedMsg }}</p>
      </section>

      <section class="mt-6">
        <div class="section-title">
          <h2 class="h3">Steps</h2>
          <span class="tiny muted">Drag the handle or use Alt + ↑/↓ to reorder</span>
        </div>
        <p v-if="show('steps')" class="tiny err mb-3">{{ show('steps') }}</p>
        <StepList v-model="steps" :errors="shownStepErrors" :recipes="recipes" />
      </section>

      <section class="panel pad rec mt-6">
        <div class="row top gap-4 wrap">
          <div class="grow" style="min-width: 240px">
            <h3 class="h3 row gap-2"><Icon name="record" :size="16" />Recorder</h3>
            <p class="small muted mt-2">Press Record, do the task once in the brand’s Chrome window, then Stop. Clicks, typing and page changes become steps at the end of this list — check the selectors afterwards.</p>
          </div>
          <div class="recctl">
            <div class="bp2"><BrandPicker v-model="recBrand" placeholder="Brand to record in…" :disabled="!!recording" /></div>
            <Btn v-if="!recording" icon="record" :loading="recBusy" :disabled="!recBrand" @click="recStart">Record</Btn>
            <Btn v-else variant="signal" icon="stop" :loading="recBusy" @click="recStop">Stop</Btn>
          </div>
        </div>
      </section>
    </div>

    <RunBrandModal v-model:open="runOpen" :title="`Run “${name}”`" :multi="scope !== 'one'" :limit-to="scope === 'many' ? brandIds : null" :busy="running" @confirm="doRun" />
  </div>
</template>

<style scoped>
/* a very long flow name stays two lines in the header (the full name is in the Name field) */
.flow-editor :deep(.page-header .title .mask > span) { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.unsaved { display: inline-flex; align-items: center; gap: 6px; color: var(--warn); }
.udot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px 24px; align-items: start; }
.bp { width: min(360px, 100%); }
.brandgrid { display: flex; flex-wrap: wrap; gap: 6px; }
.bchip { display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px 0 7px; max-width: 220px; border-radius: 99px; border: 1px solid var(--line); background: var(--panel); font-size: var(--fs-sm); }
.bchip:hover { border-color: var(--line-strong); }
.bchip.on { border-color: var(--fg); background: var(--bg-elev); }
.schedgrid { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px 24px; }
.schedf { flex: none; max-width: 100%; }
.schedctl { flex: 1 1 300px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-height: 40px; }
.inl { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); }
.mini { width: 70px; min-height: 34px; padding: 5px 8px; }
.tm { width: 120px; min-height: 34px; padding: 5px 8px; }
.code-in { font-family: var(--mono); font-size: var(--fs-xs); min-height: 34px; padding: 5px 10px; min-width: 200px; }
.err { color: var(--bad); }
.input.invalid { border-color: var(--bad); }
.input.invalid:focus-visible { border-color: var(--bad); box-shadow: 0 0 0 3px var(--bad-bg); }
.recbar { position: sticky; top: calc(var(--topbar) + 8px); z-index: 50; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px 10px 16px; margin-bottom: var(--s4); border-radius: var(--r-lg); background: var(--ink); color: var(--bone); box-shadow: var(--shadow-2); font-size: var(--fs-sm); flex-wrap: wrap; }
[data-theme='dark'] .recbar { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-2); }
.rtime { color: #a19e94; margin-left: 4px; }
.rdot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #ff5a4f; margin-right: 8px; animation: ff-pulse 1.4s var(--ease-out) infinite; vertical-align: 0; }
.recctl { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bp2 { width: 240px; }
</style>
