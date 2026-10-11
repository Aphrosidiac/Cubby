<script setup lang="ts">
// Quick switcher window (PLAN 6.13): global hotkey → type "asc" → Enter → that brand's Chrome opens
// or comes to the front. Frameless, transparent 600×440 window; Esc or losing focus closes it.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BrandRow } from '@shared/types';
import Icon from '@/components/ui/Icon.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import AccountBadge from '@/components/common/AccountBadge.vue';
import { rankBrands } from '@/components/common/fuzzy';
import { accountTip, serialText, STATUS_LABEL } from '@/components/common/login';
import { api, on } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';

const q = ref('');
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const busy = ref<string | null>(null);
const err = ref<string | null>(null);
const brands = useLoad(() => api('brands.list', {}), { topics: ['brands.changed'] });
const off = on('brand.status', ({ id, status }) => { if (brands.data.value) brands.data.value = brands.data.value.map(b => (b.id === id ? { ...b, status } : b)); });
// open brands first when there is no query: that's usually where you want to jump
const shown = computed(() => {
  const all = brands.data.value ?? [];
  if (!q.value.trim()) return [...all].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
  return rankBrands(all, q.value);
});
watch(q, () => { active.value = 0; err.value = null; });
watch(active, () => void nextTick(() => listEl.value?.querySelector('.it.act')?.scrollIntoView({ block: 'nearest' })));

const close = () => window.cubby?.closeSwitcher?.();
function newBrand() { api('app.showInMain', { path: '/brands/new' }).then(close).catch(x => (err.value = (x as Error).message)); }
async function go(b: BrandRow | undefined) {
  if (!b || busy.value) return;
  busy.value = b.id;
  err.value = null;
  try {
    if (b.status === 'open') await api('brands.front', { id: b.id });
    else await api('brands.open', { id: b.id });
    close();
  } catch (e) { err.value = (e as Error).message; } finally { busy.value = null; }
}
function key(e: KeyboardEvent) {
  const n = shown.value.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); if (n) active.value = (active.value + 1) % n; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) active.value = (active.value - 1 + n) % n; }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const b = shown.value[active.value]; if (b) api('app.showInMain', { path: `/brands/${b.id}` }).catch(x => (err.value = (x as Error).message)); }
  else if (e.key === 'Enter') { e.preventDefault(); void go(shown.value[active.value]); }
  else if (e.key === 'Escape') { e.preventDefault(); if (q.value) q.value = ''; else close(); }
  else if (e.key === 'Tab') e.preventDefault();
}
const refocus = () => input.value?.focus();
onMounted(() => {
  // the window itself is transparent: only the rounded panel paints
  document.documentElement.classList.add('switcher-win');
  setTimeout(refocus, 30);
  window.addEventListener('focus', refocus);
});
onBeforeUnmount(() => {
  off();
  window.removeEventListener('focus', refocus);
  document.documentElement.classList.remove('switcher-win');
});
</script>

<template>
  <div class="sw-root">
    <div class="panel-sw" role="dialog" aria-label="Quick switcher" @keydown="key">
      <label class="inp">
        <Icon name="search" :size="18" />
        <input ref="input" v-model="q" placeholder="Jump to a brand…" spellcheck="false" autocomplete="off" aria-label="Brand" />
        <kbd>Esc</kbd>
      </label>
      <ul ref="listEl" class="list" role="listbox">
        <template v-if="brands.loading.value">
          <li v-for="i in 4" :key="i" class="it"><div class="skel" style="width: 32px; height: 32px; border-radius: 8px" /><div class="skel-line" :style="{ width: `${100 + i * 30}px` }" /></li>
        </template>
        <li v-else-if="brands.error.value" class="none">Could not load brands — {{ brands.error.value }}</li>
        <li v-else-if="!brands.data.value?.length" class="none">
          <span>No brands yet.</span>
          <button type="button" class="link" @mousedown.prevent="newBrand">Create one in Cubby</button>
        </li>
        <li v-else-if="!shown.length" class="none">No brand matches “{{ q }}”.</li>
        <li v-for="(b, i) in shown" :key="b.id" class="it" :class="{ act: i === active }" role="option" :aria-selected="i === active" @mouseenter="active = i" @mousedown.prevent="go(b)">
          <BrandAvatar :brand="b" :size="32" />
          <div class="grow">
            <div class="nm"><span class="ellipsis" :title="b.name">{{ b.name }}</span><span class="code muted ser">{{ serialText(b.serial) }}</span></div>
            <div class="ac">
              <AccountBadge v-for="a in b.accounts.slice(0, 6)" :key="a.id" :account="a" :size="13" />
              <span v-if="b.accounts.length > 6" class="more-n num" :title="b.accounts.slice(6).map(accountTip).join('\n')">+{{ b.accounts.length - 6 }}</span>
              <span v-if="b.groupName" class="tiny muted ellipsis" :class="{ gap: b.accounts.length }">{{ b.groupName }}</span>
              <span v-else-if="!b.accounts.length" class="tiny muted">No accounts</span>
            </div>
          </div>
          <span class="st" :class="`s-${b.status}`"><span v-if="busy === b.id" class="spin" /><span v-else class="d" />{{ busy === b.id ? 'Opening…' : STATUS_LABEL[b.status] }}</span>
          <span class="go">{{ b.status === 'open' ? 'Front' : 'Open' }} <kbd>↵</kbd></span>
        </li>
      </ul>
      <footer class="ft">
        <span v-if="err" class="bad ellipsis">{{ err }}</span>
        <template v-else><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open or bring to front</span><span><kbd>Ctrl</kbd><kbd>↵</kbd> show in Cubby</span><span><kbd>Esc</kbd> close</span></template>
      </footer>
    </div>
  </div>
</template>

<style>
html.switcher-win, html.switcher-win body { background: transparent !important; overflow: hidden; }
</style>

<style scoped>
.sw-root { position: fixed; inset: 0; padding: 14px; display: flex; }
.panel-sw { flex: 1; display: flex; flex-direction: column; min-height: 0; border-radius: 16px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 18px 50px -12px rgb(0 0 0 / .45), 0 2px 8px rgb(0 0 0 / .12); overflow: hidden; animation: ff-pop .28s var(--ease-out) both; }
.inp { display: flex; align-items: center; gap: 12px; height: 62px; padding: 0 16px 0 20px; border-bottom: 1px solid var(--line); color: var(--muted); flex: none; }
.inp input { flex: 1; min-width: 0; border: 0; background: none; outline: none; font-size: var(--fs-xl); font-weight: 500; letter-spacing: -.01em; color: var(--fg); }
.inp input:focus-visible { outline: none; box-shadow: none; }
.inp input::placeholder { color: var(--faint); font-weight: 400; }
.list { flex: 1; overflow-y: auto; padding: 6px; }
.it { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 10px; cursor: pointer; min-height: 54px; }
.it.act { background: var(--panel-2); }
.nm { display: flex; align-items: baseline; gap: 8px; font-weight: 600; min-width: 0; }
.ser { flex: none; font-weight: 400; }
.ac { display: flex; align-items: center; gap: 4px; margin-top: 3px; min-width: 0; min-height: 20px; }
.ac :deep(.ab) { width: 20px; height: 20px; border-radius: 5px; }
.ac .gap { margin-left: 4px; }
.more-n { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 3px; border-radius: 5px; box-shadow: inset 0 0 0 1px var(--line); font-family: var(--mono); font-size: var(--fs-2xs); color: var(--muted); }
.st { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; }
.st .d { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); }
.s-open { color: var(--good); } .s-open .d { background: var(--good); }
.s-error { color: var(--bad); } .s-error .d { background: var(--bad); }
.s-opening { color: var(--info); }
.spin { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: ff-spin .7s linear infinite; }
.go { display: none; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--fg-2); white-space: nowrap; }
.it.act .go { display: inline-flex; }
.it.act .st { display: none; }
.none { display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; padding: 28px 16px; text-align: center; color: var(--muted); font-size: var(--fs-sm); }
.none .link { color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }
.ft { display: flex; align-items: center; gap: 16px; height: 38px; padding: 0 16px; border-top: 1px solid var(--line-soft); font-size: var(--fs-xs); color: var(--muted); flex: none; }
.ft span { display: inline-flex; align-items: center; gap: 4px; }
.ft .bad { color: var(--bad); display: block; }
kbd { padding: 1px 5px; }
</style>
