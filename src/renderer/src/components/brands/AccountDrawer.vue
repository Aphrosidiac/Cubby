<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Account } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import Drawer from '@/components/ui/Drawer.vue';
import Btn from '@/components/ui/Btn.vue';
import AccountFields from './AccountFields.vue';
import { cleanHandle, draftToInput, newDraft, type AccountDraft } from './draft';
import { api } from '@/lib/api';
import { fail, ok } from '@/composables/toast';

/** Add or edit one platform account of a brand. Saved secrets are never loaded here — only replaced or cleared. */
const props = defineProps<{ open: boolean; brandId: string; account: Account | null }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; saved: [a: Account] }>();
const draft = reactive<AccountDraft>(newDraft());
const cleared = reactive(new Set<'username' | 'password' | 'totpSecret'>());
const busy = ref(false);
const tried = ref(false);
watch(() => props.open, o => {
  if (!o) return;
  const a = props.account;
  Object.assign(draft, newDraft(a?.platform ?? 'instagram'), a ? { handle: a.handle, displayName: a.displayName, profileUrl: a.profileUrl, ageTier: a.ageTier, notes: a.notes, saveLogin: a.hasUsername || a.hasPassword || a.hasTotp } : {});
  cleared.clear();
  tried.value = false;
});
const existing = computed(() => (props.account ? { hasUsername: props.account.hasUsername && !cleared.has('username'), hasPassword: props.account.hasPassword && !cleared.has('password'), hasTotp: props.account.hasTotp && !cleared.has('totpSecret') } : null));
const err = computed(() => (cleanHandle(draft.platform, draft.handle) ? null : draft.platform === 'custom' ? 'Enter the site address' : 'Enter the handle'));

async function save() {
  tried.value = true;
  if (err.value) return;
  busy.value = true;
  try {
    let a: Account;
    if (!props.account) a = await api('accounts.create', { brandId: props.brandId, ...draftToInput(draft) });
    else {
      const i = draftToInput(draft);
      const sec = (k: 'username' | 'password' | 'totpSecret', v: string | undefined) => (v ? v : cleared.has(k) || (!draft.saveLogin && props.account?.[k === 'username' ? 'hasUsername' : k === 'password' ? 'hasPassword' : 'hasTotp']) ? null : undefined);
      a = await api('accounts.update', {
        id: props.account.id,
        patch: { handle: i.handle, displayName: draft.displayName.trim(), profileUrl: draft.profileUrl.trim() || undefined, ageTier: i.ageTier, notes: draft.notes.trim(), username: sec('username', i.username), password: sec('password', i.password), totpSecret: sec('totpSecret', i.totpSecret) }
      });
    }
    ok(props.account ? 'Account saved' : `${PLATFORM_SPECS[a.platform].name} account added`);
    emit('saved', a);
    emit('update:open', false);
  } catch (e) { fail(e, 'Could not save the account'); } finally { busy.value = false; }
}
</script>

<template>
  <Drawer :open="open" :title="account ? `${PLATFORM_SPECS[account.platform].name} · ${account.handle}` : 'Add an account'" :eyebrow="account ? 'Edit account' : 'New account'" :width="600" @update:open="v => emit('update:open', v)">
    <form class="col gap-4" @submit.prevent="save">
      <AccountFields :draft="draft" :existing="existing" show-more @clear="k => cleared.add(k)" />
      <p v-if="tried && err" class="tiny bad">{{ err }}</p>
      <p v-if="account && !draft.saveLogin && (account.hasUsername || account.hasPassword || account.hasTotp)" class="tiny muted">Saving with “Saved login” off removes the stored username, password and 2FA secret.</p>
      <button type="submit" hidden />
    </form>
    <template #footer>
      <Btn variant="subtle" @click="emit('update:open', false)">Cancel</Btn>
      <Btn variant="primary" :loading="busy" @click="save">{{ account ? 'Save account' : 'Add account' }}</Btn>
    </template>
  </Drawer>
</template>

<style scoped>
.bad { color: var(--bad); }
</style>
