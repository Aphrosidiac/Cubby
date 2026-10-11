<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Account, BrandRow } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import LoadError from '@/components/common/LoadError.vue';
import TotpCode from '../TotpCode.vue';
import AccountDrawer from '../AccountDrawer.vue';
import { LOGIN_LABEL, LOGIN_TONE, TIER_LABEL, handleText } from '@/components/common/login';
import { api, isMac } from '@/lib/api';
import { app } from '@/lib/store';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail, ok, toast } from '@/composables/toast';
import { ago, dateTime } from '@/lib/format';

/**
 * Per platform: handle + profile link, age tier, login state and cookie expiry, the saved login
 * (masked; Reveal asks Touch ID or the unlock passphrase), the live 2FA code, and Fill login.
 */
const props = defineProps<{ brand: BrandRow }>();
const router = useRouter();
const list = useLoad(() => api('accounts.list', { brandId: props.brand.id }), { topics: ['accounts.changed'] });
const drawer = ref(false);
const editing = ref<Account | null>(null);
function add() { editing.value = null; drawer.value = true; }
function edit(a: Account) { editing.value = a; drawer.value = true; }
const name = (a: Account) => `${PLATFORM_SPECS[a.platform].name} ${handleText(a.platform, a.handle)}`;

const busy = ref<string | null>(null);
async function run(key: string, fn: () => Promise<unknown>, title: string) {
  if (busy.value) return;
  busy.value = key;
  try { await fn(); } catch (e) { fail(e, title); } finally { busy.value = null; }
}

// revealed logins stay visible for 30 s
const revealed = reactive(new Map<string, { username: string | null; password: string | null }>());
const timers = new Map<string, number>();
async function reveal(a: Account) {
  if (revealed.has(a.id)) { revealed.delete(a.id); return; }
  let passphrase: string | undefined;
  if (!isMac) {
    if (!app.settings?.unlockPassphraseSet) {
      if (await confirm({ title: 'Set an unlock passphrase first', body: 'On Windows, saved logins are shown only after you type the app unlock passphrase. Set one in Settings → Security.', confirm: 'Open Security settings' })) void router.push('/settings?tab=security');
      return;
    }
    const p = await confirm({ title: 'Show saved login', body: `${name(a)} — shown for 30 seconds.`, confirm: 'Show', input: { label: 'Unlock passphrase', password: true } });
    if (!p) return;
    passphrase = p;
  }
  await run(`rev-${a.id}`, async () => {
    const r = await api('accounts.reveal', { id: a.id, passphrase });
    revealed.set(a.id, r);
    clearTimeout(timers.get(a.id));
    timers.set(a.id, window.setTimeout(() => revealed.delete(a.id), 30_000));
  }, 'Could not show the login');
}
onBeforeUnmount(() => timers.forEach(t => clearTimeout(t)));
async function copy(v: string | null, what: string) { if (!v) return; try { await navigator.clipboard.writeText(v); ok(`${what} copied`); } catch (e) { fail(e); } }

async function fill(a: Account) {
  await run(`fill-${a.id}`, async () => {
    if (props.brand.status !== 'open') toast(`Opening ${props.brand.name}…`);
    await api('accounts.fillLogin', { id: a.id });
    ok('Login filled in', 'Check the window, then press Log in and finish any 2FA or captcha yourself.');
  }, 'Fill login did not work');
}
async function check(a: Account) {
  await run(`chk-${a.id}`, async () => {
    if (props.brand.status !== 'open') toast(`Checking in the background — ${props.brand.name} opens for a moment`);
    const r = (await api('health.check', { brandId: props.brand.id })).find(x => x.id === a.id);
    if (r) toast(`${name(r)}: ${LOGIN_LABEL[r.loginState]}`, { tone: r.loginState === 'ok' ? 'good' : r.loginState === 'unknown' ? 'neutral' : 'warn' });
  }, 'Health check failed');
}
async function remove(a: Account) {
  if (!(await confirm({ title: `Remove ${name(a)}?`, body: 'Its saved login and 2FA secret are deleted. The platform session in the brand’s Chrome is not touched.', confirm: 'Remove account', danger: true }))) return;
  await run(`del-${a.id}`, async () => { await api('accounts.delete', { id: a.id }); ok(`${name(a)} removed`); }, 'Could not remove the account');
}
const fillHint = (a: Account) => (props.brand.deletedAt ? 'Restore the brand first' : a.platform === 'custom' ? 'Custom sites have no known login page' : !(a.hasUsername || a.hasPassword) ? 'Save a login first' : 'Types the saved login into this brand’s login page — you press Log in');
const open = (u: string) => api('app.openExternal', { url: u }).catch(e => fail(e));
const profile = (a: Account) => a.profileUrl || (a.platform !== 'custom' ? PLATFORM_SPECS[a.platform].profileUrl(a.handle) : a.handle);
const menu = (a: Account) => [
  { label: 'Edit…', icon: 'edit', run: () => edit(a) },
  { label: 'Open login page in brand', icon: 'key', disabled: a.platform === 'custom' || !!props.brand.deletedAt, run: () => void api('brands.open', { id: props.brand.id, urls: [PLATFORM_SPECS[a.platform].loginUrl] }).catch(e => fail(e, 'Could not open the login page')) },
  { label: 'Check login now', icon: 'pulse', disabled: a.platform === 'custom' || !!props.brand.deletedAt, run: () => void check(a) },
  { divider: true, label: '' },
  { label: 'Remove account', icon: 'trash', danger: true, run: () => void remove(a) }
];
</script>

<template>
  <div class="acc-tab">
    <div class="bar">
      <p class="small muted grow">Saved logins are encrypted with your {{ isMac ? 'macOS keychain' : 'Windows account' }} and never shown to Claude or the Local API.</p>
      <Btn variant="primary" size="sm" icon="plus" @click="add">Add account</Btn>
    </div>

    <LoadError v-if="list.error.value" :error="list.error.value" title="Could not load accounts" @retry="list.reload()" />
    <div v-else-if="list.loading.value" class="cards" aria-busy="true">
      <div v-for="i in 2" :key="i" class="panel pad"><div class="skel-line" style="width: 40%" /><div class="skel-line mt-3" style="width: 70%" /><div class="skel-line mt-3" style="width: 55%" /></div>
    </div>
    <EmptyState v-else-if="!list.data.value?.length" icon="users" title="No accounts yet" body="Add each platform this brand posts to. Saving the login lets Cubby type it in for you when a session expires.">
      <Btn variant="primary" icon="plus" @click="add">Add account</Btn>
    </EmptyState>
    <TransitionGroup v-else tag="div" name="list" class="cards">
      <article v-for="a in list.data.value" :key="a.id" class="panel acc">
        <header class="ah">
          <span class="pf"><PlatformIcon :platform="a.platform" :size="20" colored /></span>
          <div class="grow">
            <div class="row gap-2"><span class="h3">{{ PLATFORM_SPECS[a.platform].name }}</span><Chip :tone="LOGIN_TONE[a.loginState]" size="sm">{{ LOGIN_LABEL[a.loginState] }}</Chip></div>
            <button type="button" class="link small handle" :title="profile(a)" @click="open(profile(a))"><span class="ellipsis">{{ handleText(a.platform, a.handle) }}</span><Icon name="external" :size="12" /></button>
          </div>
          <Menu :items="menu(a)" :width="230">
            <button type="button" class="more" :aria-label="`More for ${name(a)}`" title="More"><Icon name="more" :size="18" :stroke="3" /></button>
          </Menu>
        </header>

        <dl class="facts">
          <dt>Account age</dt><dd>{{ TIER_LABEL[a.ageTier] }}</dd>
          <dt>Session</dt>
          <dd class="txt">
            <span v-if="a.cookieExpiresAt" :title="dateTime(a.cookieExpiresAt)">{{ new Date(a.cookieExpiresAt) < new Date() ? 'Expired' : 'Expires' }} {{ ago(a.cookieExpiresAt) }}</span>
            <span v-else class="muted">{{ a.loginState === 'unknown' ? 'Not checked yet' : 'No session cookie' }}</span>
            <span v-if="a.lastCheckedAt" class="tiny muted" :title="dateTime(a.lastCheckedAt)"> · checked {{ ago(a.lastCheckedAt) }}</span>
          </dd>
          <dt>Saved login</dt>
          <dd>
            <template v-if="a.hasUsername || a.hasPassword">
              <div v-if="revealed.get(a.id)" class="rev">
                <button type="button" class="val" :title="revealed.get(a.id)!.username ? 'Copy the username' : undefined" :disabled="!revealed.get(a.id)!.username" @click="copy(revealed.get(a.id)!.username, 'Username')">{{ revealed.get(a.id)!.username ?? 'No username' }}</button>
                <button type="button" class="val code" :title="revealed.get(a.id)!.password ? 'Copy the password' : undefined" :disabled="!revealed.get(a.id)!.password" @click="copy(revealed.get(a.id)!.password, 'Password')">{{ revealed.get(a.id)!.password ?? 'No password' }}</button>
              </div>
              <span v-else class="masked">{{ a.hasUsername ? 'username' : '' }}{{ a.hasUsername && a.hasPassword ? ' · ' : '' }}{{ a.hasPassword ? '••••••••••' : '' }}</span>
              <button type="button" class="link small rv" :disabled="busy === `rev-${a.id}`" @click="reveal(a)">{{ revealed.has(a.id) ? 'Hide' : 'Reveal' }}</button>
            </template>
            <button v-else type="button" class="link small muted" @click="edit(a)">Add a login</button>
          </dd>
          <dt>2FA code</dt>
          <dd><TotpCode v-if="a.hasTotp" :account-id="a.id" /><button v-else type="button" class="link small muted" @click="edit(a)">Add the 2FA secret</button></dd>
        </dl>
        <p v-if="a.notes" class="tiny muted notes">{{ a.notes }}</p>

        <footer class="af">
          <Btn size="sm" variant="primary" icon="fill" :loading="busy === `fill-${a.id}`" :disabled="a.platform === 'custom' || !(a.hasUsername || a.hasPassword) || !!brand.deletedAt" :title="fillHint(a)" @click="fill(a)">Fill login</Btn>
          <Btn size="sm" variant="subtle" icon="edit" @click="edit(a)">Edit</Btn>
        </footer>
      </article>
    </TransitionGroup>

    <AccountDrawer v-model:open="drawer" :brand-id="brand.id" :account="editing" />
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
.acc { display: flex; flex-direction: column; min-width: 0; }
.ah { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 14px; }
.ah .grow { min-width: 0; }
.pf { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: var(--panel-2); flex: none; }
.handle { display: inline-flex; align-items: center; gap: 5px; margin-top: 2px; color: var(--fg-2); max-width: 100%; }
.handle :deep(svg) { flex: none; }
.acc .facts { padding: 0 20px; }
.acc .facts > dt:first-of-type, .acc .facts > dt:first-of-type + dd { border-top: 1px solid var(--line-soft); }
.acc .facts dd { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; font-weight: 400; }
/* a label sits level with its value, however tall the value is (2FA box, revealed login) */
.acc .facts dt { display: flex; align-items: center; }
.acc .facts dd.txt { display: block; }
.masked { color: var(--muted); letter-spacing: .04em; }
.rev { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 0; }
.val { font-weight: 500; text-align: right; max-width: 220px; overflow-wrap: anywhere; border-radius: 4px; padding: 0 3px; }
.val:hover:not(:disabled) { background: var(--panel-2); }
.val:disabled { color: var(--muted); font-weight: 400; cursor: default; }
.rv { font-weight: 500; }
.notes { padding: 10px 20px 0; overflow-wrap: anywhere; }
.af { display: flex; gap: 8px; padding: 14px 20px 16px; margin-top: auto; border-top: 1px solid var(--line-soft); }
.more { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 50%; color: var(--muted); transition: background-color 160ms, color 160ms; }
.more:hover { background: var(--panel-2); color: var(--fg); }
.more:active { background: var(--line); }
@media (max-width: 1100px) { .bar { align-items: flex-start; } }
</style>
