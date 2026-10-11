<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BrandRow, CookieInfo, Platform } from '@shared/types';
import { PLATFORMS } from '@shared/types';
import { PLATFORM_SPECS, platformOfUrl } from '@shared/platforms';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Modal from '@/components/ui/Modal.vue';
import Field from '@/components/ui/Field.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import LoadError from '@/components/common/LoadError.vue';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail, ok, toast } from '@/composables/toast';
import { ago, dateTime } from '@/lib/format';

/** Cookies by site — names and expiry only, values never leave the main process. Export / import (encrypted) and clear per platform. */
const props = defineProps<{ brand: BrandRow }>();
// reading cookies needs the brand's Chrome: closed brands are only opened (in the background) on request
const wanted = ref(props.brand.status === 'open');
const list = useLoad<CookieInfo[] | null>(() => (wanted.value ? api('cookies.list', { brandId: props.brand.id }) : Promise.resolve(null)), { topics: ['accounts.changed'] });
function loadNow() { wanted.value = true; void list.reload(); }
const q = ref('');
const openDomains = ref(new Set<string>());
interface Site { domain: string; cookies: CookieInfo[]; session: number; latest: string | null; soonest: string | null; platform: Platform | null }
const sites = computed<Site[]>(() => {
  const by = new Map<string, CookieInfo[]>();
  for (const c of list.data.value ?? []) { const d = c.domain.replace(/^\./, ''); (by.get(d) ?? by.set(d, []).get(d)!).push(c); }
  const t = q.value.trim().toLowerCase();
  return [...by.entries()]
    .filter(([d, cs]) => !t || d.includes(t) || cs.some(c => c.name.toLowerCase().includes(t)))
    .map(([domain, cookies]) => {
      const exp = cookies.map(c => c.expires).filter((x): x is string => !!x).sort();
      return { domain, cookies, session: cookies.filter(c => !c.expires).length, soonest: exp[0] ?? null, latest: exp[exp.length - 1] ?? null, platform: platformOfUrl(`https://${domain}`) };
    })
    .sort((a, b) => (a.platform ? 0 : 1) - (b.platform ? 0 : 1) || b.cookies.length - a.cookies.length);
});
function toggle(d: string) { const s = new Set(openDomains.value); if (s.has(d)) s.delete(d); else s.add(d); openDomains.value = s; }

// ── export ──
const exp = ref(false);
const p1 = ref(''); const p2 = ref(''); const busy = ref<string | null>(null);
const expReady = computed(() => p1.value.length >= 8 && p1.value === p2.value);
async function doExport() {
  if (!expReady.value) return;
  busy.value = 'export';
  try {
    const [path] = await api('app.pickFiles', { save: true, defaultPath: `${props.brand.slug}-cookies-${new Date().toISOString().slice(0, 10)}.cookies`, filters: [{ name: 'Encrypted cookies', extensions: ['cookies'] }] });
    if (!path) return;
    const r = await api('cookies.export', { brandId: props.brand.id, passphrase: p1.value, path });
    exp.value = false; p1.value = ''; p2.value = '';
    toast(`Exported ${r.count} cookies`, { tone: 'good', body: r.path, action: { label: 'Show file', run: () => void api('app.revealPath', { path: r.path }) } });
  } catch (e) { fail(e, 'Export failed'); } finally { busy.value = null; }
}
// ── import ──
async function doImport() {
  try {
    const [path] = await api('app.pickFiles', { filters: [{ name: 'Cookies', extensions: ['cookies', 'json'] }] });
    if (!path) return;
    let passphrase: string | undefined;
    if (!path.toLowerCase().endsWith('.json')) {
      const p = await confirm({ title: 'Import cookies', body: 'Enter the passphrase this file was exported with. Plain JSON cookie files (from extensions like EditThisCookie) need none.', confirm: 'Import', input: { label: 'Passphrase', password: true, required: false } });
      if (p === null) return;
      passphrase = p || undefined;
    }
    busy.value = 'import';
    const r = await api('cookies.import', { brandId: props.brand.id, path, passphrase });
    ok(`Imported ${r.count} cookies`, props.brand.status === 'open' ? 'Reload the brand’s tabs to use them.' : undefined);
    void list.reload(true);
  } catch (e) { fail(e, 'Import failed'); } finally { busy.value = null; }
}
// ── clear per platform ──
const clearMenu = computed(() => PLATFORMS.filter(p => p !== 'custom').map(p => ({ label: `${PLATFORM_SPECS[p].name}${props.brand.accounts.some(a => a.platform === p) ? '' : ' (no account)'}`, icon: 'trash', danger: true, run: () => void clear(p) })));
async function clear(p: Platform) {
  if (!(await confirm({ title: `Clear ${PLATFORM_SPECS[p].name} site data?`, body: `Deletes ${PLATFORM_SPECS[p].name}’s cookies in ${props.brand.name}. You will be logged out there and need to log in again.`, confirm: 'Clear and log out', danger: true }))) return;
  busy.value = `clear-${p}`;
  try { const r = await api('cookies.clear', { brandId: props.brand.id, platform: p }); ok(`Cleared ${r.count} ${PLATFORM_SPECS[p].name} cookies`); void list.reload(true); } catch (e) { fail(e, 'Could not clear'); } finally { busy.value = null; }
}
const isPast = (d: string | null) => !!d && new Date(d) < new Date();
</script>

<template>
  <div>
    <div class="bar">
      <label class="search"><Icon name="search" :size="14" /><input v-model="q" placeholder="Filter sites or cookie names" /></label>
      <span class="tiny muted grow">{{ list.data.value ? `${list.data.value.length} cookie${list.data.value.length === 1 ? '' : 's'} across ${sites.length} site${sites.length === 1 ? '' : 's'} · ` : '' }}values are never shown</span>
      <Btn size="sm" icon="refresh" variant="subtle" :loading="list.refreshing.value && !list.loading.value" @click="wanted ? list.reload(true) : loadNow()">Refresh</Btn>
      <Btn size="sm" icon="upload" :loading="busy === 'import'" @click="doImport">Import</Btn>
      <Btn size="sm" icon="download" @click="exp = true">Export</Btn>
      <Menu :items="clearMenu" :width="230">
        <Btn size="sm" variant="danger" icon="trash" icon-right="chevron-down">Clear site data</Btn>
      </Menu>
    </div>

    <div v-if="!wanted" class="panel closed">
      <Icon name="cookie" :size="20" class="faint" />
      <div class="grow"><div class="strong small">{{ brand.name }} is closed</div><div class="tiny muted">Reading its cookies opens the brand in the background for a moment, then closes it again.</div></div>
      <Btn size="sm" icon="refresh" @click="loadNow">Load cookies</Btn>
    </div>
    <LoadError v-else-if="list.error.value" :error="list.error.value" title="Could not read this brand’s cookies" @retry="list.reload()" />
    <div v-else-if="list.loading.value" class="panel"><div v-for="i in 5" :key="i" class="site"><div class="skel-line" :style="{ width: `${30 + i * 8}%` }" /></div></div>
    <EmptyState v-else-if="!sites.length" icon="cookie" :title="q ? 'No matching cookies' : 'No cookies yet'" :body="q ? undefined : 'Open the brand and log in to its platforms — their sessions appear here.'" />
    <div v-else class="panel">
      <div v-for="s in sites" :key="s.domain" class="site-wrap">
        <button type="button" class="site" :aria-expanded="openDomains.has(s.domain)" @click="toggle(s.domain)">
          <Icon name="chevron" :size="13" class="chev" :class="{ open: openDomains.has(s.domain) }" />
          <PlatformIcon v-if="s.platform" :platform="s.platform" :size="16" colored />
          <Icon v-else name="globe" :size="16" class="faint" />
          <span class="strong small grow ellipsis">{{ s.domain }}</span>
          <span class="tiny muted num">{{ s.cookies.length }} cookie{{ s.cookies.length === 1 ? '' : 's' }}{{ s.session ? ` · ${s.session} session` : '' }}</span>
          <span class="tiny exp" :class="{ bad: isPast(s.latest) }" :title="s.latest ? dateTime(s.latest) : undefined">{{ s.latest ? `${isPast(s.latest) ? 'expired' : 'expires'} ${ago(s.latest)}` : 'session only' }}</span>
        </button>
        <Transition name="slide-down">
          <div v-if="openDomains.has(s.domain)">
            <table class="ck">
              <tbody>
                <tr v-for="c in s.cookies" :key="c.name + c.domain"><td class="code">{{ c.name }}</td><td class="tiny muted">{{ c.domain }}</td><td class="tiny">{{ c.httpOnly ? 'HttpOnly' : '' }} {{ c.secure ? 'Secure' : '' }}</td><td class="tiny right" :class="{ bad: isPast(c.expires) }" :title="c.expires ? dateTime(c.expires) : undefined">{{ c.expires ? ago(c.expires) : 'Session' }}</td></tr>
              </tbody>
            </table>
          </div>
        </Transition>
      </div>
    </div>

    <Modal :open="exp" title="Export cookies" eyebrow="Encrypted file" size="sm" @update:open="v => (exp = v)">
      <form class="col gap-4" @submit.prevent="doExport">
        <p class="small muted">Saves every cookie of {{ brand.name }} to a file encrypted with this passphrase. Anyone with the file and passphrase can use these logins — keep both safe.</p>
        <Field label="Passphrase" :error="p1 && p1.length < 8 ? 'At least 8 characters' : null"><input v-model="p1" type="password" class="input" autocomplete="new-password" autofocus /></Field>
        <Field label="Repeat passphrase" :error="p2 && p1 !== p2 ? 'Does not match' : null"><input v-model="p2" type="password" class="input" autocomplete="new-password" /></Field>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <Btn variant="subtle" @click="exp = false">Cancel</Btn>
        <Btn variant="primary" icon="download" :disabled="!expReady" :loading="busy === 'export'" @click="doExport">Choose where to save…</Btn>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.search { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--muted); width: 240px; }
.search:focus-within { border-color: var(--focus-border); }
.search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; font-size: var(--fs-sm); color: var(--fg); }
.search input:focus-visible { box-shadow: none; outline: none; }
.site-wrap + .site-wrap { border-top: 1px solid var(--line-soft); }
.site { width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 18px; text-align: left; transition: background-color 140ms; }
button.site:hover { background: var(--panel-hover); }
.chev { color: var(--muted); transition: transform 260ms var(--ease-out); }
.chev.open { transform: rotate(90deg); }
.exp { min-width: 110px; text-align: right; color: var(--fg-2); }
.bad { color: var(--bad) !important; }
.ck { width: 100%; margin: 0 0 8px; }
.closed { display: flex; align-items: center; gap: 14px; padding: 16px 18px; }
.ck td { padding: 6px 18px 6px 0; border-top: 1px solid var(--line-soft); }
.ck td:first-child { padding-left: 64px; }
</style>
