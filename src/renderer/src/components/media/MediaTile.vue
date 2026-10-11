<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MediaAsset } from '@shared/types';
import Icon from '@/components/ui/Icon.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import { fileUrl } from '@/lib/api';
import { clock } from '@/components/posts/time';
import { aspectLabel, fitTitle, platformSummary } from './fit';

/** One library item: thumbnail, duration, aspect and a per-platform fit strip. */
const props = defineProps<{ asset: MediaAsset; selected?: boolean; order?: number | null; selectable?: boolean; compact?: boolean }>();
defineEmits<{ open: []; toggle: [] }>();
const broken = ref(false);
const fits = computed(() => platformSummary(props.asset));
</script>

<template>
  <div class="tile" :class="{ selected, missing: asset.missing, compact }" role="button" tabindex="0" :aria-pressed="selectable ? !!selected : undefined"
    @click="selectable ? $emit('toggle') : $emit('open')" @keydown.enter.prevent="selectable ? $emit('toggle') : $emit('open')" @keydown.space.prevent="$emit('toggle')">
    <div class="thumb">
      <img v-if="asset.thumb && !broken" :src="fileUrl(asset.thumb)" alt="" loading="lazy" draggable="false" @error="broken = true" />
      <div v-else class="ph"><Icon :name="asset.kind === 'video' ? 'video' : 'image'" :size="22" /></div>
      <span v-if="asset.kind === 'video'" class="badge dur num">{{ clock(asset.durationMs) }}</span>
      <span class="badge ar num">{{ aspectLabel(asset) }}</span>
      <span v-if="asset.missing" class="badge miss" title="The file was moved or deleted">Missing</span>
      <span v-if="selectable" class="check" :class="{ on: selected }">
        <span v-if="selected && order" class="num">{{ order }}</span>
        <Icon v-else-if="selected" name="check" :size="13" />
      </span>
      <button v-if="selectable" type="button" class="peek" aria-label="Details" title="Details" @click.stop="$emit('open')"><Icon name="eye" :size="14" /></button>
    </div>
    <div v-if="!compact" class="meta">
      <div class="fn ellipsis" :title="asset.path">{{ asset.filename }}</div>
      <div class="fits">
        <span v-for="f in fits" :key="f.platform" class="fit" :class="`l-${f.level}`" :title="fitTitle(f)"><PlatformIcon :platform="f.platform" :size="11" /></span>
        <span v-if="!fits.length" class="tiny faint">no fit data</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tile { position: relative; display: flex; flex-direction: column; border-radius: var(--r-lg); border: 1px solid var(--line); background: var(--panel); overflow: hidden; cursor: pointer; transition: border-color 200ms, transform 300ms var(--ease-out), box-shadow 300ms var(--ease-out); min-width: 0; }
.tile:hover { border-color: var(--line-strong); box-shadow: var(--shadow-1); }
.tile:focus-visible { outline-offset: 1px; }
.tile.selected { border-color: var(--fg); box-shadow: 0 0 0 1px var(--fg); }
.missing .thumb img { opacity: .4; filter: grayscale(1); }
.thumb { position: relative; aspect-ratio: 1; background: var(--panel-2); display: grid; place-items: center; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: contain; }
.ph { color: var(--faint); }
/* Fixed ink chips in both themes: they sit on the picture (or the light letterbox), never on the page,
   so they must not follow the theme. Near-opaque so bone text keeps ≥ 12:1 over any frame. */
.badge { position: absolute; height: 18px; padding: 0 6px; border-radius: 4px; font-family: var(--mono); font-size: var(--fs-2xs); line-height: 18px; background: rgb(11 11 10 / .92); color: #f3efe4; box-shadow: 0 0 0 1px rgb(243 239 228 / .14); white-space: nowrap; }
.dur { right: 6px; bottom: 6px; }
.ar { left: 6px; bottom: 6px; }
.miss { left: 6px; top: 6px; background: #a3261d; color: #fff; text-transform: uppercase; letter-spacing: .04em; }
.check { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: rgb(243 239 228 / .85); box-shadow: inset 0 0 0 1.5px rgb(11 11 10 / .35); color: var(--ink); font-size: var(--fs-2xs); font-weight: 600; transition: background-color 200ms, transform 300ms var(--ease-out); }
.check.on { background: var(--lime); box-shadow: inset 0 0 0 1.5px var(--ink); transform: scale(1.08); }
.peek { position: absolute; top: 6px; left: 6px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: rgb(11 11 10 / .6); color: #f3efe4; opacity: 0; transition: opacity 200ms; }
.tile:hover .peek, .peek:focus-visible { opacity: 1; }
.meta { padding: 8px 10px 9px; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.fn { font-size: var(--fs-sm); font-weight: 500; }
.fits { display: flex; gap: 2px; align-items: center; min-height: 16px; flex-wrap: nowrap; overflow: hidden; }
.fit { width: 16px; height: 16px; border-radius: 4px; display: grid; place-items: center; flex: none; }
.l-ok { background: var(--good-bg); color: var(--good); }
.l-warn { background: var(--warn-bg); color: var(--warn); }
.l-bad { background: var(--bad-bg); color: var(--bad); opacity: .75; }
</style>
