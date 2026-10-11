<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Account } from '@shared/types';
import type { In } from '@shared/contract';
import { PLATFORM_SPECS } from '@shared/platforms';
import Drawer from '@/components/ui/Drawer.vue';
import Btn from '@/components/ui/Btn.vue';
import AccountFields from './AccountFields.vue';
import { totpProblem } from './totp';
import { cleanHandle, draftToInput, newDraft, type AccountDraft } from './draft';
import { handleText } from '@/components/common/login';
import { api } from '@/lib/api';
import { fail, ok } from '@/composables/toast';

/** Add or edit one platform account of a brand. Saved secrets are never loaded here — only replaced or cleared. */
const props = defineProps<{ open: boolean; brandId: string; account: Account | null }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; saved: [a: Account] }>();
const draft = reactive<AccountDraft>(newDraft());
const cleared = reactive(new Set<'username' | 'password' | 'totpSecret'>());
const busy = ref(false);
const tried = ref(false);
/** the link the app fills in by itself — shown as blank ("leave blank for …") rather than as a typed value */
const defaultLink = (a: Pick<Account, 'platform' | 'handle'>) => (a.platform === 'custom' ? '' : PLATFORM_SPECS[a.platform].profileUrl(a.handle));
watch(() => props.open, o => {
  if (!o) return;
  const a = props.account;
  Object.assign(draft, newDraft(a?.platform ?? 'instagram'), a ? { handle: cleanHandle(a.platform, a.handle), displayName: a.displayName ?? '', profileUrl: a.profileUrl && a.profileUrl !== defaultLink(a) ? a.profileUrl : '', ageTier: a.ageTier, notes: a.notes ?? '', saveLogin: a.hasUsername || a.hasPassword || a.hasTotp } : {});
  cleared.clear();
  tried.value = false;
});
const existing = computed(() => (props.account ? { hasUsername: props.account.hasUsername && !cleared.has('username'), hasPassword: props.account.hasPassword && !cleared.has('password'), hasTotp: props.account.hasTotp && !cleared.has('totpSecret') } : null));
const handleErr = computed(() => (cleanHandle(draft.platform, draft.handle) ? null : draft.platform === 'custom' ? 'Enter the site address' : 'Enter the handle'));
const totpErr = computed(() => (draft.saveLogin ? totpProblem(draft.totpSecret) : null));

async function save() {
  tried.value = true;
  if (handleErr.value || totpErr.value || busy.value) return;
  busy.value = true;
  try {
    let a: Account;
    const i = draftToInput(draft);
    if (!props.account) a = await api('accounts.create', { brandId: props.brandId, ...i });
    else {
      const was = props.account;
      const has = { username: was.hasUsername, password: was.hasPassword, totpSecret: was.hasTotp };
      // a secret: a new value replaces it, a cleared one (or "Saved login" off) removes it, blank keeps it
      const sec = (k: 'username' | 'password' | 'totpSecret', v: string | undefined) => (v ? v : (cleared.has(k) || !draft.saveLogin) && has[k] ? null : undefined);
      const link = draft.profileUrl.trim() || defaultLink({ platform: was.platform, handle: i.handle });
      // only what changed, so the activity log says what really happened
      const patch: In<'accounts.update'>['patch'] = {};
      // the stored handle may carry an "@" the field shows as a prefix: compare the cleaned forms
      if (i.handle !== cleanHandle(was.platform, was.handle)) patch.handle = i.handle;
      if (draft.displayName.trim() !== (was.displayName ?? '')) patch.displayName = draft.displayName.trim();
      if (link !== (was.profileUrl ?? '')) patch.profileUrl = link;
      if (i.ageTier !== was.ageTier) patch.ageTier = i.ageTier;
      if (draft.notes.trim() !== (was.notes ?? '')) patch.notes = draft.notes.trim();
      for (const [k, v] of [['username', i.username], ['password', i.password], ['totpSecret', i.totpSecret]] as const) { const s = sec(k, v); if (s !== undefined) patch[k] = s; }
      a = Object.keys(patch).length ? await api('accounts.update', { id: was.id, patch }) : was;
    }
    ok(props.account ? 'Account saved' : `${PLATFORM_SPECS[a.platform].name} account added`);
    emit('saved', a);
    emit('update:open', false);
  } catch (e) { fail(e, 'Could not save the account'); } finally { busy.value = false; }
}
</script>

<template>
  <Drawer :open="open" :title="account ? `${PLATFORM_SPECS[account.platform].name} · ${handleText(account.platform, account.handle)}` : 'Add an account'" :eyebrow="account ? 'Edit account' : 'New account'" :width="600" @update:open="v => emit('update:open', v)">
    <form class="col gap-4" novalidate @submit.prevent="save">
      <AccountFields :draft="draft" :existing="existing" :handle-error="tried ? handleErr : null" show-more @clear="k => cleared.add(k)" />
      <p v-if="account && !draft.saveLogin && (account.hasUsername || account.hasPassword || account.hasTotp)" class="tiny warn">Saving with “Saved login” off removes the stored username, password and 2FA secret.</p>
      <button type="submit" hidden />
    </form>
    <template #footer>
      <Btn variant="subtle" @click="emit('update:open', false)">Cancel</Btn>
      <Btn variant="primary" :loading="busy" :disabled="tried && (!!handleErr || !!totpErr)" @click="save">{{ account ? 'Save account' : 'Add account' }}</Btn>
    </template>
  </Drawer>
</template>

<style scoped>
.warn { color: var(--warn); }
</style>
