<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ApiToken, TokenScope } from '@shared/types';
import { TOKEN_SCOPES } from '@shared/types';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import Modal from '@/components/ui/Modal.vue';
import Chip from '@/components/ui/Chip.vue';
import CopyField from '@/components/ui/CopyField.vue';
import Segmented from '@/components/ui/Segmented.vue';
import SaveBar from '@/components/common/SaveBar.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import LoadError from '@/components/common/LoadError.vue';
import { useSection } from './useSection';
import { api } from '@/lib/api';
import { app } from '@/lib/store';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail, ok } from '@/composables/toast';
import { ago, date } from '@/lib/format';

/** The Local API + MCP door on 127.0.0.1: port, URLs, and scoped tokens (shown once). */
const { form, dirty, busy, save, discard } = useSection(['apiPort']);
const portOk = computed(() => Number.isInteger(form.apiPort) && form.apiPort >= 1024 && form.apiPort <= 65535);
const SCOPE_HELP: Record<TokenScope, string> = {
  read: 'List brands, posts, media, flows and activity',
  brands: 'Create, edit, open and close brands',
  browser: 'Drive a brand’s tabs: navigate, click, type, screenshot',
  posting: 'Create and prepare posts (publishing still needs approval)',
  flows: 'Run flows and recipes',
  cdp: 'Raw Chrome DevTools endpoint for your own Playwright / Puppeteer scripts — never give this to Claude',
  mcp: 'Connect as an MCP client (Claude Code)'
};
const tokens = useLoad(() => api('tokens.list'));
const active = computed(() => (tokens.data.value ?? []).filter(t => !t.revokedAt));
const revoked = computed(() => (tokens.data.value ?? []).filter(t => t.revokedAt));
const brands = useLoad(() => api('brands.list', {}), { topics: ['brands.changed'] });
const brandName = (id: string) => brands.data.value?.find(b => b.id === id)?.name ?? id;

const creating = ref(false);
const draft = ref({ name: '', scopes: new Set<TokenScope>(['read']), restrict: 'all' as 'all' | 'some', brandIds: new Set<string>() });
const created = ref<{ token: string; record: ApiToken } | null>(null);
const cBusy = ref(false);
function openCreate() { draft.value = { name: '', scopes: new Set(['read']), restrict: 'all', brandIds: new Set() }; created.value = null; creating.value = true; }
function toggleScope(s: TokenScope) { const n = new Set(draft.value.scopes); if (n.has(s)) n.delete(s); else n.add(s); draft.value.scopes = n; }
function toggleBrand(id: string) { const n = new Set(draft.value.brandIds); if (n.has(id)) n.delete(id); else n.add(id); draft.value.brandIds = n; }
const cReady = computed(() => !!draft.value.name.trim() && draft.value.scopes.size > 0 && (draft.value.restrict === 'all' || draft.value.brandIds.size > 0));
async function create() {
  if (!cReady.value) return;
  cBusy.value = true;
  try {
    created.value = await api('tokens.create', { name: draft.value.name.trim(), scopes: TOKEN_SCOPES.filter(s => draft.value.scopes.has(s)), brandIds: draft.value.restrict === 'all' ? null : [...draft.value.brandIds] });
    void tokens.reload(true);
  } catch (e) { fail(e, 'Could not create the token'); } finally { cBusy.value = false; }
}
async function revoke(t: ApiToken) {
  if (!(await confirm({ title: `Revoke “${t.name}”?`, body: 'Anything using this token stops working immediately.', confirm: 'Revoke token', danger: true }))) return;
  try { await api('tokens.revoke', { id: t.id }); ok('Token revoked'); void tokens.reload(true); } catch (e) { fail(e); }
}
async function savePort() { if (portOk.value) await save('Port saved — restart Cubby if the API doesn’t come up on the new port'); }
const showRevoked = ref(false);
</script>

<template>
  <div class="set-sec">
    <div class="set-row">
      <div class="set-l"><span class="t">Local API</span><span class="d">REST on this computer only (127.0.0.1) for your own scripts, and the MCP endpoint Claude Code connects to. Every call needs a token.</span></div>
      <div class="set-c full">
        <span class="set-status" :class="app.status?.apiListening ? 'ok' : 'bad'"><span class="d" />{{ app.status?.apiListening ? 'Listening' : 'Not running — the port may be taken by another app' }}</span>
        <div class="set-pair"><span class="small muted">Port</span><input v-model.number="form.apiPort" type="number" min="1024" max="65535" class="input num" /><span v-if="!portOk" class="tiny bad">1024–65535</span></div>
        <div class="urls">
          <CopyField :value="app.status?.apiUrl ?? `http://127.0.0.1:${form.apiPort}`" label="API" mono />
          <CopyField :value="app.status?.mcpUrl ?? `http://127.0.0.1:${form.apiPort}/mcp`" label="MCP" mono />
        </div>
      </div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Tokens</span><span class="d">Give each script or client its own token with only the scopes it needs, optionally limited to some brands. For Claude Code, the Claude page sets one up for you.</span></div>
      <div class="set-c full">
        <div class="set-pair"><Btn size="sm" variant="primary" icon="plus" @click="openCreate">New token</Btn><Btn size="sm" variant="subtle" icon="claude" to="/claude">Connect Claude Code</Btn></div>
        <LoadError v-if="tokens.error.value" compact :error="tokens.error.value" title="Could not load tokens" @retry="tokens.reload()" />
        <div v-else-if="tokens.loading.value" class="skel-line" style="width: 50%" />
        <p v-else-if="!active.length" class="set-note">No tokens yet.</p>
        <ul v-else class="tl">
          <li v-for="t in active" :key="t.id">
            <div class="grow">
              <div class="row gap-2"><span class="strong small">{{ t.name }}</span><span class="code muted">{{ t.prefix }}…</span></div>
              <div class="sc"><Chip v-for="s in t.scopes" :key="s" size="sm" :tone="s === 'cdp' ? 'warn' : 'neutral'" :dot="false">{{ s }}</Chip><span class="tiny muted">{{ t.brandIds ? `${t.brandIds.length} brand${t.brandIds.length === 1 ? '' : 's'}: ${t.brandIds.map(brandName).join(', ')}` : 'All brands' }}</span></div>
            </div>
            <span class="tiny muted nowrap">Created {{ date(t.createdAt) }} · {{ t.lastUsedAt ? `used ${ago(t.lastUsedAt)}` : 'never used' }}</span>
            <Btn size="sm" variant="danger" @click="revoke(t)">Revoke</Btn>
          </li>
        </ul>
        <button v-if="revoked.length" type="button" class="link tiny muted self-start" @click="showRevoked = !showRevoked">{{ showRevoked ? 'Hide' : 'Show' }} {{ revoked.length }} revoked</button>
        <ul v-if="showRevoked && revoked.length" class="tl dim">
          <li v-for="t in revoked" :key="t.id"><span class="small grow">{{ t.name }} <span class="code muted">{{ t.prefix }}…</span></span><span class="tiny muted">revoked {{ ago(t.revokedAt) }}</span></li>
        </ul>
      </div>
    </div>
    <SaveBar :show="dirty" :busy="busy" :disabled="!portOk" @save="savePort" @discard="discard" />

    <Modal :open="creating" :title="created ? 'Token created' : 'New API token'" @update:open="v => (creating = v)">
      <div v-if="created" class="col gap-4">
        <p class="small">Copy it now — Cubby only stores a hash, so it can’t be shown again.</p>
        <CopyField :value="created.token" mono />
        <p class="tiny muted">Send it as <span class="code">Authorization: Bearer {{ created.record.prefix }}…</span></p>
      </div>
      <form v-else class="col gap-4" @submit.prevent="create">
        <Field label="Name" hint="Where it’s used, e.g. “Render script on this PC”"><input v-model="draft.name" class="input" maxlength="60" autofocus /></Field>
        <Field label="Scopes">
          <div class="scopes">
            <label v-for="s in TOKEN_SCOPES" :key="s" class="scope" :class="{ on: draft.scopes.has(s), warn: s === 'cdp' }">
              <input type="checkbox" :checked="draft.scopes.has(s)" @change="toggleScope(s)" />
              <span class="grow"><span class="code strong">{{ s }}</span><span class="tiny muted d">{{ SCOPE_HELP[s] }}</span></span>
            </label>
          </div>
        </Field>
        <Field label="Brands">
          <Segmented v-model="draft.restrict" size="sm" :options="[{ value: 'all', label: 'All brands' }, { value: 'some', label: 'Only some' }]" />
        </Field>
        <ul v-if="draft.restrict === 'some'" class="pick">
          <li v-for="b in brands.data.value ?? []" :key="b.id"><label><input type="checkbox" :checked="draft.brandIds.has(b.id)" @change="toggleBrand(b.id)" /><BrandAvatar :brand="b" :size="22" /><span class="ellipsis" :title="b.name">{{ b.name }}</span></label></li>
        </ul>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <Btn v-if="created" variant="primary" @click="creating = false">Done</Btn>
        <template v-else><Btn variant="subtle" @click="creating = false">Cancel</Btn><Btn variant="primary" icon="key" :loading="cBusy" :disabled="!cReady" @click="create">Create token</Btn></template>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.full { align-items: stretch; }
.self-start { align-self: flex-start; }
.urls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; max-width: 640px; }
@media (max-width: 1200px) { .urls { grid-template-columns: minmax(0, 1fr); } }
.bad { color: var(--bad); }
.tl { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); }
.tl li { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 16px; }
.tl li + li { border-top: 1px solid var(--line-soft); }
.tl.dim { opacity: .7; }
.sc { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
.scopes { display: flex; flex-direction: column; gap: 4px; }
.scope { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line-soft); cursor: pointer; transition: border-color 160ms, background-color 160ms; }
.scope.on { border-color: var(--line-strong); background: var(--panel-2); }
.scope.warn.on { border-color: color-mix(in srgb, var(--warn) 50%, transparent); background: var(--warn-bg); }
.scope input { margin-top: 3px; accent-color: var(--fg); }
.scope .d { display: block; margin-top: 1px; }
.scope .strong { margin-right: 8px; }
.pick { max-height: 220px; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--r-lg); }
.pick li + li { border-top: 1px solid var(--line-soft); }
.pick label { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; }
.pick input { accent-color: var(--fg); }
</style>
