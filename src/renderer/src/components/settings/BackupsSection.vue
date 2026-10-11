<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BackupInfo } from '@shared/types';
import Toggle from '@/components/ui/Toggle.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import Modal from '@/components/ui/Modal.vue';
import Select from '@/components/ui/Select.vue';
import SaveBar from '@/components/common/SaveBar.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import LoadError from '@/components/common/LoadError.vue';
import ExportBrandsModal from '@/components/brands/ExportBrandsModal.vue';
import { importBrandFile } from '@/components/brands/importers';
import { useSection } from './useSection';
import { api, isMac } from '@/lib/api';
import { app } from '@/lib/store';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail, ok, toast } from '@/composables/toast';
import { ago, bytes, dateTime } from '@/lib/format';

/** Scheduled encrypted backups (database + every brand profile), restore, and moving brands between computers. */
const { form, dirty, busy, save, discard } = useSection(['backup']);
const SCHEDULES = [
  { value: '0 3 * * *', label: 'Every day at 03:00' },
  { value: '0 */12 * * *', label: 'Every 12 hours' },
  { value: '0 3 * * 0', label: 'Every Sunday at 03:00' },
  { value: '0 3 1 * *', label: 'First of the month, 03:00' },
  { value: 'custom', label: 'Custom (cron)…' }
];
const customCron = ref(!SCHEDULES.some(s => s.value === form.backup.cron));
const schedule = computed({
  get: () => (customCron.value ? 'custom' : form.backup.cron),
  set: v => { if (v === 'custom') customCron.value = true; else { customCron.value = false; form.backup.cron = v; } }
});
const cronOk = computed(() => form.backup.cron.trim().split(/\s+/).length === 5);
async function pickFolder() {
  try { const [p] = await api('app.pickFiles', { directory: true, defaultPath: form.backup.folder ?? undefined }); if (p) form.backup.folder = p; } catch (e) { fail(e); }
}

// ── backup passphrase ──
const passOpen = ref(false); const bp1 = ref(''); const bp2 = ref(''); const passBusy = ref(false);
const bpReady = computed(() => bp1.value.length >= 8 && bp1.value === bp2.value);
async function savePass() {
  if (!bpReady.value) return;
  passBusy.value = true;
  try { app.settings = await api('settings.setBackupPassphrase', { passphrase: bp1.value }); passOpen.value = false; bp1.value = ''; bp2.value = ''; ok('Backup passphrase saved'); }
  catch (e) { fail(e, 'Could not save the passphrase'); } finally { passBusy.value = false; }
}

// ── run / list / restore ──
const list = useLoad(() => api('backup.list'));
const running = ref(false);
async function runNow() {
  let passphrase: string | undefined;
  if (!app.settings?.backupPassphraseSet) {
    const p = await confirm({ title: 'Back up now', body: 'No backup passphrase is saved. Enter one for this backup (8+ characters) — you’ll need it to restore.', confirm: 'Back up', input: { label: 'Passphrase', password: true } });
    if (!p) return;
    if (p.length < 8) { toast('The passphrase needs at least 8 characters', { tone: 'warn' }); return; }
    passphrase = p;
  }
  if (!form.backup.folder && !app.settings?.backup.folder) toast('No backup folder chosen — saving to Cubby’s data folder', { tone: 'warn' });
  running.value = true;
  try {
    const r = await api('backup.run', { passphrase, folder: form.backup.folder ?? undefined });
    toast('Backup saved', { tone: 'good', body: `${bytes(r.sizeBytes)} · ${r.path}`, action: { label: 'Show file', run: () => void api('app.revealPath', { path: r.path }) } });
    void list.reload(true);
  } catch (e) { fail(e, 'Backup failed'); } finally { running.value = false; }
}
const restoring = ref<string | null>(null);
/** b = a listed backup, or only a path picked from disk (then its file name stands in for date and size) */
async function restore(b: BackupInfo | { path: string }) {
  const what = 'at' in b ? `${dateTime(b.at)} · ${bytes(b.sizeBytes)}` : b.path.split(/[\\/]/).pop();
  const p = await confirm({ title: 'Restore this backup?', body: `${what}\nBrands that aren’t on this computer are added back with their profiles. Brands you already have are left as they are.`, confirm: 'Restore', input: { label: 'Backup passphrase', password: true } });
  if (!p) return;
  restoring.value = b.path;
  try { await api('backup.restore', { path: b.path, passphrase: p }); void list.reload(true); /* main toasts what was restored */ } catch (e) { fail(e, 'Restore failed'); } finally { restoring.value = null; }
}
async function restoreFile() {
  try {
    const [path] = await api('app.pickFiles', { filters: [{ name: 'Cubby backup', extensions: ['cubbybak'] }] });
    if (path) await restore({ path });
  } catch (e) { fail(e); }
}
const reveal = (p: string) => api('app.revealPath', { path: p }).catch(e => fail(e));

// ── export brands ──
const brands = useLoad(() => api('brands.list', {}), { topics: ['brands.changed'], immediate: true });
const pickOpen = ref(false);
const picked = ref(new Set<string>());
const exportIds = ref<string[] | null>(null);
function openPick() { picked.value = new Set((brands.data.value ?? []).map(b => b.id)); pickOpen.value = true; }
function togglePick(id: string) { const s = new Set(picked.value); if (s.has(id)) s.delete(id); else s.add(id); picked.value = s; }
function toExport() { exportIds.value = [...picked.value]; pickOpen.value = false; }
const exportNames = computed(() => (exportIds.value ?? []).map(id => brands.data.value?.find(b => b.id === id)?.name ?? ''));
</script>

<template>
  <div class="set-sec">
    <div class="set-row">
      <div class="set-l"><span class="t">Scheduled backups</span><span class="d">The database and every brand profile, compressed and encrypted (AES-256-GCM) to a folder you choose — an external drive, iCloud Drive or Google Drive folder.</span></div>
      <div class="set-c">
        <Toggle v-model="form.backup.enabled" label="Back up automatically" />
        <Field label="Folder" class="w">
          <div class="set-pair nowrap-pair"><input :value="form.backup.folder ?? ''" class="input" readonly placeholder="Choose a folder" @click="pickFolder" /><Btn size="sm" icon="folder" @click="pickFolder">Choose…</Btn></div>
        </Field>
        <div class="set-pair">
          <Field label="When"><Select v-model="schedule" :options="SCHEDULES" :min-width="240" style="width: 240px" /></Field>
          <Field label="Keep the newest"><div class="set-pair"><input v-model.number="form.backup.keep" type="number" min="1" max="100" class="input num" /><span class="small muted">backups</span></div></Field>
        </div>
        <Field v-if="schedule === 'custom'" label="Cron expression" :error="cronOk ? null : 'Five fields: minute hour day month weekday'" hint="e.g. 30 2 * * 1-5 = 02:30 on weekdays"><input v-model="form.backup.cron" class="input code" style="width: 240px" /></Field>
        <span v-if="form.backup.enabled && !app.settings?.backupPassphraseSet" class="warn small">Scheduled backups need a saved backup passphrase (below).</span>
        <span v-if="form.backup.enabled && !form.backup.folder" class="warn small">Choose a folder for scheduled backups.</span>
      </div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Backup passphrase</span><span class="d">Encrypts every backup. Stored with your {{ isMac ? 'macOS keychain' : 'Windows account' }} so scheduled backups can run unattended. You need it to restore.</span></div>
      <div class="set-c">
        <span class="set-status" :class="app.settings?.backupPassphraseSet ? 'ok' : 'bad'"><span class="d" />{{ app.settings?.backupPassphraseSet ? 'Saved' : 'Not set' }}</span>
        <Btn size="sm" icon="lock" @click="passOpen = true">{{ app.settings?.backupPassphraseSet ? 'Change passphrase…' : 'Set passphrase…' }}</Btn>
      </div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Backups</span><span class="d">Restoring adds back brands that are missing here. Profiles restored on a different computer lose their logins — use Export brands for that.</span></div>
      <div class="set-c full">
        <div class="set-pair"><Btn size="sm" variant="primary" icon="backup" :loading="running" @click="runNow">Back up now</Btn><Btn size="sm" variant="subtle" icon="upload" @click="restoreFile">Restore from a file…</Btn></div>
        <LoadError v-if="list.error.value" compact :error="list.error.value" title="Could not list backups" @retry="list.reload()" />
        <div v-else-if="list.loading.value" class="skel-line" style="width: 50%" />
        <p v-else-if="!list.data.value?.length" class="set-note">No backups yet.</p>
        <ul v-else class="bl">
          <li v-for="b in list.data.value" :key="b.path">
            <div class="grow"><div class="small strong">{{ dateTime(b.at) }} <span class="muted">· {{ ago(b.at) }}</span></div><div class="tiny muted code ellipsis" :title="b.path">{{ b.path }}</div></div>
            <span class="tiny muted num">{{ bytes(b.sizeBytes) }}</span>
            <Btn size="sm" variant="subtle" icon="folder" @click="reveal(b.path)">Show</Btn>
            <Btn size="sm" icon="undo" :loading="restoring === b.path" @click="restore(b)">Restore</Btn>
          </li>
        </ul>
      </div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Move brands to another computer</span><span class="d">Export makes an encrypted .brand file with settings, accounts and cookies; import it in Cubby on the other computer. Some platforms may ask to verify the new device.</span></div>
      <div class="set-c"><div class="set-pair"><Btn size="sm" icon="download" :disabled="!brands.data.value?.length" @click="openPick">Export brands…</Btn><Btn size="sm" icon="upload" @click="importBrandFile()">Import .brand…</Btn></div></div>
    </div>

    <SaveBar :show="dirty" :busy="busy" :disabled="!cronOk || !(form.backup.keep >= 1)" @save="save('Backup settings saved')" @discard="discard" />

    <Modal :open="passOpen" title="Backup passphrase" size="sm" @update:open="v => (passOpen = v)">
      <form class="col gap-4" @submit.prevent="savePass">
        <p class="small muted">New backups use this passphrase. Older backups still need the passphrase they were made with.</p>
        <Field label="Passphrase" :error="bp1 && bp1.length < 8 ? 'At least 8 characters' : null"><input v-model="bp1" type="password" class="input" autocomplete="new-password" autofocus /></Field>
        <Field label="Repeat" :error="bp2 && bp1 !== bp2 ? 'Does not match' : null"><input v-model="bp2" type="password" class="input" autocomplete="new-password" /></Field>
        <button type="submit" hidden />
      </form>
      <template #footer><Btn variant="subtle" @click="passOpen = false">Cancel</Btn><Btn variant="primary" :loading="passBusy" :disabled="!bpReady" @click="savePass">Save passphrase</Btn></template>
    </Modal>

    <Modal :open="pickOpen" title="Export brands" size="sm" @update:open="v => (pickOpen = v)">
      <div class="row between mb-3"><span class="small muted">{{ picked.size }} of {{ brands.data.value?.length ?? 0 }} selected</span><button type="button" class="link small" @click="picked.size === (brands.data.value?.length ?? 0) ? (picked = new Set()) : openPick()">{{ picked.size === (brands.data.value?.length ?? 0) ? 'Select none' : 'Select all' }}</button></div>
      <ul class="pick">
        <li v-for="b in brands.data.value ?? []" :key="b.id"><label><input type="checkbox" :checked="picked.has(b.id)" @change="togglePick(b.id)" /><BrandAvatar :brand="b" :size="24" /><span class="grow ellipsis" :title="b.name">{{ b.name }}</span><span class="tiny muted nowrap num">{{ b.accounts.length }} account{{ b.accounts.length === 1 ? '' : 's' }}</span></label></li>
      </ul>
      <template #footer><Btn variant="subtle" @click="pickOpen = false">Cancel</Btn><Btn variant="primary" :disabled="!picked.size" icon-right="arrow" @click="toExport">Next</Btn></template>
    </Modal>
    <ExportBrandsModal :open="!!exportIds" :ids="exportIds ?? []" :names="exportNames" @update:open="v => !v && (exportIds = null)" />
  </div>
</template>

<style scoped>
.w { width: 100%; max-width: 460px; }
.nowrap-pair { flex-wrap: nowrap; }
.nowrap-pair .input { cursor: pointer; }
.warn { color: var(--warn); }
.full { align-items: stretch; }
.bl { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); }
.bl li { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px; }
.bl li + li { border-top: 1px solid var(--line-soft); }
.bl .grow { min-width: 0; }
.bl .num { white-space: nowrap; }
.pick { max-height: 340px; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--r-lg); }
.pick li + li { border-top: 1px solid var(--line-soft); }
.pick label { display: flex; align-items: center; gap: 10px; padding: 9px 12px; cursor: pointer; }
.pick input { accent-color: var(--fg); width: 15px; height: 15px; }
</style>
