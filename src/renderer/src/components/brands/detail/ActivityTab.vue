<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Activity, BrandRow } from '@shared/types';
import Btn from '@/components/ui/Btn.vue';
import Modal from '@/components/ui/Modal.vue';
import Select from '@/components/ui/Select.vue';
import Icon from '@/components/ui/Icon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import LoadError from '@/components/common/LoadError.vue';
import ActorChip from '@/components/activity/ActorChip.vue';
import { humanAction, detailLine } from '@/components/activity/humanize';
import { api, fileUrl } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { fail, toast } from '@/composables/toast';
import { ago, dateTime } from '@/lib/format';

/** Everything done in this brand, by anyone (you, Claude, the scheduler, flows, the API), with screenshots. */
const props = defineProps<{ brand: BrandRow }>();
const actor = ref<string | null>(null);
const limit = ref(100);
const list = useLoad(() => api('activity.list', { brandId: props.brand.id, actor: actor.value ?? undefined, limit: limit.value }), { topics: ['activity.new'], deps: [actor, limit] });
const shot = ref<Activity | null>(null);
const actors = [{ value: null, label: 'Everyone' }, { value: 'you', label: 'You' }, { value: 'claude', label: 'Claude' }, { value: 'scheduler', label: 'Scheduler' }, { value: 'flow', label: 'Flows' }, { value: 'api', label: 'Local API' }];
const rows = computed(() => list.data.value ?? []);
async function exportCsv() {
  try {
    const [path] = await api('app.pickFiles', { save: true, defaultPath: `${props.brand.slug}-activity.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!path) return;
    const r = await api('activity.exportCsv', { brandId: props.brand.id, actor: actor.value ?? undefined, path });
    toast(`Exported ${r.count} rows`, { tone: 'good', action: { label: 'Show file', run: () => void api('app.revealPath', { path: r.path }) } });
  } catch (e) { fail(e, 'Export failed'); }
}
const reveal = (p: string | null | undefined) => { if (p) api('app.revealPath', { path: p }).catch(e => fail(e)); };
</script>

<template>
  <div>
    <div class="bar">
      <Select v-model="actor" :options="actors" variant="pill" aria-label="Who" :min-width="160" />
      <span class="grow" />
      <Btn size="sm" variant="subtle" icon="download" @click="exportCsv">Export CSV</Btn>
    </div>
    <LoadError v-if="list.error.value" :error="list.error.value" title="Could not load activity" @retry="list.reload()" />
    <div v-else-if="list.loading.value" class="panel"><div v-for="i in 6" :key="i" class="ev"><div class="skel-line" :style="{ width: `${30 + (i % 3) * 15}%` }" /></div></div>
    <EmptyState v-else-if="!rows.length" icon="activity" title="Nothing here yet" body="Opening, posting, logins and every Claude action in this brand show up here." />
    <ol v-else class="panel">
      <li v-for="a in rows" :key="a.id" class="ev" :class="{ failed: humanAction(a).failed }">
        <span class="when tiny muted num" :title="dateTime(a.at)">{{ ago(a.at) }}</span>
        <ActorChip :actor="a.actor" />
        <div class="grow what">
          <div class="small"><span class="strong">{{ humanAction(a).text }}</span><span v-if="detailLine(a)" class="muted"> — {{ detailLine(a) }}</span></div>
        </div>
        <button v-if="a.screen" type="button" class="thumb" title="Screenshot" @click="shot = a"><img :src="fileUrl(a.screen)" alt="" loading="lazy" /></button>
        <span v-if="humanAction(a).guard" class="gi" title="A guardrail stepped in"><Icon name="shield" :size="15" /></span>
      </li>
      <li v-if="rows.length >= limit" class="more"><Btn size="sm" variant="subtle" @click="limit += 200">Show older</Btn></li>
    </ol>
    <Modal :open="!!shot" :title="shot ? humanAction(shot).text : ''" :eyebrow="shot ? dateTime(shot.at) : ''" size="xl" @update:open="v => !v && (shot = null)">
      <img v-if="shot?.screen" :src="fileUrl(shot.screen)" alt="Screenshot" class="full" />
      <template #footer><Btn size="sm" icon="folder" @click="reveal(shot?.screen)">Show in folder</Btn></template>
    </Modal>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.ev { display: flex; align-items: center; gap: 12px; padding: 10px 16px; min-height: 48px; }
.ev + .ev { border-top: 1px solid var(--line-soft); }
.when { width: 92px; flex: none; }
.what { min-width: 0; }
.what .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.failed .strong { color: var(--bad); }
.gi { color: var(--warn); display: grid; }
.thumb { width: 56px; height: 34px; border-radius: 4px; overflow: hidden; border: 1px solid var(--line); flex: none; background: var(--panel-2); }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.full { width: 100%; border-radius: 6px; border: 1px solid var(--line); }
.more { padding: 12px; text-align: center; border-top: 1px solid var(--line-soft); }
</style>
