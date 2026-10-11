<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Modal from '@/components/ui/Modal.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import Toggle from '@/components/ui/Toggle.vue';
import { api } from '@/lib/api';
import { fail, toast } from '@/composables/toast';

/**
 * Export brands to an encrypted .brand file (settings, accounts, cookies re-encrypted with a
 * passphrase) — the way to move brands to another computer. Saved logins only when ticked.
 */
const props = defineProps<{ open: boolean; ids: string[]; names?: string[] }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; done: [] }>();
const pass = ref('');
const pass2 = ref('');
const creds = ref(false);
const busy = ref(false);
watch(() => props.open, o => { if (o) { pass.value = ''; pass2.value = ''; creds.value = false; } });
const err = computed(() => (pass.value && pass.value.length < 8 ? 'At least 8 characters' : pass2.value && pass2.value !== pass.value ? 'The two passphrases differ' : null));
const ready = computed(() => pass.value.length >= 8 && pass.value === pass2.value && props.ids.length > 0);
const title = computed(() => (props.ids.length === 1 && props.names?.[0] ? `Export ${props.names[0]}` : `Export ${props.ids.length} brands`));
async function go() {
  if (!ready.value) return;
  busy.value = true;
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const base = props.ids.length === 1 && props.names?.[0] ? props.names[0].replace(/[^\w-]+/g, '-').toLowerCase() : `cubby-brands-${props.ids.length}`;
    const [path] = await api('app.pickFiles', { save: true, defaultPath: `${base}-${stamp}.brand`, filters: [{ name: 'Cubby brand export', extensions: ['brand'] }] });
    if (!path) return;
    const r = await api('transfer.export', { ids: props.ids, passphrase: pass.value, includeCredentials: creds.value, path });
    emit('update:open', false);
    emit('done');
    toast(`Exported ${r.brands} brand${r.brands === 1 ? '' : 's'}`, { tone: 'good', body: r.path, action: { label: 'Show file', run: () => void api('app.revealPath', { path: r.path }) } });
  } catch (e) { fail(e, 'Export failed'); } finally { busy.value = false; }
}
</script>

<template>
  <Modal :open="open" :title="title" eyebrow="Encrypted export" @update:open="v => emit('update:open', v)">
    <form class="col gap-4" @submit.prevent="go">
      <p class="small muted">Creates a <span class="code">.brand</span> file with each brand’s settings, accounts and cookies, encrypted with a passphrase. Import it in Cubby on another computer to move these brands there. Some platforms may ask to verify the new device.</p>
      <div class="grid-2">
        <Field label="Passphrase" :error="pass && pass.length < 8 ? 'At least 8 characters' : null"><input v-model="pass" type="password" class="input" autocomplete="new-password" autofocus /></Field>
        <Field label="Repeat passphrase" :error="pass2 && pass2 !== pass ? 'Does not match' : null"><input v-model="pass2" type="password" class="input" autocomplete="new-password" /></Field>
      </div>
      <Toggle v-model="creds" label="Include saved logins" hint="Usernames, passwords and 2FA secrets. Leave off unless you are moving to your own computer." />
      <p class="tiny muted">Cubby can’t recover a lost passphrase.</p>
      <button type="submit" hidden />
    </form>
    <template #footer>
      <Btn variant="subtle" @click="emit('update:open', false)">Cancel</Btn>
      <Btn variant="primary" icon="download" :loading="busy" :disabled="!ready" @click="go">Choose where to save…</Btn>
    </template>
  </Modal>
</template>
