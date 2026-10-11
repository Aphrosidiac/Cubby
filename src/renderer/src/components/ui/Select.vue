<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';

/**
 * The dropdown. Every choice-from-a-list in the app uses this instead of a
 * native <select>: same look in every browser and theme, groups, a search box
 * once the list is long, and the keyboard a select has (↑ ↓ Home End, Enter,
 * Esc, type a letter to jump). The list is teleported to <body> and placed
 * against the trigger, so modals and scrolling panels never clip it.
 */
export interface SelectOption { value: string | number | null; label: string; sub?: string | null; group?: string; disabled?: boolean }
type V = string | number | null | undefined;
const props = withDefaults(defineProps<{
  modelValue: V; options: SelectOption[]; placeholder?: string; disabled?: boolean;
  /** field = full-width form control; pill = toolbar filter; sm = compact field */
  variant?: 'field' | 'pill' | 'sm'; searchable?: boolean; id?: string; ariaLabel?: string; minWidth?: number;
}>(), { placeholder: 'Choose…', variant: 'field', searchable: undefined });
const emit = defineEmits<{ 'update:modelValue': [v: any]; change: [v: any] }>();

const open = ref(false);
const q = ref('');
const active = ref(-1);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const popEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const current = computed(() => props.options.find(o => o.value === props.modelValue) ?? null);
const withSearch = computed(() => props.searchable ?? props.options.length > 10);
const shown = computed(() => {
  const t = q.value.trim().toLowerCase();
  return t ? props.options.filter(o => `${o.label} ${o.sub ?? ''} ${o.group ?? ''}`.toLowerCase().includes(t)) : props.options;
});
/** Rows to draw: group headers interleaved with options (index = position in `shown`). */
const rows = computed(() => {
  const out: ({ head: string } | { o: SelectOption; i: number })[] = [];
  let g: string | undefined;
  shown.value.forEach((o, i) => { if (o.group && o.group !== g) { out.push({ head: o.group }); g = o.group; } out.push({ o, i }); });
  return out;
});
const enabled = (i: number) => !!shown.value[i] && !shown.value[i].disabled;

function step(from: number, dir: 1 | -1) {
  const n = shown.value.length;
  for (let k = 1; k <= n; k++) { const i = (from + dir * k + n) % n; if (enabled(i)) return i; }
  return from;
}
function reveal() { void nextTick(() => listEl.value?.querySelector<HTMLElement>('.opt.act')?.scrollIntoView({ block: 'nearest' })); }

function show() {
  if (props.disabled || open.value) return;
  q.value = '';
  open.value = true;
  const sel = shown.value.findIndex(o => o.value === props.modelValue);
  active.value = sel >= 0 ? sel : step(-1, 1);
  reveal();
  if (withSearch.value && !touch) setTimeout(() => search.value?.focus(), 20);
}
function close(focusTrigger = true) { open.value = false; if (focusTrigger) trigger.value?.focus(); }
/** A keyboard pick hands focus back to the trigger; a click does not (no stray focus ring). */
function pick(o: SelectOption, viaKey = false) {
  if (o.disabled) return;
  if (o.value !== props.modelValue) { emit('update:modelValue', o.value); emit('change', o.value); }
  close(viaKey);
}

let typed = '', typedAt = 0;
function key(e: KeyboardEvent) {
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
    return;
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); active.value = step(active.value, 1); reveal(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = step(active.value, -1); reveal(); }
  else if (e.key === 'Home') { e.preventDefault(); active.value = step(-1, 1); reveal(); }
  else if (e.key === 'End') { e.preventDefault(); active.value = step(shown.value.length, -1); reveal(); }
  else if (e.key === 'Enter' || (e.key === ' ' && !withSearch.value)) { e.preventDefault(); const o = shown.value[active.value]; if (o) pick(o, true); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  else if (e.key === 'Tab') close(false);
  else if (!withSearch.value && e.key.length === 1 && /\S/.test(e.key)) {
    // type-ahead, like a native select
    typed = Date.now() - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
    typedAt = Date.now();
    const i = shown.value.findIndex((o, j) => enabled(j) && o.label.toLowerCase().startsWith(typed));
    if (i >= 0) { active.value = i; reveal(); }
  }
}
watch(q, () => { active.value = step(-1, 1); });

const pos = ref({ top: 0, left: 0, width: 0, up: false, max: 300 });
function place() {
  const r = root.value?.getBoundingClientRect();
  if (!r) return;
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const below = vh - r.bottom - 12, above = r.top - 12;
  const up = below < 220 && above > below;
  const width = Math.min(Math.max(r.width, props.minWidth ?? 200), vw - 16);
  pos.value = { top: up ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, vw - 8 - width)), width, up, max: Math.max(160, Math.min(320, (up ? above : below) - 8)) };
}
const outside = (e: MouseEvent) => { const t = e.target as Node; if (root.value?.contains(t) || popEl.value?.contains(t)) return; close(false); };
function listen(on: boolean) {
  const f = on ? 'addEventListener' : 'removeEventListener';
  document[f]('mousedown', outside as EventListener); window[f]('scroll', place, true); window[f]('resize', place);
}
watch(open, o => { if (o) { place(); setTimeout(() => listen(true), 0); } else listen(false); });
onBeforeUnmount(() => listen(false));
</script>

<template>
  <div ref="root" class="ff-select" :class="[`v-${variant}`, { open, disabled }]">
    <button :id="id" ref="trigger" type="button" class="trigger" :class="variant === 'pill' ? 'pill' : 'input'" :disabled="disabled"
      role="combobox" aria-haspopup="listbox" :aria-expanded="open" :aria-label="ariaLabel" @click="open ? close(false) : show()" @keydown="key">
      <span v-if="current" class="val ellipsis">{{ current.label }}</span>
      <span v-else class="ph ellipsis">{{ placeholder }}</span>
      <Icon name="chevron-down" :size="14" class="chev" />
    </button>
    <Teleport to="body">
      <Transition name="pop">
        <div v-if="open" ref="popEl" class="ff-select-pop" :class="{ up: pos.up }" :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }" @keydown="key">
          <div v-if="withSearch" class="search"><Icon name="search" :size="15" /><input ref="search" v-model="q" placeholder="Search…" aria-label="Search options" /></div>
          <ul ref="listEl" class="opts" role="listbox" :style="{ maxHeight: `${pos.max}px` }">
            <template v-for="r in rows" :key="'head' in r ? `h:${r.head}` : `o:${String(r.o.value)}`">
              <li v-if="'head' in r" class="grp" role="presentation">{{ r.head }}</li>
              <li v-else class="opt" role="option" :aria-selected="r.o.value === modelValue" :aria-disabled="r.o.disabled || undefined"
                :class="{ act: r.i === active, sel: r.o.value === modelValue, off: r.o.disabled }" @mouseenter="!r.o.disabled && (active = r.i)" @mousedown.prevent="pick(r.o)">
                <div class="grow"><div class="ellipsis">{{ r.o.label }}</div><div v-if="r.o.sub" class="sub ellipsis">{{ r.o.sub }}</div></div>
                <Icon v-if="r.o.value === modelValue" name="check" :size="14" class="tick" />
              </li>
            </template>
            <li v-if="!shown.length" class="none">{{ q ? 'No matches' : 'Nothing to choose' }}</li>
          </ul>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ff-select { position: relative; min-width: 0; }
.trigger { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; cursor: pointer; }
.trigger:disabled { cursor: not-allowed; }
.val { flex: 1; min-width: 0; } .ph { flex: 1; min-width: 0; color: var(--faint); }
.chev { flex: none; color: var(--muted); transition: transform 300ms var(--ease-out); }
.open .chev { transform: rotate(180deg); }
.open .trigger.input { border-color: var(--focus-border); box-shadow: var(--focus-ring); }
/* the field look rings on any focus; a dropdown only rings for the keyboard */
.trigger.input:focus:not(:focus-visible) { box-shadow: none; }
.ff-select:not(.open) .trigger.input:focus:not(:focus-visible) { border-color: var(--line); }
.v-sm .trigger { min-height: 34px; padding-top: 5px; padding-bottom: 5px; }
/* toolbar filter: a pill like the search field beside it */
.pill { height: 40px; padding: 0 14px 0 16px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--fg); font-size: var(--fs-base); transition: border-color var(--t-micro); }
.pill:hover { border-color: var(--line-strong); }
.open .pill, .pill:focus-visible { border-color: var(--focus-border); }
.v-pill { width: auto; }
.disabled { opacity: .6; }
</style>

<style>
/* teleported: not scoped */
.ff-select-pop { -webkit-app-region: no-drag; position: fixed; z-index: 1100; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow-2); overflow: hidden; }
.ff-select-pop.up { transform: translateY(-100%); }
.ff-select-pop .search { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); color: var(--muted); }
.ff-select-pop .search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--fg); font-size: var(--fs-base); }
/* the search row is the field: no ring on the bare input inside it */
.ff-select-pop .search input:focus, .ff-select-pop .search input:focus-visible { outline: none; box-shadow: none; }
.ff-select-pop .search:focus-within { color: var(--fg); }
.ff-select-pop .opts { overflow-y: auto; padding: 5px; margin: 0; list-style: none; }
.ff-select-pop .opt { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: var(--fs-base); color: var(--fg); }
.ff-select-pop .opt.act { background: var(--panel-2); }
.ff-select-pop .opt.sel { font-weight: 500; }
.ff-select-pop .opt.off { color: var(--faint); cursor: not-allowed; }
.ff-select-pop .opt .sub { font-size: var(--fs-xs); color: var(--muted); }
.ff-select-pop .opt .tick { flex: none; color: var(--fg); }
.ff-select-pop .grp { padding: 10px 10px 4px; font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ff-select-pop .grp:first-child { padding-top: 6px; }
.ff-select-pop .none { padding: 10px; color: var(--muted); font-size: var(--fs-base); }
@media (pointer: coarse) { .ff-select-pop .opt { padding: 11px 12px; } }
</style>
