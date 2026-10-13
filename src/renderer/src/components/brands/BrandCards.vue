<script setup lang="ts">
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

/** Card view of the brands list: the same data and actions as the table, laid out as tiles. */
const props = defineProps<{ rows: BrandRow[] | null; loading?: boolean; selected: Set<string>; menuExtra?: (b: BrandRow) => MenuItem[]; groupColor?: (id: string | null) => string | null }>();
const emit = defineEmits<{ 'update:selected': [v: Set<string>]; detail: [b: BrandRow]; tag: [t: string] }>();
const act = useBrandActions();
function toggle(b: BrandRow) {
  const next = new Set(props.selected);
  if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
  emit('update:selected', next);
}
function key(e: KeyboardEvent, b: BrandRow) {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) emit('detail', b); else void act.openOrFront(b); }
  else if (e.key === ' ') { e.preventDefault(); toggle(b); }
}
</script>

<template>
  <div class="cards">
    <template v-if="loading && !rows">
      <div v-for="i in 6" :key="i" class="card skel-card"><div class="skel" style="width: 44px; height: 44px; border-radius: 11px" /><div class="skel-line mt-4" style="width: 60%" /><div class="skel-line mt-2" style="width: 40%" /></div>
    </template>
    <TransitionGroup v-else name="list">
      <article v-for="(b, i) in rows ?? []" :key="b.id" class="card" :class="{ sel: selected.has(b.id), [`s-${b.status}`]: true }" :style="{ '--i': Math.min(i, 14), '--c': b.color }" tabindex="0"
        @click="emit('detail', b)" @keydown="key($event, b)">
        <span class="band" />
        <header class="top">
          <BrandAvatar :brand="b" :size="44" />
          <div class="grow">
            <div class="strong ellipsis nm" :title="b.notes ? `${b.name} — ${b.notes}` : b.name">{{ b.name }}</div>
            <div class="tiny muted meta"><span class="code">{{ serialText(b.serial) }}</span><template v-if="b.groupName"><span aria-hidden="true">·</span><span class="swatch" :style="{ background: groupColor?.(b.groupId) ?? 'var(--faint)' }" /><span class="ellipsis">{{ b.groupName }}</span></template></div>
          </div>
          <input type="checkbox" class="cb" :checked="selected.has(b.id)" :aria-label="`Select ${b.name}`" @click.stop="toggle(b)" />
        </header>
        <p v-if="b.notes" class="tiny muted notes" :title="b.notes">{{ b.notes }}</p>
        <div class="plats">
          <AccountBadge v-for="a in b.accounts" :key="a.id" :account="a" />
          <span v-if="!b.accounts.length" class="muted small">No accounts yet</span>
        </div>
        <div v-if="b.tags.length" class="tags" @click.stop>
          <button v-for="t in b.tags.slice(0, 4)" :key="t" type="button" class="tg" :title="`Filter by ${t}`" @click="emit('tag', t)">{{ t }}</button>
          <span v-if="b.tags.length > 4" class="tg-more" :title="b.tags.slice(4).join(', ')">+{{ b.tags.length - 4 }}</span>
        </div>
        <footer class="foot" @click.stop>
          <div class="grow col gap-1 when">
            <BrandStatus :status="b.status" :error="b.statusError" compact />
            <span class="tiny muted ellipsis" :title="b.lastOpenedAt ? `Last opened ${dateTime(b.lastOpenedAt)}` : undefined">{{ b.lastOpenedAt ? `Opened ${ago(b.lastOpenedAt)}` : 'Never opened' }}</span>
          </div>
          <Btn v-if="b.status === 'open' || b.status === 'opening'" size="sm" :loading="act.pending.has(b.id) || b.status === 'opening'" @click="act.close(b)">Close</Btn>
          <Btn v-else size="sm" variant="primary" icon="open" :loading="act.pending.has(b.id)" @click="act.open(b)">{{ b.status === 'error' ? 'Reopen' : 'Open' }}</Btn>
          <Menu :items="act.menu(b, menuExtra?.(b) ?? [])" :width="210">
            <button type="button" class="more" :aria-label="`More for ${b.name}`" :title="`More for ${b.name}`"><Icon name="more" :size="18" :stroke="3" /></button>
          </Menu>
        </footer>
      </article>
    </TransitionGroup>
    <div v-if="!loading && rows && !rows.length" class="empty-slot"><slot name="empty" /></div>
  </div>
</template>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.empty-slot { grid-column: 1 / -1; }
.card { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 16px 16px 12px; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); cursor: pointer; outline: none; animation: ff-rise 560ms var(--ease-out) backwards; animation-delay: calc(var(--i) * 30ms); transition: border-color 200ms, box-shadow 300ms var(--ease-out), transform 300ms var(--ease-out); }
.card:hover { border-color: var(--line-strong); box-shadow: var(--shadow-1); transform: translateY(-1px); }
.card:focus-visible { border-color: var(--fg); }
.card.sel { border-color: var(--fg); box-shadow: 0 0 0 1px var(--fg); }
.band { position: absolute; left: -1px; top: -1px; right: -1px; height: 4px; border-radius: var(--r-lg) var(--r-lg) 0 0; background: var(--c); opacity: .85; }
/* very dark brand colours would vanish on Ink: a hairline keeps the band visible */
[data-theme='dark'] .band { opacity: 1; box-shadow: inset 0 0 0 1px rgb(243 239 228 / .22); }
.top { display: flex; align-items: center; gap: 12px; min-width: 0; }
.nm { font-size: var(--fs-md); }
.cb { width: 15px; height: 15px; accent-color: var(--fg); cursor: pointer; align-self: flex-start; opacity: 0; transition: opacity 160ms; }
.card:hover .cb, .card.sel .cb, .card:focus-within .cb { opacity: 1; }
.notes { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.45; }
.plats { display: flex; gap: 5px; flex-wrap: wrap; min-height: 26px; align-items: center; }
.meta { display: flex; align-items: center; gap: 6px; min-width: 0; margin-top: 1px; }
.meta .swatch { width: 8px; height: 8px; border-radius: 2px; }
[data-theme='dark'] .meta .swatch { box-shadow: inset 0 0 0 1px rgb(243 239 228 / .3); }
.tags { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; min-width: 0; }
.tg { height: 21px; max-width: 100%; padding: 0 8px; border-radius: var(--r-pill); background: var(--panel-2); color: var(--fg-2); font-size: var(--fs-xs); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background-color 160ms, color 160ms; }
.tg:hover { background: var(--line); color: var(--fg); }
.tg-more { display: inline-flex; align-items: center; height: 21px; padding: 0 7px; border-radius: var(--r-pill); box-shadow: inset 0 0 0 1px var(--line); color: var(--muted); font-family: var(--mono); font-size: var(--fs-2xs); cursor: help; }
.foot { display: flex; align-items: center; gap: 6px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line-soft); cursor: default; }
.when { min-width: 0; }
.more { width: 32px; height: 32px; display: inline-grid; place-items: center; border-radius: 50%; color: var(--muted); transition: background-color 160ms, color 160ms; }
.more:hover, .more:focus-visible { background: var(--panel-2); color: var(--fg); }
.skel-card { min-height: 190px; cursor: default; }
</style>
