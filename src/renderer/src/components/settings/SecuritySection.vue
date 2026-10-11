<script setup lang="ts">
import { computed, ref } from 'vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import { api, isMac } from '@/lib/api';
import { app } from '@/lib/store';
import { fail, ok } from '@/composables/toast';

/** The app unlock passphrase: asked before a saved login is shown (Windows has no Hello API in Electron). */
const isSet = computed(() => !!app.settings?.unlockPassphraseSet);
const cur = ref(''); const p1 = ref(''); const p2 = ref('');
const busy = ref(false);
const err = computed(() => (p1.value && p1.value.length < 6 ? 'At least 6 characters' : p2.value && p1.value !== p2.value ? 'The two passphrases differ' : null));
const ready = computed(() => p1.value.length >= 6 && p1.value === p2.value && (!isSet.value || !!cur.value));
async function save() {
  if (!ready.value) return;
  busy.value = true;
  const wasSet = isSet.value;
  try {
    app.settings = await api('settings.setUnlockPassphrase', { passphrase: p1.value, current: isSet.value ? cur.value : undefined });
    cur.value = ''; p1.value = ''; p2.value = '';
    ok(wasSet ? 'Unlock passphrase changed' : 'Unlock passphrase set');
  } catch (e) { fail(e, 'Could not set the passphrase'); } finally { busy.value = false; }
}
</script>

<template>
  <div class="set-sec">
    <div class="set-row">
      <div class="set-l"><span class="t">Unlock passphrase</span><span class="d">{{ isMac ? 'On a Mac with Touch ID, Reveal uses Touch ID; this passphrase is the fallback.' : 'Asked before Cubby shows a saved username or password (Reveal). Only a hash is stored.' }}</span></div>
      <div class="set-c">
        <span class="set-status" :class="isSet ? 'ok' : 'bad'"><span class="d" />{{ isSet ? 'Set' : 'Not set — saved logins can’t be revealed yet' }}</span>
        <form class="col gap-3 frm" @submit.prevent="save">
          <Field v-if="isSet" label="Current passphrase"><input v-model="cur" type="password" class="input" autocomplete="current-password" /></Field>
          <Field :label="isSet ? 'New passphrase' : 'Passphrase'" :error="p1 && p1.length < 6 ? 'At least 6 characters' : null"><input v-model="p1" type="password" class="input" autocomplete="new-password" /></Field>
          <Field label="Repeat" :error="p2 && p1 !== p2 ? 'Does not match' : null"><input v-model="p2" type="password" class="input" autocomplete="new-password" /></Field>
          <div><Btn type="submit" variant="primary" size="sm" icon="lock" :loading="busy" :disabled="!ready">{{ isSet ? 'Change passphrase' : 'Set passphrase' }}</Btn></div>
        </form>
        <span class="set-note">Cubby can’t recover a forgotten passphrase. Saved logins stay encrypted by your {{ isMac ? 'macOS keychain' : 'Windows account' }} either way — the passphrase only gates showing them.</span>
      </div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">What Claude can’t see</span><span class="d">Enforced in the app, whatever an MCP client asks.</span></div>
      <div class="set-c">
        <ul class="guard">
          <li>Passwords, 2FA secrets and codes, cookie values — no tool returns them.</li>
          <li>Account settings, password, 2FA, billing and deactivation pages are off-limits.</li>
          <li>Publishing goes through Approvals for brands that require it.</li>
          <li>The Stop button (kill switch) aborts every run at once.</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.frm { width: 100%; max-width: 360px; }
.guard { display: flex; flex-direction: column; gap: 8px; font-size: var(--fs-sm); color: var(--fg-2); }
.guard li { position: relative; padding-left: 16px; }
.guard li::before { content: ''; position: absolute; left: 0; top: 8px; width: 6px; height: 6px; border-radius: 2px; background: var(--fg); }
</style>
