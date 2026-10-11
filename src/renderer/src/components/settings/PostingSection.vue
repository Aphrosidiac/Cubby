<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AgeTier, PacingRule, Platform } from '@shared/types';
import { AGE_TIERS } from '@shared/types';
import { PLATFORM_SPECS, defaultPacingRules } from '@shared/platforms';
import Toggle from '@/components/ui/Toggle.vue';
import Segmented from '@/components/ui/Segmented.vue';
import Btn from '@/components/ui/Btn.vue';
import SaveBar from '@/components/common/SaveBar.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import LoadError from '@/components/common/LoadError.vue';
import { useSection } from './useSection';
import { TIER_LABEL } from '@/components/common/login';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail, ok } from '@/composables/toast';

/** Approval default, quiet hours, catch-up, and the pacing table (platform × account age). */
const { form, dirty, busy, save, discard } = useSection(['approvalDefault', 'quietHours', 'catchUp']);

const rules = useLoad(() => api('pacing.rules'));
const edit = ref<PacingRule[]>([]);
const base = ref('[]');
watch(() => rules.data.value, r => { if (r) { edit.value = JSON.parse(JSON.stringify(r)); base.value = JSON.stringify(r); } }, { immediate: true });
const rulesDirty = computed(() => JSON.stringify(edit.value) !== base.value);
const platforms = computed(() => [...new Set(edit.value.map(r => r.platform))] as Platform[]);
const cell = (p: Platform, t: AgeTier) => edit.value.find(r => r.platform === p && r.ageTier === t);
const bad = computed(() => edit.value.some(r => !(r.minGapMin >= 0) || !(r.dailyMax >= 1) || !(r.jitterMin >= 0)));
const savingRules = ref(false);
async function saveAll() {
  if (dirty.value) await save('Posting settings saved');
  if (rulesDirty.value && !bad.value) {
    savingRules.value = true;
    try {
      const r = await api('pacing.setRules', { rules: edit.value.map(x => ({ ...x, minGapMin: Number(x.minGapMin), dailyMax: Math.round(Number(x.dailyMax)), jitterMin: Number(x.jitterMin) })) });
      edit.value = JSON.parse(JSON.stringify(r)); base.value = JSON.stringify(r);
      ok('Pacing rules saved');
    } catch (e) { fail(e, 'Could not save pacing rules'); } finally { savingRules.value = false; }
  }
}
function discardAll() { discard(); edit.value = JSON.parse(base.value); }
async function reset() {
  if (!(await confirm({ title: 'Reset pacing to the defaults?', body: 'New accounts: 60 min apart, 3 a day. Warm: 40 min, 6 a day. Established: 20 min, 10 a day. ±10 min jitter. You still need to save.', confirm: 'Reset' }))) return;
  edit.value = defaultPacingRules();
}
</script>

<template>
  <div class="set-sec">
    <div class="set-row">
      <div class="set-l"><span class="t">Approval</span><span class="d">The default for new brands. Each brand can change it in its settings.</span></div>
      <div class="set-c"><Toggle v-model="form.approvalDefault" label="New brands need my approval before posting" hint="Prepared posts wait in Approvals with a screenshot of the filled composer." /></div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Quiet hours</span><span class="d">Nothing is published in this window; due posts wait until it ends.</span></div>
      <div class="set-c">
        <Toggle v-model="form.quietHours.enabled" label="Hold posts during quiet hours" />
        <div v-if="form.quietHours.enabled" class="set-pair"><span class="small muted">From</span><input v-model="form.quietHours.start" type="time" class="input t" /><span class="small muted">to</span><input v-model="form.quietHours.end" type="time" class="input t" /></div>
      </div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Missed posts</span><span class="d">When the computer was asleep or off at post time.</span></div>
      <div class="set-c">
        <Segmented v-model="form.catchUp" size="sm" :options="[{ value: 'run', label: 'Post them when I’m back' }, { value: 'skip', label: 'Skip them' }]" />
        <span class="set-note">{{ form.catchUp === 'run' ? 'Missed posts run on wake, re-paced per account so they don’t all go at once.' : 'Missed posts are marked failed and left for you to reschedule.' }}</span>
      </div>
    </div>
    <div class="set-row wide">
      <div class="set-l"><span class="t">Pacing</span><span class="d">Per account, by platform and account age: the minimum gap between posts, the most per day, and random jitter so posts never land on a fixed beat.</span></div>
      <div class="set-c">
        <LoadError v-if="rules.error.value" compact :error="rules.error.value" title="Could not load pacing rules" @retry="rules.reload()" />
        <div v-else-if="rules.loading.value" class="skel-line" style="width: 60%" />
        <div v-else class="pt-wrap">
          <table class="pt">
            <thead>
              <tr><th rowspan="2">Platform</th><th v-for="t in AGE_TIERS" :key="t" colspan="3" class="tier">{{ TIER_LABEL[t] }}</th></tr>
              <tr><template v-for="t in AGE_TIERS" :key="t"><th class="sub">Gap</th><th class="sub">Max/day</th><th class="sub">± jitter</th></template></tr>
            </thead>
            <tbody>
              <tr v-for="p in platforms" :key="p">
                <td class="pn"><PlatformIcon :platform="p" :size="15" colored /><span>{{ PLATFORM_SPECS[p].name }}</span></td>
                <template v-for="t in AGE_TIERS" :key="t">
                  <template v-if="cell(p, t)">
                    <td><label class="ni"><input v-model.number="cell(p, t)!.minGapMin" type="number" min="0" class="num" :aria-label="`${PLATFORM_SPECS[p].name} ${t} gap minutes`" /><span>m</span></label></td>
                    <td><label class="ni"><input v-model.number="cell(p, t)!.dailyMax" type="number" min="1" class="num" :aria-label="`${PLATFORM_SPECS[p].name} ${t} daily max`" /></label></td>
                    <td class="tg"><label class="ni"><input v-model.number="cell(p, t)!.jitterMin" type="number" min="0" class="num" :aria-label="`${PLATFORM_SPECS[p].name} ${t} jitter minutes`" /><span>m</span></label></td>
                  </template>
                  <template v-else><td /><td /><td class="tg" /></template>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="set-pair"><Btn size="sm" variant="subtle" icon="undo" @click="reset">Reset to defaults</Btn><span v-if="bad" class="tiny bad">Gaps and jitter must be 0 or more, max per day at least 1.</span></div>
      </div>
    </div>
    <SaveBar :show="dirty || rulesDirty" :busy="busy || savingRules" :disabled="bad" @save="saveAll" @discard="discardAll" />
  </div>
</template>

<style scoped>
.t { width: 120px; }
.wide { grid-template-columns: 200px minmax(0, 1fr); }
@media (max-width: 1100px) { .wide { grid-template-columns: minmax(0, 1fr); } }
.pt-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); }
.pt { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--fs-sm); }
.pt th { font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); padding: 8px 6px; text-align: center; white-space: nowrap; border-bottom: 1px solid var(--line-soft); }
.pt th:first-child { text-align: left; padding-left: 14px; }
.pt th.tier { color: var(--fg); border-left: 1px solid var(--line-soft); }
.pt th.sub { font-size: 10px; letter-spacing: .02em; }
.pt tr th.sub:nth-child(3n + 1) { border-left: 1px solid var(--line-soft); }
.pt td { padding: 4px 4px; border-top: 1px solid var(--line-soft); text-align: center; }
.pt tbody tr:first-child td { border-top: 0; }
.pt td:nth-child(3n + 2) { border-left: 1px solid var(--line-soft); }
.pn { display: flex; align-items: center; gap: 8px; padding-left: 14px !important; white-space: nowrap; text-align: left !important; font-weight: 500; height: 40px; }
.ni { display: inline-flex; align-items: center; gap: 2px; color: var(--muted); font-size: var(--fs-xs); }
.ni input { width: 46px; height: 28px; padding: 0 6px; text-align: right; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--fg); font-size: var(--fs-sm); }
.ni input::-webkit-inner-spin-button, .ni input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.ni input:hover { border-color: var(--line); }
.ni input:focus { border-color: var(--focus-border); background: var(--bg); outline: none; box-shadow: var(--focus-ring); }
.bad { color: var(--bad); }
</style>
