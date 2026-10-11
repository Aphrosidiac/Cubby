<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { BrandRow } from '@shared/types';
import Field from '@/components/ui/Field.vue';
import Toggle from '@/components/ui/Toggle.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Segmented from '@/components/ui/Segmented.vue';
import SaveBar from '@/components/common/SaveBar.vue';
import LogoPicker from '../LogoPicker.vue';
import ColorPicker from '../ColorPicker.vue';
import GroupSelect from '../GroupSelect.vue';
import TagInput from '../TagInput.vue';
import { normalizeUrl } from '../actions';
import { api } from '@/lib/api';
import { app } from '@/lib/store';
import { useLoad } from '@/composables/useLoad';
import { fail, ok } from '@/composables/toast';

/** Every brand field on one page with a save bar: identity, startup pages, window, downloads, Chrome install, approval. */
const props = defineProps<{ brand: BrandRow }>();
const tags = useLoad(() => api('tags.list'));
const snap = (b: BrandRow) => ({
  name: b.name, logo: b.logo, color: b.color, groupId: b.groupId, tags: [...b.tags], notes: b.notes,
  startupUrls: [...b.startupUrls], width: b.window.width, height: b.window.height, x: b.window.x ?? null as number | null, y: b.window.y ?? null as number | null,
  downloadsDir: b.downloadsDir, chromePath: b.chromePath, approvalRequired: b.approvalRequired
});
type Form = ReturnType<typeof snap>;
const form = reactive<Form>(snap(props.brand));
const base = ref(JSON.stringify(snap(props.brand)));
const dirty = computed(() => JSON.stringify(form) !== base.value);
// a live update from elsewhere refreshes the form only when there is nothing unsaved
watch(() => props.brand, b => { if (!dirty.value) { Object.assign(form, snap(b)); base.value = JSON.stringify(snap(b)); } });

const PRESETS = [{ value: '1280x900', label: '1280 × 900' }, { value: '1440x900', label: '1440 × 900' }, { value: '1920x1080', label: '1920 × 1080' }, { value: 'custom', label: 'Custom' }];
const preset = computed({
  get: () => (PRESETS.some(p => p.value === `${form.width}x${form.height}`) ? `${form.width}x${form.height}` : 'custom'),
  set: v => { if (v !== 'custom') { const [w, h] = v.split('x').map(Number); form.width = w; form.height = h; } else customOpen.value = true; }
});
const customOpen = ref(false);
const positioned = computed({ get: () => form.x !== null && form.y !== null, set: v => { form.x = v ? 40 : null; form.y = v ? 40 : null; } });

async function pickDir() {
  try { const [p] = await api('app.pickFiles', { directory: true, defaultPath: form.downloadsDir ?? undefined }); if (p) form.downloadsDir = p; } catch (e) { fail(e); }
}
async function pickChrome() {
  try { const [p] = await api('app.pickFiles', { filters: app.status?.platform === 'win32' ? [{ name: 'Chrome', extensions: ['exe'] }] : undefined }); if (p) form.chromePath = p; } catch (e) { fail(e); }
}

const err = computed(() => (!form.name.trim() ? 'The brand needs a name' : form.width < 400 || form.height < 300 ? 'Window must be at least 400 × 300' : null));
const busy = ref(false);
async function save() {
  if (err.value || !dirty.value) return;
  busy.value = true;
  try {
    const win = { width: Math.round(form.width), height: Math.round(form.height), ...(form.x !== null && form.y !== null ? { x: Math.round(form.x), y: Math.round(form.y) } : {}) };
    const b = await api('brands.update', {
      id: props.brand.id,
      patch: { name: form.name.trim(), logo: form.logo, color: form.color, groupId: form.groupId, tags: form.tags, notes: form.notes, startupUrls: form.startupUrls.map(normalizeUrl).filter(Boolean), window: win, downloadsDir: form.downloadsDir, chromePath: form.chromePath, approvalRequired: form.approvalRequired }
    });
    Object.assign(form, snap(b));
    base.value = JSON.stringify(snap(b));
    ok('Brand saved', props.brand.status === 'open' ? 'Window and Chrome changes apply the next time it opens.' : undefined);
  } catch (e) { fail(e, 'Could not save'); } finally { busy.value = false; }
}
function discard() { Object.assign(form, JSON.parse(base.value)); }
const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); } };
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
const addUrl = () => form.startupUrls.push('');
</script>

<template>
  <form class="st" @submit.prevent="save">
    <section class="sec">
      <div class="sh"><h3 class="h3">Identity</h3><p class="tiny muted">Shown in Cubby and on the brand’s Chrome window.</p></div>
      <div class="col gap-4">
        <Field label="Name" required :error="!form.name.trim() ? 'The brand needs a name' : null"><input v-model="form.name" class="input" maxlength="80" /></Field>
        <Field label="Logo"><LogoPicker v-model="form.logo" :name="form.name" :color="form.color" /></Field>
        <Field label="Colour"><ColorPicker v-model="form.color" /></Field>
        <div class="grid-2">
          <Field label="Group"><GroupSelect v-model="form.groupId" /></Field>
          <Field label="Tags"><TagInput v-model="form.tags" :suggestions="(tags.data.value ?? []).map(t => t.name)" /></Field>
        </div>
        <Field label="Notes"><textarea v-model="form.notes" v-autosize class="textarea" rows="2" /></Field>
      </div>
    </section>

    <section class="sec">
      <div class="sh"><h3 class="h3">Startup pages</h3><p class="tiny muted">Opened in new tabs each time the brand opens. Empty = Chrome restores the last session.</p></div>
      <div>
        <ul class="urls">
          <li v-for="(u, i) in form.startupUrls" :key="i">
            <Icon name="globe" :size="14" class="faint" />
            <input v-model="form.startupUrls[i]" class="input" placeholder="https://" spellcheck="false" @blur="form.startupUrls[i] = normalizeUrl(u)" />
            <button type="button" class="mini" aria-label="Remove page" @click="form.startupUrls.splice(i, 1)"><Icon name="close" :size="13" /></button>
          </li>
        </ul>
        <Btn size="sm" icon="plus" class="mt-2" @click="addUrl">Add page</Btn>
      </div>
    </section>

    <section class="sec">
      <div class="sh"><h3 class="h3">Window</h3><p class="tiny muted">Size and position when the brand opens. Tile / Cascade on Brands rearranges open windows.</p></div>
      <div class="col gap-4">
        <Segmented v-model="preset" size="sm" :options="PRESETS" />
        <div v-if="preset === 'custom' || customOpen" class="row wrap gap-2">
          <label class="mini-f"><span class="tiny muted">Width</span><input v-model.number="form.width" type="number" min="400" class="input num" /></label>
          <label class="mini-f"><span class="tiny muted">Height</span><input v-model.number="form.height" type="number" min="300" class="input num" /></label>
        </div>
        <Toggle v-model="positioned" label="Open at a fixed position" hint="Otherwise Chrome decides where the window appears." />
        <div v-if="positioned" class="row wrap gap-2">
          <label class="mini-f"><span class="tiny muted">X</span><input v-model.number="form.x" type="number" class="input num" /></label>
          <label class="mini-f"><span class="tiny muted">Y</span><input v-model.number="form.y" type="number" class="input num" /></label>
        </div>
        <p v-if="err" class="tiny bad">{{ err }}</p>
      </div>
    </section>

    <section class="sec">
      <div class="sh"><h3 class="h3">Browser</h3><p class="tiny muted">Where downloads go and which Chrome runs this brand.</p></div>
      <div class="col gap-4">
        <Field label="Downloads folder" hint="Empty = Chrome’s default Downloads folder.">
          <div class="pick"><input :value="form.downloadsDir ?? ''" class="input" readonly placeholder="Chrome default" @click="pickDir" /><Btn size="sm" icon="folder" @click="pickDir">Choose…</Btn><Btn v-if="form.downloadsDir" size="sm" variant="subtle" @click="form.downloadsDir = null">Reset</Btn></div>
        </Field>
        <Field label="Chrome install" :hint="`Empty = the app-wide Chrome${app.status?.chrome ? ` (${app.status.chrome.version})` : ''}. Point at Chrome Beta or a portable Chrome to pin a version for this brand.`">
          <div class="pick"><input :value="form.chromePath ?? ''" class="input code" readonly :placeholder="app.status?.chrome?.path ?? 'Detected Chrome'" @click="pickChrome" /><Btn size="sm" icon="chrome" @click="pickChrome">Choose…</Btn><Btn v-if="form.chromePath" size="sm" variant="subtle" @click="form.chromePath = null">Reset</Btn></div>
        </Field>
      </div>
    </section>

    <section class="sec">
      <div class="sh"><h3 class="h3">Posting</h3><p class="tiny muted">Pacing per account follows its age tier (Accounts tab) and Settings → Posting.</p></div>
      <Toggle v-model="form.approvalRequired" label="Posts need my approval" hint="Prepared posts wait in Approvals with a screenshot before anything is published." />
    </section>

    <SaveBar :show="dirty" :busy="busy" :disabled="!!err" @save="save" @discard="discard" />
  </form>
</template>

<style scoped>
.st { max-width: 900px; }
.sec { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 28px; padding: 26px 0; border-top: 1px solid var(--line); }
.sec:first-child { border-top: 0; padding-top: 6px; }
.sh { display: flex; flex-direction: column; gap: 4px; }
@media (max-width: 1080px) { .sec { grid-template-columns: minmax(0, 1fr); gap: 14px; } }
.urls { display: flex; flex-direction: column; gap: 6px; }
.urls li { display: flex; align-items: center; gap: 8px; }
.mini { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 8px; color: var(--muted); }
.mini:hover { background: var(--panel-2); color: var(--fg); }
.mini-f { display: flex; flex-direction: column; gap: 4px; width: 110px; }
.pick { display: flex; gap: 8px; align-items: center; }
.pick .input { cursor: pointer; }
.bad { color: var(--bad); }
</style>
