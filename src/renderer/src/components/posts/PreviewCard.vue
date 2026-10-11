<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MediaAsset, Platform, PostKind } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import Icon from '@/components/ui/Icon.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import { fileUrl } from '@/lib/api';
import { initials } from '@/lib/format';

/** A rough mock of how the post reads on one platform — first media + caption, not a pixel copy. */
const props = defineProps<{ platform: Platform; kind: PostKind; handle: string; brand: { name: string; color?: string; logo?: string | null } | null; caption: string; title?: string; assets: MediaAsset[] }>();
const spec = computed(() => PLATFORM_SPECS[props.platform]);
const vertical = computed(() => ['reel', 'story'].includes(props.kind) || props.platform === 'tiktok' || (props.platform === 'youtube' && props.kind === 'reel'));
const first = computed(() => props.assets[0] ?? null);
const more = ref(false);
const clip = computed(() => {
  const c = props.caption.trim();
  const max = vertical.value ? 90 : 160;
  return more.value || c.length <= max ? c : `${c.slice(0, max).trimEnd()}…`;
});
const h = computed(() => (props.handle.startsWith('@') ? props.handle.slice(1) : props.handle));
</script>

<template>
  <div class="pv" :class="[{ vertical }, `p-${platform}`]">
    <div v-if="!vertical" class="top">
      <span class="av" :style="{ background: brand?.logo ? undefined : brand?.color }"><img v-if="brand?.logo" :src="brand.logo" alt="" /><template v-else>{{ initials(brand?.name) }}</template></span>
      <div class="grow"><div class="nm ellipsis">{{ h || brand?.name || 'account' }}</div><div class="sub">{{ spec.name }} · just now</div></div>
      <PlatformIcon :platform="platform" :size="15" colored />
    </div>
    <p v-if="!vertical && (platform === 'x' || platform === 'threads' || platform === 'linkedin' || kind === 'text')" class="cap pre">{{ clip || 'Your caption shows here.' }}</p>
    <div v-if="kind !== 'text'" class="media">
      <img v-if="first?.thumb" :src="fileUrl(first.thumb)" alt="" />
      <div v-else class="ph"><Icon :name="kind === 'image' || kind === 'carousel' ? 'image' : 'video'" :size="22" /><span class="tiny">No media yet</span></div>
      <span v-if="assets.length > 1" class="multi num">1/{{ assets.length }}</span>
      <span v-if="first?.kind === 'video' && !vertical" class="play"><Icon name="play" :size="16" /></span>
      <div v-if="vertical" class="overlay">
        <div class="row gap-2"><span class="av sm" :style="{ background: brand?.color }">{{ initials(brand?.name) }}</span><span class="nm">{{ h || brand?.name }}</span></div>
        <p class="cap pre">{{ clip || 'Your caption shows here.' }}</p>
      </div>
      <PlatformIcon v-if="vertical" :platform="platform" :size="16" class="corner" />
    </div>
    <div v-if="platform === 'youtube' && !vertical" class="yt"><div class="nm">{{ title || caption.split('\n')[0] || 'Video title' }}</div></div>
    <p v-if="!vertical && !(platform === 'x' || platform === 'threads' || platform === 'linkedin' || kind === 'text') && platform !== 'youtube'" class="cap pre"><b>{{ h }}</b> {{ clip || 'Your caption shows here.' }}</p>
    <button v-if="caption.trim().length > (vertical ? 90 : 160)" type="button" class="moreb tiny" @click="more = !more">{{ more ? 'less' : 'more' }}</button>
  </div>
</template>

<style scoped>
.pv { border-radius: 10px; background: var(--panel); border: 1px solid var(--line); overflow: hidden; font-size: var(--fs-sm); }
.top { display: flex; align-items: center; gap: 9px; padding: 10px 12px; }
.av { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: var(--fs-2xs); font-weight: 600; overflow: hidden; flex: none; background: var(--faint); }
.av img { width: 100%; height: 100%; object-fit: cover; }
.av.sm { width: 22px; height: 22px; }
.nm { font-weight: 600; font-size: var(--fs-sm); }
.sub { font-size: var(--fs-2xs); color: var(--muted); }
.media { position: relative; background: #111; aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; }
.p-x .media, .p-linkedin .media, .p-youtube .media { aspect-ratio: 16 / 9; margin: 0 12px; border-radius: 8px; }
.p-instagram .media { aspect-ratio: 4 / 5; }
.vertical .media { aspect-ratio: 9 / 16; max-height: 420px; margin: 0 auto; }
.media img { width: 100%; height: 100%; object-fit: cover; }
.ph { display: flex; flex-direction: column; align-items: center; gap: 6px; color: #75736b; }
.multi { position: absolute; top: 8px; right: 8px; padding: 1px 7px; border-radius: 9px; background: rgb(11 11 10 / .7); color: #fff; font-size: var(--fs-2xs); }
.play { position: absolute; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: rgb(11 11 10 / .6); color: #fff; }
.overlay { position: absolute; left: 0; right: 0; bottom: 0; padding: 40px 12px 14px; background: linear-gradient(transparent, rgb(0 0 0 / .75)); color: #fff; display: flex; flex-direction: column; gap: 6px; }
.overlay .cap { color: #fff; padding: 0; font-size: var(--fs-xs); }
.corner { position: absolute; top: 10px; right: 10px; color: #fff; }
.cap { padding: 10px 12px; line-height: 1.45; color: var(--fg-2); overflow-wrap: anywhere; }
.yt { padding: 10px 12px; }
.moreb { margin: -6px 12px 10px; color: var(--muted); }
.moreb:hover { color: var(--fg); }
</style>
