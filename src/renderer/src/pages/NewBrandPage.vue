<script setup lang="ts">
// New brand wizard (PLAN 6.2): identity → platforms → browser → review → create → "Open and log in".
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { BrandRow, ChromeProfileInfo, Platform } from '@shared/types';
import { PLATFORMS } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import Select from '@/components/ui/Select.vue';
import Segmented from '@/components/ui/Segmented.vue';
import Stepper from '@/components/ui/Stepper.vue';
import Toggle from '@/components/ui/Toggle.vue';
import Icon from '@/components/ui/Icon.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import ColorPicker from '@/components/brands/ColorPicker.vue';
import LogoPicker from '@/components/brands/LogoPicker.vue';
import GroupSelect from '@/components/brands/GroupSelect.vue';
import TagInput from '@/components/brands/TagInput.vue';
import AccountFields from '@/components/brands/AccountFields.vue';
import { cleanHandle, draftToInput, newDraft, type AccountDraft } from '@/components/brands/draft';
import { downloadCsvTemplate, pickCsvAndCreate } from '@/components/brands/importers';
import { loginUrls, normalizeUrl, useBrandActions } from '@/components/brands/actions';
import { handleText, serialText, TIER_LABEL } from '@/components/common/login';
import { api, modKey } from '@/lib/api';
import { app } from '@/lib/store';
import { useLoad } from '@/composables/useLoad';
import { fail } from '@/composables/toast';

const router = useRouter();
const act = useBrandActions();
type Step = 'identity' | 'platforms' | 'browser' | 'review';
const STEPS: { key: Step; label: string }[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'platforms', label: 'Platforms' },
  { key: 'browser', label: 'Browser' },
  { key: 'review', label: 'Review' }
];
const step = ref<Step>('identity');
const idx = computed(() => STEPS.findIndex(s => s.key === step.value));
const reached = ref(0);
watch(idx, i => {
  reached.value = Math.max(reached.value, i);
  // a new step starts at its top: if the stepper scrolled away (long platforms list), bring it back
  void nextTick(() => {
    const s = document.querySelector<HTMLElement>('.nb .stepper-wrap');
    if (s && s.getBoundingClientRect().top < 64) s.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
});

const PALETTE = ['#0b0b0a', '#2c4f9c', '#1d6b45', '#a3261d', '#8a5a00', '#6b3fa0', '#0f766e', '#be185d', '#475569', '#b45309'];
const PRESETS = [{ value: '1280x900', label: '1280 × 900' }, { value: '1440x900', label: '1440 × 900' }, { value: '1920x1080', label: '1920 × 1080' }, { value: 'custom', label: 'Custom' }];
const dw = app.settings?.defaultWindow ?? { width: 1280, height: 900 };
const fresh = () => ({
  name: '', logo: null as string | null, color: PALETTE[Math.floor(Math.random() * PALETTE.length)], groupId: null as string | null, tags: [] as string[], notes: '',
  accounts: [] as AccountDraft[],
  startupUrls: [] as string[], urlsTouched: false,
  preset: PRESETS.some(p => p.value === `${dw.width}x${dw.height}`) ? `${dw.width}x${dw.height}` : 'custom', width: dw.width, height: dw.height,
  approvalRequired: app.settings?.approvalDefault ?? true,
  importOn: false, importFrom: null as string | null
});
const form = reactive(fresh());
watch(() => form.preset, p => { if (p !== 'custom') { const [w, h] = p.split('x').map(Number); form.width = w; form.height = h; } });

const tags = useLoad(() => api('tags.list'));
const groups = useLoad(() => api('groups.list'), { topics: ['brands.changed'] });
const groupLabel = computed(() => (form.groupId ? groups.data.value?.find(g => g.id === form.groupId)?.name ?? '—' : 'No group'));
const nameInput = ref<HTMLInputElement | null>(null);
/** Focus the name field and make sure it is really in view (on a 620px-high window it starts under the sticky footer). */
function focusName() {
  const el = nameInput.value;
  if (!el) return;
  el.focus({ preventScroll: true });
  const r = el.getBoundingClientRect();
  // scroll only when the sticky footer (or the top bar) really covers it, so the page header stays in view
  const footTop = document.querySelector('.foot')?.getBoundingClientRect().top ?? window.innerHeight;
  if (r.bottom > footTop - 8 || r.top < 64) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
onMounted(() => setTimeout(focusName, 250));

// ── platforms ──
const used = computed(() => new Set(form.accounts.map(a => a.platform)));
function addPlatform(p: Platform) { form.accounts.push(newDraft(p)); void nextTick(() => document.querySelector<HTMLInputElement>(`#acc-${form.accounts[form.accounts.length - 1].key} .f-handle input`)?.focus()); }
function removeAt(i: number) { form.accounts.splice(i, 1); }
const QUICK = PLATFORMS.filter(p => p !== 'custom');

// startup URLs follow the chosen platforms until edited by hand
const homeUrls = computed(() => [...new Set(form.accounts.map(a => (a.platform === 'custom' ? (cleanHandle('custom', a.handle) ? normalizeUrl(cleanHandle('custom', a.handle)) : '') : PLATFORM_SPECS[a.platform]?.home)).filter(u => u && u !== 'about:blank'))]);
watch(homeUrls, u => { if (!form.urlsTouched) form.startupUrls = [...u]; }, { immediate: true });
function setUrl(i: number, v: string) { form.urlsTouched = true; form.startupUrls[i] = v; }
function addUrl() { form.urlsTouched = true; form.startupUrls.push(''); void nextTick(() => document.querySelector<HTMLInputElement>('.urls li:last-child input')?.focus()); }
function removeUrl(i: number) { form.urlsTouched = true; form.startupUrls.splice(i, 1); }
function resetUrls() { form.urlsTouched = false; form.startupUrls = [...homeUrls.value]; }

// existing Chrome profiles (read-only listing)
const profiles = ref<ChromeProfileInfo[] | null>(null);
const profilesErr = ref<string | null>(null);
watch(() => form.importOn, async on => {
  if (!on || profiles.value) return;
  try { profiles.value = await api('brands.chromeProfiles'); } catch (e) { profilesErr.value = (e as Error).message; profiles.value = []; }
});
const profileOpts = computed(() => (profiles.value ?? []).map(p => ({ value: p.path, label: p.name, sub: p.email ?? p.dir })));

// ── validation ──
const errors = computed(() => {
  const e: Record<string, string> = {};
  if (!form.name.trim()) e.name = 'Give the brand a name';
  form.accounts.forEach(a => { if (!cleanHandle(a.platform, a.handle)) e[`acc-${a.key}`] = a.platform === 'custom' ? 'Enter the site address' : 'Enter the handle'; });
  if (form.width < 400 || form.height < 300) e.window = 'At least 400 × 300';
  if (form.importOn && !form.importFrom) e.import = 'Choose a Chrome profile, or turn this off';
  return e;
});
const stepErrors = (s: Step) => Object.keys(errors.value).filter(k => (s === 'identity' ? k === 'name' : s === 'platforms' ? k.startsWith('acc-') : s === 'browser' ? ['window', 'import'].includes(k) : false));
const tried = ref(new Set<Step>());
function next() {
  if (stepErrors(step.value).length) { tried.value = new Set([...tried.value, step.value]); return; }
  if (idx.value < STEPS.length - 1) step.value = STEPS[idx.value + 1].key;
}
function back() { if (idx.value > 0) step.value = STEPS[idx.value - 1].key; }
function pick(k: string) { const i = STEPS.findIndex(s => s.key === k); if (i <= reached.value || STEPS.slice(0, i).every(s => !stepErrors(s.key).length)) step.value = k as Step; }
const show = (k: string, s: Step) => (tried.value.has(s) ? errors.value[k] ?? null : null);

// ── create ──
const creating = ref(false);
const created = ref<BrandRow | null>(null);
const groupName = ref<string | null>(null);
async function create() {
  for (const s of STEPS) if (stepErrors(s.key).length) { step.value = s.key; tried.value = new Set([...tried.value, s.key]); return; }
  creating.value = true;
  try {
    created.value = await api('brands.create', {
      name: form.name.trim(), logo: form.logo, color: form.color, groupId: form.groupId, tags: form.tags, notes: form.notes.trim(),
      accounts: form.accounts.map(draftToInput),
      startupUrls: form.startupUrls.map(normalizeUrl).filter(Boolean),
      window: { width: form.width, height: form.height },
      approvalRequired: form.approvalRequired,
      importFromChromeProfile: form.importOn && form.importFrom ? form.importFrom : undefined
    });
    groupName.value = created.value.groupName;
    window.scrollTo({ top: 0 });
  } catch (e) { fail(e, 'Could not create the brand'); } finally { creating.value = false; }
}
async function openAndLogin() {
  const b = created.value;
  if (!b) return;
  const urls = loginUrls(b);
  if (await act.open(b, urls.length ? urls : undefined)) void router.push(`/brands/${b.id}?tab=accounts`);
}
function another() {
  Object.assign(form, fresh());
  created.value = null; step.value = 'identity'; reached.value = 0; tried.value = new Set();
  setTimeout(focusName, 300);
}
async function csv() { const n = await pickCsvAndCreate(); if (n) void router.push('/'); }

// Ctrl/⌘+Enter anywhere on the page (focus often lands on <body> after a step swaps its buttons),
// but not while a dialog or dropdown has the keyboard
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || created.value || creating.value) return;
  if (document.querySelector('.modal-root, .ff-select-pop, .cp-root')) return;
  e.preventDefault();
  if (step.value === 'review') void create(); else next();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
const winPreview = computed(() => { const s = 120 / Math.max(form.width, form.height); return { width: `${Math.round(form.width * s)}px`, height: `${Math.round(form.height * s)}px` }; });
</script>

<template>
  <div class="page nb">
    <PageHeader eyebrow="New brand" :title="created ? 'Brand created' : 'New brand'" :back="{ to: '/', label: 'Brands' }">
      <span v-if="!created">Its own sealed Chrome profile: logins, cookies and extensions stay inside this brand.</span>
      <template v-if="!created" #actions>
        <Btn size="sm" variant="subtle" icon="download" @click="downloadCsvTemplate">CSV template</Btn>
        <Btn size="sm" icon="file" @click="csv">Batch create from CSV…</Btn>
      </template>
    </PageHeader>

    <!-- ── success ── -->
    <section v-if="created" class="done panel">
      <div class="done-head">
        <BrandAvatar :brand="created" :size="64" />
        <div class="grow">
          <div class="label">{{ serialText(created.serial) }}{{ groupName ? ` · ${groupName}` : '' }}</div>
          <h2 class="h1 bname">{{ created.name }}</h2>
          <p class="muted mt-2">Profile folder made. Next: open its Chrome and log in to each platform once — the logins stay in this brand from then on.</p>
        </div>
      </div>
      <ul v-if="created.accounts.length" class="done-accts">
        <li v-for="a in created.accounts" :key="a.id"><PlatformIcon :platform="a.platform" :size="16" colored /><span class="strong">{{ PLATFORM_SPECS[a.platform].name }}</span><span class="muted">{{ handleText(a.platform, a.handle) }}</span><span class="grow" /><span class="tiny muted">{{ TIER_LABEL[a.ageTier] }}</span></li>
      </ul>
      <div class="done-acts">
        <Btn variant="signal" size="lg" icon="key" :loading="act.pending.has(created.id)" @click="openAndLogin">{{ created.accounts.length ? 'Open and log in' : 'Open brand' }}</Btn>
        <Btn size="lg" icon-right="arrow" :to="`/brands/${created.id}`">Go to brand</Btn>
        <Btn variant="subtle" icon="plus" @click="another">Create another</Btn>
      </div>
      <p v-if="created.accounts.length" class="tiny muted">Opens {{ loginUrls(created).length === 1 ? 'the login page' : `${loginUrls(created).length} login pages` }} in {{ created.name }}’s window. Saved logins can be typed in for you from the Accounts tab (Fill login).</p>
    </section>

    <template v-else>
      <div class="stepper-wrap"><Stepper :stages="STEPS" :current="step" interactive @pick="pick" /></div>

      <div class="body">
        <Transition name="swap" mode="out-in">
          <!-- 1 · identity -->
          <section v-if="step === 'identity'" key="identity" class="panel pad col gap-5">
            <div class="section-h"><h2 class="h2">Identity</h2><p class="small muted">How the brand shows in Cubby and in its Chrome window.</p></div>
            <Field label="Name" required :error="show('name', 'identity')">
              <input ref="nameInput" v-model="form.name" class="input big" maxlength="80" placeholder="FF Dev Studio" @keydown.enter.prevent="next" />
            </Field>
            <Field label="Logo"><LogoPicker v-model="form.logo" :name="form.name" :color="form.color" /></Field>
            <Field label="Colour" hint="Tints the brand’s Chrome window and its tile here, so you can tell windows apart."><ColorPicker v-model="form.color" /></Field>
            <div class="grid-2">
              <Field label="Group"><GroupSelect v-model="form.groupId" /></Field>
              <Field label="Tags" hint="Enter or comma after each."><TagInput v-model="form.tags" :suggestions="(tags.data.value ?? []).map(t => t.name)" /></Field>
            </div>
            <Field label="Notes"><textarea v-model="form.notes" v-autosize class="textarea" rows="2" placeholder="Who it’s for, what it posts, anything to remember" /></Field>
          </section>

          <!-- 2 · platforms -->
          <section v-else-if="step === 'platforms'" key="platforms" class="col gap-4">
            <div class="panel pad col gap-4">
              <div class="section-h"><h2 class="h2">Platforms</h2><p class="small muted">The accounts this brand posts to. Add as many as it has — you can add more later.</p></div>
              <div class="quick">
                <button v-for="p in QUICK" :key="p" type="button" class="qp" :class="{ has: used.has(p) }" @click="addPlatform(p)">
                  <PlatformIcon :platform="p" :size="18" colored /><span>{{ PLATFORM_SPECS[p].name }}</span><Icon v-if="used.has(p)" name="check" :size="13" class="tick" />
                </button>
                <button type="button" class="qp" :class="{ has: used.has('custom') }" @click="addPlatform('custom')"><PlatformIcon platform="custom" :size="18" /><span>{{ PLATFORM_SPECS.custom.name }} site</span><Icon v-if="used.has('custom')" name="check" :size="13" class="tick" /></button>
              </div>
            </div>
            <TransitionGroup name="list" tag="div" class="col gap-4">
              <div v-for="(a, i) in form.accounts" :id="`acc-${a.key}`" :key="a.key" class="panel pad acc">
                <div class="acc-head">
                  <span class="label">Account {{ i + 1 }}</span>
                  <button type="button" class="rm" :aria-label="`Remove ${PLATFORM_SPECS[a.platform].name} account`" @click="removeAt(i)"><Icon name="trash" :size="14" /><span>Remove</span></button>
                </div>
                <AccountFields :draft="a" />
                <p v-if="show(`acc-${a.key}`, 'platforms')" class="tiny err">{{ show(`acc-${a.key}`, 'platforms') }}</p>
              </div>
            </TransitionGroup>
            <p v-if="!form.accounts.length" class="small muted none">No platforms yet — pick one above, or skip this step and add accounts later.</p>
          </section>

          <!-- 3 · browser -->
          <section v-else-if="step === 'browser'" key="browser" class="panel pad col gap-5">
            <div class="section-h"><h2 class="h2">Browser</h2><p class="small muted">How this brand’s Chrome window starts.</p></div>
            <Field label="Startup pages" :hint="form.urlsTouched ? undefined : 'Filled from the platforms you chose.'">
              <ul class="urls">
                <li v-for="(u, i) in form.startupUrls" :key="i">
                  <Icon name="globe" :size="14" class="faint" />
                  <input class="input" :value="u" placeholder="https://" spellcheck="false" @input="setUrl(i, ($event.target as HTMLInputElement).value)" @blur="setUrl(i, normalizeUrl(u))" />
                  <button type="button" class="mini" aria-label="Remove page" @click="removeUrl(i)"><Icon name="close" :size="13" /></button>
                </li>
              </ul>
              <div class="row gap-2 mt-2">
                <Btn size="sm" icon="plus" @click="addUrl">Add page</Btn>
                <Btn v-if="form.urlsTouched && homeUrls.length" size="sm" variant="subtle" icon="undo" @click="resetUrls">Use platform home pages</Btn>
              </div>
            </Field>
            <Field label="Window size" :error="show('window', 'browser')">
              <div class="win">
                <div class="col gap-3">
                  <Segmented v-model="form.preset" size="sm" :options="PRESETS" />
                  <div v-if="form.preset === 'custom'" class="row gap-2">
                    <input v-model.number="form.width" type="number" min="400" class="input num w" aria-label="Width" /><span class="muted">×</span><input v-model.number="form.height" type="number" min="300" class="input num w" aria-label="Height" />
                  </div>
                </div>
                <div class="winbox"><span class="wp" :style="{ ...winPreview, borderTopColor: form.color }" /></div>
              </div>
            </Field>
            <Toggle v-model="form.approvalRequired" label="Posts need my approval" hint="Prepared posts wait in Approvals with a screenshot before anything is published. Recommended." />
            <div class="imp">
              <Toggle v-model="form.importOn" label="Start from an existing Chrome profile" hint="Copies that profile’s logins and cookies on this computer into the new brand. Close Google Chrome first. Your own profile is only read, never changed." />
              <Transition name="slide-down">
                <div v-if="form.importOn">
                  <div class="pt">
                    <Field label="Chrome profile" :error="show('import', 'browser') ?? profilesErr">
                      <Select v-model="form.importFrom" :options="profileOpts" :placeholder="profiles === null ? 'Looking for Chrome profiles…' : profiles.length ? 'Choose a profile' : 'No Chrome profiles found'" :disabled="!profiles?.length" />
                    </Field>
                  </div>
                </div>
              </Transition>
            </div>
          </section>

          <!-- 4 · review -->
          <section v-else key="review" class="panel pad col gap-5">
            <div class="row gap-4">
              <BrandAvatar :brand="{ name: form.name, color: form.color, logo: form.logo }" :size="56" />
              <div class="grow"><h2 class="h1">{{ form.name }}</h2><p v-if="form.notes" class="small muted mt-2">{{ form.notes }}</p></div>
            </div>
            <dl class="facts">
              <dt>Group</dt><dd>{{ groupLabel }}</dd>
              <dt>Tags</dt><dd>{{ form.tags.length ? form.tags.join(', ') : '—' }}</dd>
              <dt>Platforms</dt>
              <dd>
                <div v-if="form.accounts.length" class="rv-acc">
                  <span v-for="a in form.accounts" :key="a.key" class="rv-a"><PlatformIcon :platform="a.platform" :size="14" colored />{{ handleText(a.platform, cleanHandle(a.platform, a.handle)) }}<span class="muted">· {{ TIER_LABEL[a.ageTier] }}{{ a.saveLogin && (a.username || a.password) ? ' · login saved' : '' }}{{ a.saveLogin && a.totpSecret ? ' · 2FA' : '' }}</span></span>
                </div>
                <span v-else>None yet</span>
              </dd>
              <dt>Startup pages</dt><dd>{{ form.startupUrls.filter(Boolean).length ? form.startupUrls.filter(Boolean).join(', ') : 'New tab' }}</dd>
              <dt>Window</dt><dd class="num">{{ form.width }} × {{ form.height }}</dd>
              <dt>Approval</dt><dd>{{ form.approvalRequired ? 'Posts wait for my approval' : 'Posts publish without approval' }}</dd>
              <dt>Start from</dt><dd>{{ form.importOn && form.importFrom ? profiles?.find(p => p.path === form.importFrom)?.name ?? form.importFrom : 'A fresh, empty profile' }}</dd>
            </dl>
          </section>
        </Transition>
      </div>

      <footer class="foot">
        <Btn v-if="idx > 0" variant="subtle" icon="arrow-left" @click="back">Back</Btn>
        <span class="grow" />
        <span class="tiny muted keys nowrap">{{ step === 'review' ? `${modKey}+Enter creates` : `${modKey}+Enter for next` }}</span>
        <Btn v-if="step === 'platforms' && !form.accounts.length" variant="ghost" @click="next">Skip for now</Btn>
        <Btn v-if="step !== 'review'" variant="primary" icon-right="arrow" :disabled="step === 'platforms' && !form.accounts.length" @click="next">Next</Btn>
        <Btn v-else variant="signal" icon="check" :loading="creating" @click="create">Create brand</Btn>
      </footer>
    </template>
  </div>
</template>

<style>
/* Tab / focus scrolling clears the sticky top bar and the sticky wizard footer */
html:has(.page.nb) { scroll-padding: 72px 0 96px; }
</style>

<style scoped>
.nb { max-width: 860px; margin: 0 auto; }
.nb .h1 { overflow-wrap: anywhere; }
.stepper-wrap { max-width: 560px; margin: 0 auto 28px; }
.section-h { display: flex; flex-direction: column; gap: 4px; padding-bottom: 4px; }
.input.big { font-size: var(--fs-lg); min-height: 48px; }
.quick { display: flex; flex-wrap: wrap; gap: 8px; }
.qp { position: relative; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 12px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); font-weight: 500; transition: border-color 160ms, transform 240ms var(--ease-out); }
.qp:hover { border-color: var(--fg); transform: translateY(-1px); }
.qp.has { border-color: var(--line-strong); background: var(--panel-2); }
.tick { color: var(--good); }
.acc-head { display: flex; align-items: center; justify-content: space-between; margin: -4px 0 14px; }
.rm { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 99px; color: var(--muted); font-size: var(--fs-sm); }
.rm:hover { color: var(--bad); background: var(--bad-bg); }
.err { color: var(--bad); margin-top: 10px; }
.none { text-align: center; padding: 18px; border: 1px dashed var(--line); border-radius: var(--r-lg); }
.urls { display: flex; flex-direction: column; gap: 6px; }
.urls li { display: flex; align-items: center; gap: 8px; }
.mini { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 8px; color: var(--muted); }
.mini:hover { background: var(--panel-2); color: var(--fg); }
.win { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.w { width: 96px; }
.winbox { width: 140px; height: 110px; display: grid; place-items: center; border: 1px dashed var(--line); border-radius: var(--r-lg); }
.wp { display: block; border: 1px solid var(--line-strong); border-top-width: 5px; border-radius: 4px; background: var(--panel); transition: width 420ms var(--ease-out), height 420ms var(--ease-out); }
.imp { padding-top: 16px; border-top: 1px solid var(--line-soft); }
.pt { padding: 14px 0 0 50px; max-width: 480px; }
.rv-acc { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.rv-a { display: inline-flex; align-items: center; gap: 7px; }
.foot { position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; gap: 10px; margin-top: 20px; padding: 14px 0 18px; background: var(--bg); box-shadow: 0 -1px 0 var(--line-soft); }
.done { padding: 32px; display: flex; flex-direction: column; gap: 22px; }
.done-head { display: flex; gap: 20px; align-items: center; }
.done-accts { display: flex; flex-direction: column; border-top: 1px solid var(--line-soft); }
.done-accts li { display: flex; align-items: center; gap: 10px; padding: 11px 2px; border-bottom: 1px solid var(--line-soft); }
.done-acts { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
</style>
