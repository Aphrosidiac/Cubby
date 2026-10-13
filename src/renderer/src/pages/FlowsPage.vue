<script setup lang="ts">
// Flows (PLAN 6.8): your flows, the built-in recipes, and the run history.
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Flow, FlowRun, RecipeInfo } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Sep from '@/components/posts/Sep.vue';
import Btn from '@/components/ui/Btn.vue';
import StatusChip from '@/components/posts/StatusChip.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Toggle from '@/components/ui/Toggle.vue';
import DataTable from '@/components/ui/DataTable.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import ActorChip from '@/components/activity/ActorChip.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import RunBrandModal from '@/components/flows/RunBrandModal.vue';
import { countSteps } from '@/components/flows/steps';
import { describeSchedule } from '@/components/flows/cron';
import { KIND_LABEL, brandById, brandOrStub, brandName, useBrands } from '@/components/posts/meta';
import { duration, fmtWhen } from '@/components/posts/time';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { useLoad } from '@/composables/useLoad';
import { fail, ok, toast } from '@/composables/toast';
import { confirm } from '@/composables/confirm';
import type { Column, MenuItem } from '@/components/ui/types';

const route = useRoute();
const router = useRouter();
useBrands();
const tabOf = (q: unknown) => (['flows', 'recipes', 'runs'].includes(String(q)) ? String(q) : 'flows');
const tab = ref<string>(tabOf(route.query.tab));
watch(tab, t => { if (tabOf(route.query.tab) !== t) void router.replace({ query: { ...route.query, tab: t === 'flows' ? undefined : t } }); });
// the sidebar "Flows" link or a "/flows?tab=runs" link while already here switches the tab too
watch(() => route.query.tab, q => { if (route.path === '/flows') tab.value = tabOf(q); });

const flows = useLoad(() => api('flows.list'), { topics: ['flows.changed'] });
const recipes = useLoad(() => api('flows.recipes'));
const runs = useLoad(() => api('runs.list', { limit: 200 }), { topics: ['runs.changed'] });

const lastRun = computed(() => {
  const m = new Map<string, FlowRun>();
  for (const r of runs.data.value ?? []) if (r.flowId && (!m.has(r.flowId) || m.get(r.flowId)!.startedAt < r.startedAt)) m.set(r.flowId, r);
  return m;
});

// ── flow actions ─────────────────────────────────────────────────────────────
const toggling = ref<string | null>(null);
async function setEnabled(f: Flow, v: boolean) {
  toggling.value = f.id;
  try { await api('flows.update', { id: f.id, patch: { enabled: v } }); void flows.reload(true); ok(v ? 'Flow enabled' : 'Flow paused', f.schedule ? (v ? describeSchedule(f.schedule) : 'It will not run on its schedule') : undefined); }
  catch (e) { fail(e); }
  finally { toggling.value = null; }
}
async function duplicate(f: Flow) {
  try { const c = await api('flows.duplicate', { id: f.id }); ok('Flow duplicated'); void router.push(`/flows/${c.id}`); } catch (e) { fail(e); }
}
async function remove(f: Flow) {
  if (!(await confirm({ title: `Delete “${f.name}”?`, body: 'Its run history stays in Activity.', confirm: 'Delete flow', danger: true }))) return;
  try { await api('flows.delete', { id: f.id }); ok('Flow deleted'); void flows.reload(true); } catch (e) { fail(e); }
}

const runTarget = ref<{ kind: 'flow'; flow: Flow } | { kind: 'recipe'; recipe: RecipeInfo } | null>(null);
const running = ref(false);
function startRun(f: Flow) {
  if (f.brandScope === 'one' && f.brandIds.length === 1) void runFlow(f, f.brandIds);
  else runTarget.value = { kind: 'flow', flow: f };
}
function shownRun(list: FlowRun[], what: string) {
  toast(list.length > 1 ? `Started ${list.length} runs` : `Running ${what}`, { tone: 'good', action: list[0] ? { label: 'View run', run: () => void router.push(`/runs/${list[0].id}`) } : undefined });
}
async function runFlow(f: Flow, brandIds: string[]) {
  running.value = true;
  try { const r = await api('flows.run', { id: f.id, brandIds }); shownRun(r, f.name); runTarget.value = null; }
  catch (e) { fail(e, 'Could not start the flow'); }
  finally { running.value = false; }
}
async function runRecipe(r: RecipeInfo, brandId: string) {
  running.value = true;
  try { const run = await api('flows.runRecipe', { recipe: r.id, brandId, params: {} }); shownRun([run], r.name); runTarget.value = null; }
  catch (e) { fail(e, 'Could not start the recipe'); }
  finally { running.value = false; }
}
function confirmRun(ids: string[]) {
  const t = runTarget.value; if (!t) return;
  if (t.kind === 'flow') void runFlow(t.flow, ids); else void runRecipe(t.recipe, ids[0]);
}
const flowMenu = (f: Flow): MenuItem[] => [
  { label: 'Run now', icon: 'play', run: () => startRun(f), disabled: !f.steps.length },
  { label: 'Edit', icon: 'edit', to: `/flows/${f.id}` },
  { label: 'Duplicate', icon: 'copy', run: () => void duplicate(f) },
  { divider: true, label: '' },
  { label: 'Delete', icon: 'trash', danger: true, run: () => void remove(f) }
];
const SCOPE: Record<Flow['brandScope'], string> = { one: 'One brand', many: 'Several brands', any: 'Any brand' };
const scopeText = (f: Flow) => (f.brandScope === 'any' || !f.brandIds.length ? SCOPE[f.brandScope] : f.brandIds.length <= 2 ? f.brandIds.map(brandName).join(', ') : `${f.brandIds.length} brands`);

const flowCols: Column[] = [
  { key: 'name', label: 'Flow', sortable: true, class: 'c-fill' },
  { key: 'brandScope', label: 'Brands', width: '180px', class: 'c-brands' },
  { key: 'schedule', label: 'Schedule', width: '200px', hideSm: true, class: 'c-sched' },
  { key: 'last', label: 'Last run', width: '140px', hideSm: true, class: 'c-wide' },
  { key: 'enabled', label: 'On', width: '60px' },
  { key: 'menu', label: '', width: '46px', align: 'right' }
];
const runCols: Column[] = [
  { key: 'label', label: 'Run', sortable: true, class: 'c-fill' },
  { key: 'brandId', label: 'Brand', width: '160px' },
  { key: 'actor', label: 'By', width: '110px', hideSm: true, class: 'c-wide' },
  { key: 'status', label: 'Status', width: '120px', sortable: true },
  { key: 'startedAt', label: 'Started', width: '130px', sortable: true },
  { key: 'dur', label: 'Took', width: '80px', align: 'right', hideSm: true, class: 'c-wide' }
];
const kindsText = (r: RecipeInfo) => r.kinds.map(k => KIND_LABEL[k]).join(' · ') || 'General';
const isPosting = (r: RecipeInfo) => !!r.platform && r.kinds.length > 0;
const tabs = computed(() => [
  { value: 'flows', label: 'Flows', count: flows.data.value?.length ?? null },
  { value: 'recipes', label: 'Built-in recipes', count: recipes.data.value?.length ?? null },
  { value: 'runs', label: 'Runs', count: runs.data.value?.length ?? null }
]);
</script>

<template>
  <div class="page flows">
    <PageHeader eyebrow="Library" title="Flows">
      <span>Step-by-step automations that run in a brand’s own window, with every guardrail on.</span>
      <template #actions>
        <Btn variant="primary" icon="plus" to="/flows/new">New flow</Btn>
      </template>
    </PageHeader>

    <Tabs v-model="tab" :tabs="tabs" />
    <div class="tabbody">
      <!-- flows -->
      <template v-if="tab === 'flows'">
        <EmptyState v-if="flows.error.value && !flows.data.value" icon="warn" title="Flows aren’t available yet" :body="flows.error.value"><Btn size="sm" icon="refresh" @click="flows.reload()">Try again</Btn></EmptyState>
        <DataTable v-else :class="{ 'is-empty': flows.data.value?.length === 0 }" :columns="flowCols" :rows="flows.data.value" :loading="flows.loading.value" @row-click="r => router.push(`/flows/${r.id}`)">
          <template #cell-name="{ row }">
            <div class="strong ellipsis" :title="row.name">{{ row.name }}</div>
            <div class="tiny muted ellipsis"><span class="num">{{ countSteps(row.steps) }}</span> {{ countSteps(row.steps) === 1 ? 'step' : 'steps' }}<span v-if="lastRun.get(row.id)" class="narrow-only"><Sep /><StatusChip size="sm" of="run" :status="lastRun.get(row.id)!.status" class="lrchip" />{{ ' ' }}{{ ago(lastRun.get(row.id)!.startedAt) }}</span></div>
          </template>
          <template #cell-brandScope="{ row }">
            <div class="row gap-2" :title="row.brandIds.length ? row.brandIds.map(brandName).join(', ') : undefined">
              <span v-if="row.brandIds.length" class="avs"><span v-for="id in row.brandIds.slice(0, 3)" :key="id" class="av"><BrandAvatar :brand="brandOrStub(id)" :size="20" /></span><span v-if="row.brandIds.length > 3" class="av more num">+{{ row.brandIds.length - 3 }}</span></span>
              <span class="small muted ellipsis" :class="{ 'wide-only': row.brandIds.length }">{{ scopeText(row as Flow) }}</span>
            </div>
          </template>
          <template #cell-schedule="{ row }">
            <div class="small">{{ describeSchedule(row.schedule) }}</div>
            <div v-if="row.schedule && row.enabled && row.nextRunAt" class="tiny muted">next {{ fmtWhen(row.nextRunAt, { zone: false }) }}</div>
            <div v-else-if="row.schedule && !row.enabled" class="tiny muted">paused</div>
          </template>
          <template #cell-last="{ row }">
            <template v-if="lastRun.get(row.id)">
              <StatusChip size="sm" of="run" :status="lastRun.get(row.id)!.status" />
              <div class="tiny muted mt-1">{{ ago(lastRun.get(row.id)!.startedAt) }}</div>
            </template>
            <span v-else class="tiny muted">Never run</span>
          </template>
          <template #cell-enabled="{ row }">
            <span @click.stop><Toggle :model-value="row.enabled" :disabled="toggling === row.id" :aria-label="`${row.name} enabled`" @update:model-value="setEnabled(row as Flow, $event)" /></span>
          </template>
          <template #cell-menu="{ row }">
            <span @click.stop><Menu :items="flowMenu(row as Flow)" :width="190"><button type="button" class="ib" :aria-label="`${row.name} actions`"><Icon name="more" :size="16" :stroke="3" /></button></Menu></span>
          </template>
          <template #empty>
            <EmptyState icon="flow" title="No flows yet" body="Build one from steps, or press Record and do it once in a brand window.">
              <Btn variant="primary" size="sm" icon="plus" to="/flows/new">New flow</Btn>
              <Btn size="sm" @click="tab = 'recipes'">See built-in recipes</Btn>
            </EmptyState>
          </template>
        </DataTable>
      </template>

      <!-- recipes -->
      <template v-else-if="tab === 'recipes'">
        <p class="small muted intro">Maintained by Cubby. Posting recipes encode the known platform traps and run from the composer, because they need a post; the rest can be run on any brand.</p>
        <div v-if="recipes.loading.value" class="rgrid"><div v-for="i in 6" :key="i" class="skel" style="height: 120px; border-radius: 8px" /></div>
        <EmptyState v-else-if="recipes.error.value" icon="warn" title="Recipes aren’t available yet" :body="recipes.error.value"><Btn size="sm" icon="refresh" @click="recipes.reload()">Try again</Btn></EmptyState>
        <EmptyState v-else-if="!recipes.data.value?.length" icon="bolt" title="No recipes installed" />
        <div v-else class="rgrid">
          <article v-for="r in recipes.data.value" :key="r.id" class="recipe">
            <div class="row">
              <span class="ric"><PlatformIcon v-if="r.platform" :platform="r.platform" :size="16" colored /><Icon v-else name="bolt" :size="16" /></span>
              <div class="grow rhead">
                <h3 class="h3 ellipsis" :title="r.name">{{ r.name }}</h3>
                <div class="tiny muted ellipsis" :title="kindsText(r)"><template v-for="(k, i) in r.kinds" :key="k"><Sep v-if="i" />{{ KIND_LABEL[k] }}</template><template v-if="!r.kinds.length">General</template></div>
              </div>
            </div>
            <p class="small muted desc">{{ r.description }}</p>
            <div class="row rfoot">
              <span v-if="isPosting(r)" class="tiny muted rlbl">Runs from a post</span>
              <span class="grow" />
              <Btn v-if="isPosting(r)" size="sm" variant="ghost" icon="compose" to="/compose" title="Posting recipes need a post — write one in the composer and it runs this recipe">Open composer</Btn>
              <Btn v-else size="sm" icon="play" @click="runTarget = { kind: 'recipe', recipe: r }">Run on brand…</Btn>
            </div>
          </article>
        </div>
      </template>

      <!-- runs -->
      <template v-else>
        <EmptyState v-if="runs.error.value && !runs.data.value" icon="warn" title="Run history isn’t available yet" :body="runs.error.value"><Btn size="sm" icon="refresh" @click="runs.reload()">Try again</Btn></EmptyState>
        <DataTable v-else :class="{ 'is-empty': runs.data.value?.length === 0 }" :columns="runCols" :rows="runs.data.value" :loading="runs.loading.value" dense @row-click="r => router.push(`/runs/${r.id}`)">
          <template #cell-label="{ row }"><div class="ellipsis strongish" :title="row.label">{{ row.label }}</div><div v-if="row.error" class="tiny ellipsis" :class="row.status === 'needs_human' ? 'warnt' : row.status === 'aborted' ? 'muted' : 'bad'" :title="row.error">{{ row.error }}</div></template>
          <template #cell-brandId="{ row }"><span class="row gap-2"><BrandAvatar :brand="brandOrStub(row.brandId)" :size="18" /><span class="small ellipsis" :title="brandName(row.brandId)">{{ brandName(row.brandId) }}</span></span></template>
          <template #cell-actor="{ row }"><ActorChip :actor="row.actor" /></template>
          <template #cell-status="{ row }"><StatusChip size="sm" of="run" :status="row.status" /></template>
          <template #cell-startedAt="{ row }"><span class="small" :title="fmtWhen(row.startedAt)">{{ ago(row.startedAt) }}</span></template>
          <template #cell-dur="{ row }"><span class="small num muted">{{ row.endedAt ? duration(new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime()) : '…' }}</span></template>
          <template #empty><EmptyState icon="play" title="No runs yet" body="Flows, recipes and posts that run show up here with their log and screenshots." /></template>
        </DataTable>
      </template>
    </div>

    <RunBrandModal :open="!!runTarget" :title="runTarget?.kind === 'flow' ? `Run “${runTarget.flow.name}”` : `Run “${runTarget?.recipe.name ?? ''}”`"
      :multi="runTarget?.kind === 'flow' && runTarget.flow.brandScope !== 'one'" :limit-to="runTarget?.kind === 'flow' && runTarget.flow.brandScope !== 'any' ? runTarget.flow.brandIds : null"
      :busy="running" @update:open="v => !v && (runTarget = null)" @confirm="confirmRun" />
  </div>
</template>

<style scoped>
.tabbody { padding-top: var(--s5); }
/* the title column takes what is left and truncates instead of widening the table */
.flows :deep(td.c-fill) { max-width: 0; }
.narrow-only { display: none; }
.lrchip { vertical-align: middle; }
/* small windows: the secondary columns fold away (last run moves under the flow name) */
@media (max-width: 1180px) {
  .flows :deep(.c-wide) { display: none; }
  .narrow-only { display: inline; }
  /* brands shrink to their avatars (names in the tooltip), the schedule column narrows */
  .wide-only { display: none; }
  .flows :deep(th.c-brands) { width: 104px !important; }
  .flows :deep(th.c-sched) { width: 176px !important; }
}
/* brand marks: at most 3 then a "+N" chip, side by side — at 20px any overlap clips the initials */
.avs { display: inline-flex; flex: none; }
.av { display: inline-grid; border-radius: 5px; box-shadow: 0 0 0 2px var(--bg); }
.av + .av { margin-left: 3px; }
.av.more { place-items: center; min-width: 20px; height: 20px; padding: 0 4px; background: var(--panel-2); color: var(--fg-2); font-size: var(--fs-2xs); font-weight: 600; }
.ib { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); }
.ib:hover { background: var(--panel-2); color: var(--fg); }
.intro { max-width: 640px; margin-bottom: var(--s5); }
/* at most four cards a row: a fifth column is too narrow for "Runs from a post" beside its button */
.rgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(max(260px, calc((100% - 36px) / 4)), 1fr)); gap: 12px; }
.recipe { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); }
.ric { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--panel-2); flex: none; }
.desc { flex: 1; line-height: 1.45; text-wrap: pretty; }
.strongish { font-weight: 500; }
.bad { color: var(--bad); }
.warnt { color: var(--warn); }
.rhead { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rfoot { gap: 10px; flex-wrap: nowrap; }
.rlbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* menus in the last rows must not be clipped by the table's scroll box (columns fold before it could overflow) */
.flows :deep(.ff-table) { overflow: visible; }
/* no column headings over an empty state */
.flows :deep(.ff-table.is-empty thead) { display: none; }
.mt-1 { margin-top: 2px; }
</style>
