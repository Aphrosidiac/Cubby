<script setup lang="ts">
import { ref } from 'vue';
import type { TokenScope } from '@shared/types';
import { TOKEN_SCOPES } from '@shared/types';
import Modal from '@/components/ui/Modal.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import CopyField from '@/components/ui/CopyField.vue';
import Icon from '@/components/ui/Icon.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { useBrands } from '@/components/posts/meta';
import { api } from '@/lib/api';
import { fail } from '@/composables/toast';

/** Quick token create (the full screen lives in Settings → Local API). The token is shown once. */
defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; created: [] }>();
const brands = useBrands();
const SCOPE_TEXT: Record<TokenScope, string> = { read: 'Read brands, posts, media, activity', brands: 'Open, close and edit brands', browser: 'Drive brand windows (click, type…)', posting: 'Create and prepare posts', flows: 'Run flows', cdp: 'Raw CDP endpoint — your own scripts only', mcp: 'Connect as an MCP client' };
const name = ref('');
const scopes = ref<TokenScope[]>(['read', 'mcp']);
const brandIds = ref<string[]>([]);
const token = ref<string | null>(null);
const busy = ref(false);
function reset() { name.value = ''; scopes.value = ['read', 'mcp']; brandIds.value = []; token.value = null; }
const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
async function create() {
  busy.value = true;
  try {
    const r = await api('tokens.create', { name: name.value.trim(), scopes: scopes.value, brandIds: brandIds.value.length ? brandIds.value : null });
    token.value = r.token;
    emit('created');
  } catch (e) { fail(e, 'Could not create the token'); }
  finally { busy.value = false; }
}
function close() { emit('update:open', false); setTimeout(reset, 300); }
</script>

<template>
  <Modal :open="open" :title="token ? 'Copy your token' : 'New API token'" eyebrow="Local API" @update:open="v => !v && close()">
    <template v-if="token">
      <p class="small muted">This is the only time it is shown. Store it somewhere safe — Cubby keeps only a hash.</p>
      <CopyField :value="token" mono class="mt-4" />
    </template>
    <template v-else>
      <Field label="Name" required><input v-model="name" class="input" placeholder="e.g. Claude Code on this PC" maxlength="80" autofocus @keydown.enter.prevent="name.trim() && scopes.length && !busy && create()" /></Field>
      <div class="mt-4">
        <div class="flabel">Scopes</div>
        <ul class="scopes">
          <li v-for="s in TOKEN_SCOPES" :key="s"><label><input type="checkbox" :checked="scopes.includes(s)" @change="scopes = toggle(scopes, s)" /><span class="code">{{ s }}</span><span class="small muted">{{ SCOPE_TEXT[s] }}</span></label></li>
        </ul>
        <p v-if="scopes.includes('cdp')" class="tiny warnt"><Icon name="warn" :size="12" /> CDP gives full browser control without guardrails — never give it to Claude.</p>
      </div>
      <div class="mt-4">
        <div class="flabel">Brands <span class="muted tiny">(none = all)</span></div>
        <div class="chips">
          <button v-for="b in brands.list" :key="b.id" type="button" class="bchip" :class="{ on: brandIds.includes(b.id) }" :aria-pressed="brandIds.includes(b.id)" :title="b.name" @click="brandIds = toggle(brandIds, b.id)"><BrandAvatar :brand="b" :size="16" /><span class="ellipsis">{{ b.name }}</span><Icon v-if="brandIds.includes(b.id)" name="check" :size="12" class="bk" /></button>
          <span v-if="!brands.list.length" class="tiny muted">No brands yet — the token will work for every brand you add.</span>
        </div>
      </div>
    </template>
    <template #footer>
      <template v-if="token"><Btn variant="primary" @click="close">Done</Btn></template>
      <template v-else>
        <Btn variant="subtle" @click="close">Cancel</Btn>
        <Btn variant="primary" :disabled="!name.trim() || !scopes.length" :loading="busy" @click="create">Create token</Btn>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.flabel { font-size: var(--fs-sm); font-weight: 500; color: var(--fg-2); margin-bottom: 8px; }
.scopes li label { display: grid; grid-template-columns: 18px 70px 1fr; gap: 8px; align-items: center; padding: 5px 0; cursor: pointer; }
.scopes input { accent-color: var(--fg); }
.warnt { color: var(--warn); display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bchip { display: inline-flex; align-items: center; gap: 6px; height: 30px; max-width: 220px; padding: 0 11px 0 7px; border-radius: 99px; border: 1px solid var(--line); font-size: var(--fs-sm); transition: border-color var(--t-micro), background-color var(--t-micro); }
.bchip:hover { border-color: var(--line-strong); }
.bchip.on { border-color: var(--fg); background: var(--panel-2); }
.bchip > .ba, .bchip > .bk { flex: none; }
.scopes li label:hover .code { color: var(--fg); }
</style>
