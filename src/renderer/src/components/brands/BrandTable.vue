<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BrandRow } from '@shared/types';
import type { MenuItem } from '@/components/ui/types';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Btn from '@/components/ui/Btn.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import AccountBadge from '@/components/common/AccountBadge.vue';
import BrandStatus from './BrandStatus.vue';
import { useBrandActions } from './actions';
import { serialText } from '@/components/common/login';
import { ago, dateTime } from '@/lib/format';

/**
 * The brands table (AdsPower's profile list, FF Ops' hairline table). Selection with checkboxes
 * (Shift-click for a range), sortable heads, drag the grip to reorder when unsorted, Enter opens the
 * brand's window, a click opens its page. Columns fold away as the window narrows.
 */
export type SortKey = 'serial' | 'name' | 'group' | 'tags' | 'platforms' | 'status' | 'lastOpenedAt';
const props = defineProps<{
  rows: BrandRow[] | null; loading?: boolean; selected: Set<string>; sort: { key: SortKey; dir: 1 | -1 } | null;
  reorderable?: boolean; menuExtra?: (b: BrandRow) => MenuItem[]; groupColor?: (id: string | null) => string | null;
}>();
const emit = defineEmits<{ 'update:selected': [v: Set<string>]; 'update:sort': [v: { key: SortKey; dir: 1 | -1 } | null]; reorder: [ids: string[]]; detail: [b: BrandRow]; tag: [t: string] }>();
const act = useBrandActions();

const STATUS_ORDER: Record<string, number> = { open: 0, opening: 1, error: 2, closed: 3 };
const HEALTH: Record<string, number> = { expired: 0, expiring: 1, unknown: 2, ok: 3 };
const keyOf: Record<SortKey, (b: BrandRow) => string | number> = {
  serial: b => b.serial,
  name: b => b.name.toLowerCase(),
  group: b => (b.groupName ?? '￿').toLowerCase(),
  tags: b => (b.tags[0] ?? '￿').toLowerCase(),
  platforms: b => (b.accounts.length ? Math.min(...b.accounts.map(a => HEALTH[a.loginState] ?? 2)) * 100 - b.accounts.length : 999),
  status: b => STATUS_ORDER[b.status] ?? 9,
  lastOpenedAt: b => (b.lastOpenedAt ? -new Date(b.lastOpenedAt).getTime() : 0)
};
const shown = computed(() => {
  const r = props.rows ?? [];
  if (!props.sort) return r;
  const { key, dir } = props.sort;
  const f = keyOf[key];
  return [...r].sort((a, b) => { const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : a.serial - b.serial) * dir; });
});
const COLS: { key: string; label: string; sort?: SortKey; cls: string }[] = [
  { key: 'serial', label: '#', sort: 'serial', cls: 'c-serial' },
  { key: 'name', label: 'Brand', sort: 'name', cls: 'c-name' },
  { key: 'group', label: 'Group', sort: 'group', cls: 'c-group' },
  { key: 'tags', label: 'Tags', sort: 'tags', cls: 'c-tags' },
  { key: 'platforms', label: 'Accounts', sort: 'platforms', cls: 'c-plat' },
  { key: 'status', label: 'Status', sort: 'status', cls: 'c-status' },
  { key: 'last', label: 'Last opened', sort: 'lastOpenedAt', cls: 'c-last' }
];
function toggleSort(k?: SortKey) {
  if (!k) return;
  const s = props.sort;
  emit('update:sort', s?.key === k ? (s.dir === 1 ? { key: k, dir: -1 } : null) : { key: k, dir: 1 });
}

// ── selection ──
const allOn = computed(() => shown.value.length > 0 && shown.value.every(b => props.selected.has(b.id)));
const someOn = computed(() => !allOn.value && shown.value.some(b => props.selected.has(b.id)));
let anchor: string | null = null;
function toggleAll() {
  const next = new Set(props.selected);
  if (allOn.value) shown.value.forEach(b => next.delete(b.id)); else shown.value.forEach(b => next.add(b.id));
  emit('update:selected', next);
}
function toggleOne(b: BrandRow, e?: MouseEvent | KeyboardEvent) {
  const next = new Set(props.selected);
  const on = !next.has(b.id);
  if (e?.shiftKey && anchor) {
    const ids = shown.value.map(x => x.id);
    const [i, j] = [ids.indexOf(anchor), ids.indexOf(b.id)].sort((x, y) => x - y);
    if (i >= 0) ids.slice(i, j + 1).forEach(id => (on ? next.add(id) : next.delete(id)));
  } else if (on) next.add(b.id); else next.delete(b.id);
  anchor = b.id;
  emit('update:selected', next);
}

// ── keyboard ──
const root = ref<HTMLElement | null>(null);
function rowKey(e: KeyboardEvent, b: BrandRow, i: number) {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) emit('detail', b); else void act.openOrFront(b); }
  else if (e.key === ' ') { e.preventDefault(); toggleOne(b, e); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = root.value?.querySelectorAll<HTMLElement>('tr.br');
    rows?.[Math.max(0, Math.min((rows?.length ?? 1) - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  } else if (e.key === 'Delete') { e.preventDefault(); void act.remove([b]); }
}

// ── drag to reorder ──
const armed = ref<string | null>(null);
const dragId = ref<string | null>(null);
const over = ref<{ id: string; after: boolean } | null>(null);
function dragStart(e: DragEvent, b: BrandRow) {
  dragId.value = b.id;
  e.dataTransfer?.setData('text/plain', b.id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function dragOver(e: DragEvent, b: BrandRow) {
  if (!dragId.value) return;
  e.preventDefault();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  over.value = { id: b.id, after: e.clientY > r.top + r.height / 2 };
}
function drop() {
  const from = dragId.value, to = over.value;
  dragEnd();
  if (!from || !to || from === to.id) return;
  const ids = shown.value.map(b => b.id).filter(id => id !== from);
  const at = ids.indexOf(to.id) + (to.after ? 1 : 0);
  ids.splice(at, 0, from);
  emit('reorder', ids);
}
function dragEnd() { dragId.value = null; over.value = null; armed.value = null; }

// flash rows whose status or logins changed live
const prints = new Map<string, string>();
const flashing = ref(new Set<string>());
watch(() => props.rows, rows => {
  if (!rows) return;
  const next = new Set<string>();
  for (const r of rows) {
    const p = `${r.status}|${r.accounts.map(a => a.loginState).join()}|${r.name}|${r.groupId}|${r.tags.join()}`;
    if (prints.size && prints.has(r.id) && prints.get(r.id) !== p) next.add(r.id);
    prints.set(r.id, p);
  }
  if (next.size) { flashing.value = next; setTimeout(() => (flashing.value = new Set()), 1700); }
}, { immediate: true });

const MAX_TAGS = 2;
</script>

<template>
  <div ref="root" class="bt-wrap">
    <table class="bt">
      <thead>
        <tr>
          <th class="c-sel">
            <input type="checkbox" class="cb" :checked="allOn" :indeterminate="someOn" :disabled="!shown.length" aria-label="Select all shown brands" @change="toggleAll" />
          </th>
          <th v-for="c in COLS" :key="c.key" :class="[c.cls, { sortable: !!c.sort, on: sort?.key === c.sort }]" :aria-sort="sort?.key === c.sort ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined" @click="toggleSort(c.sort)">
            <span class="th">{{ c.label }}<Icon v-if="sort && sort.key === c.sort" name="chevron-down" :size="11" :class="{ up: sort.dir === -1 }" /></span>
          </th>
          <th class="c-act"><span class="sr-only">Open or close</span></th>
          <th class="c-menu"><span class="sr-only">More</span></th>
        </tr>
      </thead>
      <tbody v-if="loading && !rows">
        <tr v-for="i in 6" :key="`s${i}`" class="skel-row">
          <td class="c-sel"><div class="skel-line" style="width: 14px" /></td>
          <td class="c-serial"><div class="skel-line" style="width: 28px" /></td>
          <td class="c-name"><div class="row gap-2"><div class="skel" style="width: 30px; height: 30px; border-radius: 8px" /><div class="skel-line" :style="{ width: `${[120, 90, 140, 100, 80, 110][i - 1]}px` }" /></div></td>
          <td class="c-group"><div class="skel-line" style="width: 60px" /></td>
          <td class="c-tags"><div class="skel-line" style="width: 70px" /></td>
          <td class="c-plat"><div class="skel-line" style="width: 64px" /></td>
          <td class="c-status"><div class="skel-line" style="width: 54px" /></td>
          <td class="c-last"><div class="skel-line" style="width: 60px" /></td>
          <td class="c-act" /><td class="c-menu" />
        </tr>
      </tbody>
      <TransitionGroup v-else tag="tbody" name="list">
        <tr v-for="(b, i) in shown" :key="b.id" class="br row-in" tabindex="0"
          :class="{ sel: selected.has(b.id), flash: flashing.has(b.id), dragging: dragId === b.id, 'drop-before': over?.id === b.id && !over.after, 'drop-after': over?.id === b.id && over.after }"
          :style="{ '--i': Math.min(i, 14) }" :draggable="armed === b.id" :aria-selected="selected.has(b.id)"
          @click="emit('detail', b)" @keydown="rowKey($event, b, i)"
          @dragstart="dragStart($event, b)" @dragover="dragOver($event, b)" @drop.prevent="drop" @dragend="dragEnd">
          <td class="c-sel" @click.stop>
            <span v-if="reorderable" class="grip" title="Drag to reorder" @mousedown="armed = b.id" @mouseup="armed = null"><Icon name="drag" :size="14" :stroke="2.6" /></span>
            <input type="checkbox" class="cb" :checked="selected.has(b.id)" :aria-label="`Select ${b.name}`" @click="toggleOne(b, $event)" />
          </td>
          <td class="c-serial"><span class="code muted">{{ serialText(b.serial) }}</span></td>
          <td class="c-name">
            <div class="nm">
              <BrandAvatar :brand="b" :size="30" />
              <div class="grow" :title="b.notes ? `${b.name} — ${b.notes}` : undefined">
                <div class="row gap-1 nm-line"><span class="strong ellipsis">{{ b.name }}</span><Icon v-if="b.notes" name="note" :size="13" class="note-ic" /></div>
                <div class="ser-inline code faint">{{ serialText(b.serial) }}<span v-if="b.groupName" class="si-g"> · {{ b.groupName }}</span></div>
              </div>
            </div>
          </td>
          <td class="c-group">
            <span v-if="b.groupName" class="grp"><span class="swatch" :style="{ background: groupColor?.(b.groupId) ?? 'var(--faint)' }" /><span class="ellipsis">{{ b.groupName }}</span></span>
            <span v-else class="faint">—</span>
          </td>
          <td class="c-tags" @click.stop>
            <div class="tags">
              <button v-for="t in b.tags.slice(0, MAX_TAGS)" :key="t" type="button" class="tg" :title="`Filter by ${t}`" @click="emit('tag', t)">{{ t }}</button>
              <span v-if="b.tags.length > MAX_TAGS" class="tg more" :title="b.tags.slice(MAX_TAGS).join(', ')">+{{ b.tags.length - MAX_TAGS }}</span>
              <span v-if="!b.tags.length" class="faint">—</span>
            </div>
          </td>
          <td class="c-plat">
            <div v-if="b.accounts.length" class="plats"><AccountBadge v-for="a in b.accounts" :key="a.id" :account="a" /></div>
            <span v-else class="faint small">No accounts</span>
          </td>
          <td class="c-status"><BrandStatus :status="b.status" :error="b.statusError" /></td>
          <td class="c-last"><span class="small muted nowrap" :title="dateTime(b.lastOpenedAt)">{{ b.lastOpenedAt ? ago(b.lastOpenedAt) : 'Never' }}</span></td>
          <td class="c-act" @click.stop>
            <Btn v-if="b.status === 'open' || b.status === 'opening'" size="sm" :loading="act.pending.has(b.id) || b.status === 'opening'" @click="act.close(b)">Close</Btn>
            <Btn v-else size="sm" variant="primary" icon="open" :loading="act.pending.has(b.id)" @click="act.open(b)">{{ b.status === 'error' ? 'Reopen' : 'Open' }}</Btn>
          </td>
          <td class="c-menu" @click.stop>
            <Menu :items="act.menu(b, menuExtra?.(b) ?? [])" :width="210">
              <button type="button" class="more" :aria-label="`More for ${b.name}`"><Icon name="more" :size="18" :stroke="3" /></button>
            </Menu>
          </td>
        </tr>
      </TransitionGroup>
    </table>
    <div v-if="!loading && rows && !rows.length" class="empty-slot"><slot name="empty" /></div>
  </div>
</template>

<style scoped>
.bt-wrap { container-type: inline-size; width: 100%; min-width: 0; }
.bt { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: auto; }
th { position: sticky; top: var(--topbar); z-index: 2; background: var(--bg); padding: 10px 10px; border-bottom: 1px solid var(--fg); font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); white-space: nowrap; text-align: left; }
th.sortable { cursor: pointer; } th.sortable:hover, th.on { color: var(--fg); }
.th { display: inline-flex; align-items: center; gap: 4px; }
.up { transform: rotate(180deg); }
td { padding: 10px 10px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; font-size: var(--fs-base); transition: background-color 180ms; }
tr.br { cursor: pointer; outline: none; }
tr.br:hover td, tr.br.sel td { background: var(--panel-hover); }
tr.br.sel td { background: color-mix(in srgb, var(--panel-hover) 70%, var(--panel-2)); }
tr.br:focus-visible td { background: var(--panel-hover); box-shadow: inset 0 -1px 0 var(--fg); }
tr.br:focus-visible td:first-child { box-shadow: inset 3px 0 0 var(--fg), inset 0 -1px 0 var(--fg); }
.row-in { animation: ff-rise 560ms var(--ease-out) backwards; animation-delay: calc(var(--i) * 26ms); }
.flash td { animation: ff-flash 1.6s var(--ease-out); }
.dragging { opacity: .4; }
.drop-before td { box-shadow: inset 0 2px 0 var(--fg); }
.drop-after td { box-shadow: inset 0 -2px 0 var(--fg); }

.c-sel { width: 46px; padding-left: 4px; padding-right: 0; }
td.c-sel { position: relative; }
.cb { width: 15px; height: 15px; margin: 0 0 0 14px; accent-color: var(--fg); cursor: pointer; vertical-align: middle; }
.grip { position: absolute; left: -6px; top: 50%; translate: 0 -50%; width: 18px; height: 28px; display: grid; place-items: center; color: var(--faint); cursor: grab; opacity: 0; transition: opacity 160ms; }
tr.br:hover .grip { opacity: 1; }
.grip:active { cursor: grabbing; }
.c-serial { width: 58px; }
.c-name { min-width: 180px; }
.nm { display: flex; align-items: center; gap: 11px; min-width: 0; max-width: 340px; }
.nm-line { min-width: 0; }
.note-ic { color: var(--faint); flex: none; }
.c-group { max-width: 160px; }
.grp { display: inline-flex; align-items: center; gap: 7px; max-width: 150px; font-size: var(--fs-sm); color: var(--fg-2); }
.tags { display: flex; gap: 4px; flex-wrap: nowrap; }
.tg { height: 21px; padding: 0 8px; border-radius: var(--r-pill); background: var(--panel-2); color: var(--fg-2); font-size: var(--fs-xs); font-weight: 500; white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis; transition: background-color 160ms; }
button.tg:hover { background: var(--line); color: var(--fg); }
.tg.more { display: inline-flex; align-items: center; background: none; box-shadow: inset 0 0 0 1px var(--line); color: var(--muted); cursor: default; }
.plats { display: flex; gap: 5px; flex-wrap: wrap; max-width: 190px; }
.c-act { width: 1%; text-align: right; padding-right: 2px; }
.c-act :deep(.btn) { min-width: 78px; }
.c-menu { width: 40px; padding-left: 2px; text-align: right; }
.more { width: 32px; height: 32px; display: inline-grid; place-items: center; border-radius: 50%; color: var(--muted); transition: background-color 160ms, color 160ms; }
.more:hover { background: var(--panel-2); color: var(--fg); }
.skel-row td { padding: 15px 10px; }
.empty-slot { padding: var(--s5) 0; }

/* the window narrows: least-needed columns go first */
.ser-inline { display: none; margin-top: 1px; }
.si-g { display: none; }
@container (max-width: 1060px) { .c-serial { display: none; } .ser-inline { display: block; } }
@container (max-width: 960px) { .c-last { display: none; } }
@container (max-width: 820px) { .c-group { display: none; } .si-g { display: inline; } }
@container (max-width: 700px) { .c-tags { display: none; } }
@container (max-width: 600px) { .c-status { display: none; } }
</style>
