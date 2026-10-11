<script setup lang="ts">
// Command palette (⌘/Ctrl K): fuzzy search brands (name, handle, tag, serial) → Enter opens or
// fronts the brand's window, Shift+Enter shows it in Cubby; plus pages and app actions.
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { BrandRow } from '@shared/types';
import Icon from '../ui/Icon.vue';
import BrandAvatar from '../common/BrandAvatar.vue';
import PlatformIcon from '../common/PlatformIcon.vue';
import { fuzzyScore, rankBrands } from '../common/fuzzy';
import { accountTip, serialText, STATUS_LABEL } from '../common/login';
import { useBrandActions } from '../brands/actions';
import { importBrandFile, pickCsvAndCreate } from '../brands/importers';
import { NAV, NAV_FOOT } from '@/lib/nav';
import { api, modKey } from '@/lib/api';
import { app, setTheme } from '@/lib/store';
import { confirm } from '@/composables/confirm';
import { fail, ok, toast } from '@/composables/toast';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [v: boolean] }>();
const router = useRouter();
const act = useBrandActions();
const q = ref('');
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const brands = ref<BrandRow[] | null>(null);
const loadErr = ref<string | null>(null);

// focus goes back to whatever had it before the palette opened (unless an action moved it)
let returnTo: HTMLElement | null = null;
watch(() => props.open, async o => {
  if (!o) {
    const el = returnTo;
    returnTo = null;
    setTimeout(() => {
      const a = document.activeElement;
      if (el?.isConnected && (!a || a === document.body || a.closest('.cp-root'))) el.focus({ preventScroll: true });
    }, 0);
    return;
  }
  returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  q.value = '';
  active.value = 0;
  await nextTick();
  input.value?.focus();
  try { brands.value = await api('brands.list', {}); loadErr.value = null; } catch (e) { loadErr.value = (e as Error).message; }
});
const close = () => emit('update:open', false);

interface Item { key: string; kind: 'brand' | 'action' | 'page'; label: string; sub?: string; icon?: string; hint?: string; brand?: BrandRow; run: (shift?: boolean) => void | Promise<unknown> }
async function killSwitch() {
  if (app.status?.killSwitch) { app.status = await api('app.killSwitch', { on: false }); ok('Automation resumed'); return; }
  if (!(await confirm({ title: 'Stop all automation?', body: 'Aborts every running recipe, flow and Claude action now. Nothing new runs until you resume.', confirm: 'Stop everything', danger: true }))) return;
  app.status = await api('app.killSwitch', { on: true });
  toast('Everything stopped', { tone: 'warn' });
}
const guard = (fn: () => Promise<unknown>, title?: string) => () => fn().catch(e => fail(e, title));
const ACTIONS = computed<Item[]>(() => [
  { key: 'a-new', kind: 'action', label: 'New brand', icon: 'plus', hint: 'N B', run: () => router.push('/brands/new') },
  { key: 'a-compose', kind: 'action', label: 'Compose a post', icon: 'compose', hint: 'N P', run: () => router.push('/compose') },
  { key: 'a-kill', kind: 'action', label: app.status?.killSwitch ? 'Resume automation' : 'Stop all automation', sub: app.status?.killSwitch ? 'Kill switch is on' : 'Kill switch — aborts every run', icon: app.status?.killSwitch ? 'play' : 'stop', run: guard(killSwitch) },
  { key: 'a-tile', kind: 'action', label: 'Tile open brand windows', icon: 'tile', run: guard(() => api('brands.arrange', { mode: 'tile' }), 'Could not tile') },
  { key: 'a-cascade', kind: 'action', label: 'Cascade open brand windows', icon: 'cascade', run: guard(() => api('brands.arrange', { mode: 'cascade' }), 'Could not cascade') },
  { key: 'a-closeall', kind: 'action', label: 'Close all brand windows', icon: 'close', run: guard(async () => { if (await confirm({ title: 'Close every open brand window?', confirm: 'Close all' })) await api('brands.closeAll'); }) },
  { key: 'a-health', kind: 'action', label: 'Check every login now', icon: 'pulse', run: guard(async () => { const r = await api('health.check', {}); const bad = r.filter(a => a.loginState === 'expired').length; if (bad) toast(`${bad} login${bad === 1 ? '' : 's'} need relogin`, { tone: 'warn' }); else ok(`Checked ${r.length} logins`); }, 'Health check failed') },
  { key: 'a-csv', kind: 'action', label: 'Batch create brands from CSV…', icon: 'file', run: () => pickCsvAndCreate() },
  { key: 'a-import', kind: 'action', label: 'Import a .brand export…', icon: 'upload', run: () => importBrandFile() },
  { key: 'a-theme', kind: 'action', label: app.settings?.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: app.settings?.theme === 'dark' ? 'sun' : 'moon', run: () => setTheme(app.settings?.theme === 'dark' ? 'light' : 'dark') },
  { key: 'a-backup', kind: 'action', label: 'Back up now', icon: 'backup', run: guard(async () => { const r = await api('backup.run', {}); ok('Backup saved', r.path); }, 'Backup failed') }
]);
const PAGES = computed<Item[]>(() => [...NAV.flatMap(g => g.items), ...NAV_FOOT].map(it => ({ key: `p-${it.to}`, kind: 'page' as const, label: it.label, icon: it.icon, hint: it.shortcut?.toUpperCase(), run: () => router.push(it.to) })));

const brandItem = (b: BrandRow): Item => ({
  key: `b-${b.id}`, kind: 'brand', label: b.name, brand: b,
  run: shift => (shift ? router.push(`/brands/${b.id}`) : act.openOrFront(b))
});
const sections = computed(() => {
  const s = q.value.trim();
  const all = brands.value ?? [];
  const bs = s ? rankBrands(all, s).slice(0, 8) : [...all].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open')).slice(0, 6);
  // actions and pages need a real match (prefix, word, substring or tight letters), not three
  // letters scattered across a long label — "sun" must not offer "Stop all automation"
  const match = (it: Item) => !s || fuzzyScore(s, it.label) >= 10 || (it.sub ? fuzzyScore(s, it.sub) >= 40 : false);
  const rank = (xs: Item[]) => (s ? xs.filter(match).sort((a, b) => fuzzyScore(s, b.label) - fuzzyScore(s, a.label)) : xs);
  return [
    { title: 'Brands', items: bs.map(brandItem) },
    { title: 'Actions', items: rank(ACTIONS.value).slice(0, s ? 6 : 5) },
    { title: 'Go to', items: rank(PAGES.value).slice(0, s ? 5 : 12) }
  ].filter(x => x.items.length);
});
const flat = computed(() => sections.value.flatMap(s => s.items));
watch(q, () => (active.value = 0));
watch(active, () => void nextTick(() => listEl.value?.querySelector('.it.act')?.scrollIntoView({ block: 'nearest' })));

async function run(it: Item | undefined, shift = false) {
  if (!it) return;
  close();
  try { await it.run(shift); } catch (e) { fail(e); }
}
function key(e: KeyboardEvent) {
  const n = flat.value.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); if (n) active.value = (active.value + 1) % n; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) active.value = (active.value - 1 + n) % n; }
  else if (e.key === 'Enter') { e.preventDefault(); void run(flat.value[active.value], e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  else if (e.key === 'Tab') e.preventDefault();
}
const idxOf = (it: Item) => flat.value.indexOf(it);
</script>

<template>
  <Teleport to="body">
    <Transition name="cp">
      <div v-if="open" class="cp-root" @mousedown.self="close" @keydown="key">
        <div class="cp" role="dialog" aria-label="Command palette">
          <label class="inp">
            <Icon name="search" :size="18" />
            <input ref="input" v-model="q" placeholder="Search brands, handles, pages and actions…" spellcheck="false" autocomplete="off" aria-label="Search" />
            <kbd>Esc</kbd>
          </label>
          <div ref="listEl" class="list" role="listbox">
            <p v-if="loadErr" class="none">Could not load brands — {{ loadErr }}</p>
            <template v-for="s in sections" :key="s.title">
              <div class="grp label">{{ s.title }}</div>
              <div v-for="it in s.items" :key="it.key" class="it" :class="{ act: idxOf(it) === active }" role="option" :aria-selected="idxOf(it) === active"
                @mouseenter="active = idxOf(it)" @mousedown.prevent="run(it, $event.shiftKey)">
                <template v-if="it.brand">
                  <BrandAvatar :brand="it.brand" :size="28" />
                  <div class="grow">
                    <div class="nm"><span class="ellipsis" :title="it.brand.name">{{ it.brand.name }}</span><span class="code muted ser">{{ serialText(it.brand.serial) }}</span></div>
                    <div class="ac tiny muted"><PlatformIcon v-for="a in it.brand.accounts.slice(0, 6)" :key="a.id" :platform="a.platform" :size="12" :title="accountTip(a)" /><span v-if="it.brand.accounts.length > 6" class="num">+{{ it.brand.accounts.length - 6 }}</span><span v-if="it.brand.groupName" class="ellipsis">{{ it.brand.groupName }}</span><span v-if="it.brand.accounts.some(a => a.loginState === 'expired')" class="relog nowrap">needs relogin</span></div>
                  </div>
                  <span class="st" :class="`s-${it.brand.status}`">{{ STATUS_LABEL[it.brand.status] }}</span>
                  <span class="go"><span>{{ it.brand.status === 'open' ? 'Front' : 'Open' }}</span><kbd>↵</kbd><span class="sep">·</span><span>Page</span><kbd>⇧↵</kbd></span>
                </template>
                <template v-else>
                  <span class="ic"><Icon :name="it.icon ?? 'arrow'" :size="16" /></span>
                  <div class="grow"><div class="lbl">{{ it.label }}</div><div v-if="it.sub" class="tiny muted">{{ it.sub }}</div></div>
                  <kbd v-if="it.hint" class="keys">{{ it.hint }}</kbd>
                </template>
              </div>
            </template>
            <p v-if="!flat.length && !loadErr" class="none">Nothing matches “{{ q }}”.</p>
          </div>
          <footer class="ft"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⇧↵</kbd> brand page</span><span class="grow" /><span><kbd>{{ modKey }} K</kbd> toggle</span></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cp-root { position: fixed; inset: 0; z-index: 1000; display: flex; justify-content: center; align-items: flex-start; padding: 12vh 16px 16px; background: var(--scrim); }
.cp { width: min(640px, 100%); max-height: min(560px, 76vh); display: flex; flex-direction: column; border-radius: 14px; background: var(--bg); border: 1px solid var(--line); box-shadow: var(--shadow-3); overflow: hidden; }
.inp { display: flex; align-items: center; gap: 12px; height: 58px; padding: 0 16px 0 20px; border-bottom: 1px solid var(--line); color: var(--muted); flex: none; }
.inp input { flex: 1; min-width: 0; border: 0; background: none; outline: none; font-size: var(--fs-lg); color: var(--fg); }
.inp input:focus-visible { outline: none; box-shadow: none; }
.inp input::placeholder { color: var(--faint); }
.list { overflow-y: auto; padding: 4px 6px 8px; }
.grp { padding: 12px 10px 6px; }
.it { display: flex; align-items: center; gap: 12px; padding: 7px 10px; border-radius: 9px; cursor: pointer; min-height: 44px; }
.it.act { background: var(--panel-2); }
.nm { display: flex; align-items: baseline; gap: 8px; font-weight: 600; min-width: 0; }
.ser { flex: none; font-weight: 400; }
.ac { display: flex; align-items: center; gap: 6px; margin-top: 3px; min-width: 0; }
.ac .pi { flex: none; }
.relog { color: var(--bad); }
.ic { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; background: var(--panel-2); color: var(--fg-2); flex: none; }
.it.act .ic { background: var(--fg); color: var(--bg); }
.lbl { font-weight: 500; }
.st { font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; }
.s-open { color: var(--good); } .s-error { color: var(--bad); } .s-opening { color: var(--info); }
.go { display: none; align-items: center; gap: 5px; font-size: var(--fs-xs); color: var(--fg-2); white-space: nowrap; }
.go .sep { color: var(--muted); }
.it.act .go { display: inline-flex; }
.it.act .st { display: none; }
.none { padding: 26px; text-align: center; color: var(--muted); font-size: var(--fs-sm); }
.ft { display: flex; align-items: center; gap: 14px; height: 36px; padding: 0 16px; border-top: 1px solid var(--line-soft); font-size: var(--fs-xs); color: var(--muted); flex: none; }
.ft span { display: inline-flex; align-items: center; gap: 4px; }
kbd { padding: 1px 5px; }
.cp-enter-active { transition: opacity 200ms var(--ease-out); }
.cp-enter-active .cp { transition: transform 320ms var(--ease-out), opacity 220ms var(--ease-out); }
.cp-leave-active { transition: opacity 140ms var(--ease-cut); }
.cp-enter-from { opacity: 0; }
.cp-enter-from .cp { transform: translateY(-8px) scale(.98); opacity: 0; }
.cp-leave-to { opacity: 0; }
</style>
