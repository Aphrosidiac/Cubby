<script setup lang="ts" generic="T extends Record<string, any>">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';
import type { Column } from './types';

/**
 * The list. Hairline rows, tabular figures, rows rise in on first paint and
 * flash Signal Lime when a live update changes them. Row click navigates;
 * an arrow slides in on hover. Cells are customised with #cell-<key> slots.
 */
const props = withDefaults(defineProps<{ columns: Column[]; rows: T[] | null | undefined; rowKey?: string; loading?: boolean; clickable?: boolean; dense?: boolean; skeletonRows?: number; flashKey?: (r: T) => string; selected?: string | null }>(), { rowKey: 'id', clickable: true, skeletonRows: 7 });
const emit = defineEmits<{ 'row-click': [row: T, e: MouseEvent] }>();

const sort = ref<{ key: string; dir: 1 | -1 } | null>(null);
const sorted = computed(() => {
  const r = props.rows ?? [];
  if (!sort.value) return r;
  const { key, dir } = sort.value;
  // empty values sink to the bottom either way; text compares like a person reads it ("Item 2" < "Item 10")
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  return [...r].sort((a, b) => {
    const x = a[key], y = b[key];
    if (empty(x) || empty(y)) return empty(x) === empty(y) ? 0 : empty(x) ? 1 : -1;
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) : x > y ? 1 : x < y ? -1 : 0;
    return c * dir;
  });
});
// Where each column sits when the table folds into cards on a phone.
const roles = computed(() => {
  const vis = props.columns.filter(c => !c.hideSm && c.sm !== 'hide');
  const lastRight = [...vis].reverse().find(c => c.align === 'right' && !c.sm);
  return Object.fromEntries(props.columns.map((c, i) => [c.key, c.sm ?? (c.hideSm ? 'hide' : i === 0 ? 'main' : c === lastRight ? 'end' : 'sub')]));
});
const cellClass = (c: Column) => [c.class, `m-${roles.value[c.key]}`, { 'hide-sm': c.hideSm }];
function toggleSort(c: Column) {
  if (!c.sortable) return;
  sort.value = sort.value?.key === c.key ? (sort.value.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 };
}

// Flash rows whose fingerprint changed since the last render (live updates).
const prints = new Map<string, string>();
const flashing = ref(new Set<string>());
let first = true;
watch(() => props.rows, rows => {
  if (!rows) return;
  const next = new Set<string>();
  for (const r of rows) {
    const k = String(r[props.rowKey]);
    const p = props.flashKey ? props.flashKey(r) : JSON.stringify(r);
    if (!first && prints.has(k) && prints.get(k) !== p) next.add(k);
    if (!first && !prints.has(k)) next.add(k);
    prints.set(k, p);
  }
  first = false;
  if (next.size) { flashing.value = next; setTimeout(() => { flashing.value = new Set(); }, 1700); }
}, { immediate: true });

// The wrapper only becomes a sideways scroller when the table is wider than it. A scroll
// container would capture the sticky header (it could never stick to the page) and clip
// row menus that open past the last row.
const wrap = ref<HTMLElement | null>(null);
const tbl = ref<HTMLElement | null>(null);
const scrolls = ref(false);
let ro: ResizeObserver | null = null;
const fit = () => { if (wrap.value && tbl.value) scrolls.value = tbl.value.scrollWidth > wrap.value.clientWidth + 1; };
onMounted(() => { ro = new ResizeObserver(fit); if (wrap.value) ro.observe(wrap.value); if (tbl.value) ro.observe(tbl.value); fit(); });
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div ref="wrap" class="ff-table" :class="{ dense, scrolls }">
    <table ref="tbl">
      <thead>
        <tr>
          <th v-for="c in columns" :key="c.key" :style="{ width: c.width, textAlign: c.align ?? 'left' }" :class="[c.class, { sortable: c.sortable, 'hide-sm': c.hideSm }]"
            :aria-sort="c.sortable ? (sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none') : undefined">
            <button v-if="c.sortable" type="button" class="th" :title="`Sort by ${c.label.toLowerCase()}`" @click="toggleSort(c)">{{ c.label }}<Icon name="chevron-down" :size="11" class="sort-i" :class="{ on: sort?.key === c.key, up: sort?.key === c.key && sort.dir === -1 }" /></button>
            <span v-else class="th">{{ c.label }}</span>
          </th>
          <th v-if="clickable" class="arrow-col" aria-hidden="true" />
        </tr>
      </thead>
      <tbody v-if="loading && !rows?.length">
        <tr v-for="i in skeletonRows" :key="`s${i}`" class="skel-row">
          <td v-for="(c, j) in columns" :key="c.key" :class="cellClass(c)"><div class="skel-line" :style="{ width: `${[62, 44, 70, 38, 55][(i + j) % 5]}%`, marginLeft: c.align === 'right' ? 'auto' : undefined, animationDelay: `${i * 60}ms` }" /></td>
          <td v-if="clickable" />
        </tr>
      </tbody>
      <TransitionGroup v-else tag="tbody" name="list">
        <tr
          v-for="(r, i) in sorted" :key="String(r[rowKey])" :style="{ '--i': Math.min(i, 14) }"
          :class="{ clickable, flash: flashing.has(String(r[rowKey])), sel: selected === String(r[rowKey]) }" class="row-in"
          :tabindex="clickable ? 0 : undefined" @click="clickable && emit('row-click', r, $event)" @keydown.enter.self="clickable && emit('row-click', r, $event as unknown as MouseEvent)"
        >
          <td v-for="c in columns" :key="c.key" :style="{ textAlign: c.align ?? 'left' }" :class="cellClass(c)">
            <slot :name="`cell-${c.key}`" :row="r" :value="r[c.key]">{{ r[c.key] ?? '—' }}</slot>
          </td>
          <td v-if="clickable" class="arrow-col"><Icon name="arrow" :size="15" class="go" /></td>
        </tr>
      </TransitionGroup>
    </table>
    <div v-if="!loading && !rows?.length" class="empty-slot"><slot name="empty" /></div>
  </div>
</template>

<style scoped>
.ff-table { width: 100%; }
.ff-table.scrolls { overflow-x: auto; }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
/* sticks under the app's top bar; a drawer or modal body resets --table-top to 0 */
th { position: sticky; top: var(--table-top, var(--topbar)); z-index: 2; background: var(--table-bg, var(--bg)); padding: 10px 14px; border-bottom: 1px solid var(--fg); font-family: var(--mono); font-size: var(--fs-2xs); font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); white-space: nowrap; text-align: left; }
.th { display: inline-flex; align-items: center; gap: 4px; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; }
button.th { cursor: pointer; padding: 2px 0; margin: -2px 0; border-radius: var(--r-sm); transition: color var(--t-micro); }
button.th:hover, th[aria-sort='ascending'] .th, th[aria-sort='descending'] .th { color: var(--fg); }
button.th:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; box-shadow: none; }
th[style*='right'] .th { flex-direction: row-reverse; }
/* the sort chevron hints on hover, shows when the column is sorted */
.sort-i { opacity: 0; transition: opacity var(--t-micro), transform 240ms var(--ease-out); }
button.th:hover .sort-i, button.th:focus-visible .sort-i { opacity: .45; }
.sort-i.on { opacity: 1 !important; }
.up { transform: rotate(180deg); }
td { padding: 13px 14px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; font-size: var(--fs-base); transition: background-color 180ms; }
.dense td { padding: 9px 14px; font-size: var(--fs-base); }
th:first-child, td:first-child { padding-left: 4px; }
tr.clickable { cursor: pointer; }
tr.clickable:hover td, tr.sel td { background: var(--panel-hover); }
tr.clickable:focus-visible { outline: none; }
tr.clickable:focus-visible td { background: var(--panel-hover); box-shadow: inset 0 -1px 0 var(--fg); }
.arrow-col { width: 34px; padding-right: 4px; text-align: right; }
.go { opacity: 0; transform: translateX(-8px); transition: opacity 200ms, transform 360ms var(--ease-out); margin-left: auto; color: var(--fg); }
tr:hover .go, tr:focus-visible .go { opacity: 1; transform: none; }
.row-in { animation: ff-rise 560ms var(--ease-out) backwards; animation-delay: calc(var(--i) * 28ms); }
.flash td { animation: ff-flash 1.6s var(--ease-out); }
.flash td:first-child { box-shadow: inset 3px 0 0 var(--lime); }
.skel-row td { padding: 17px 14px; }
.empty-slot { padding: var(--s6) 0; }
@media (max-width: 760px) { .hide-sm { display: none; } }
/* Phones: every row folds into a card — title and details on the left, the
   figure and status on the right. Nothing scrolls sideways. */
@media (max-width: 640px) {
  .ff-table { overflow-x: visible; }
  table, tbody { display: block; }
  thead { display: none; }
  tr { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; row-gap: 3px; padding: 13px 2px; border-bottom: 1px solid var(--line-soft); transition: background-color 180ms; }
  td, .dense td { display: block; padding: 0; border: 0; min-width: 0; font-size: var(--fs-base); text-align: left !important; }
  td:first-child { padding-left: 0; }
  td.m-hide, td.arrow-col { display: none; }
  .hide-sm:not(.m-hide) { display: block; }
  /* an id cell reads as one line: "INV-2026-0020  Final" (a title cell keeps its stacked lines) */
  .m-sub > :deep(.ellipsis), .m-main > :deep(.ellipsis) { display: block; }
  /* the right column is one figure; its muted footnote ("50% deposit") waits for the detail page */
  .m-end > :deep(.tiny.muted) { display: none; }
  .m-main > :deep(span:first-child + .tiny) { display: inline-flex; align-items: center; gap: 4px; margin: 0 0 0 8px; vertical-align: 1px; }
  .m-lead { grid-column: 1; grid-row: 1 / span 3; margin-right: 12px; align-self: center; }
  .m-main { grid-column: 2; grid-row: 1; font-weight: 500; }
  .m-sub { grid-column: 2; font-size: var(--fs-sm); color: var(--fg-2); }
  .m-end { grid-column: 3; grid-row: 1; margin-left: 14px; text-align: right !important; white-space: nowrap; font-weight: 500; }
  .m-end2 { grid-column: 3; grid-row: 2; margin-left: 14px; text-align: right !important; justify-self: end; }
  tr.clickable:hover td, tr.sel td, tr.clickable:focus-visible td { background: none; box-shadow: none; }
  tr.clickable:active, tr.sel { background: var(--panel-hover); }
  .flash td { animation: none; box-shadow: none !important; }
  .flash { animation: ff-flash 1.6s var(--ease-out); }
  .skel-row td { padding: 4px 0; }
}
</style>
