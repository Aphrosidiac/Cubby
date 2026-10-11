<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MediaAsset, PerPlatformOptions, Platform, PostKind } from '@shared/types';
import { PLATFORM_SPECS, countHashtags } from '@shared/platforms';
import Field from '@/components/ui/Field.vue';
import Select from '@/components/ui/Select.vue';
import Toggle from '@/components/ui/Toggle.vue';
import { fileUrl } from '@/lib/api';
import { clock } from './time';

/** Per-platform overrides for one post: caption, first comment, cover frame and the platform's own switches. */
const props = defineProps<{ platform: Platform; kind: PostKind; modelValue: PerPlatformOptions; mainCaption: string; video: MediaAsset | null }>();
const emit = defineEmits<{ 'update:modelValue': [v: PerPlatformOptions] }>();
const spec = computed(() => PLATFORM_SPECS[props.platform]);
const set = <K extends keyof PerPlatformOptions>(k: K, v: PerPlatformOptions[K]) => {
  const next = { ...props.modelValue, [k]: v };
  if (v === '' || v === undefined) delete next[k];
  emit('update:modelValue', next);
};
const caption = computed(() => props.modelValue.caption ?? '');
const effective = computed(() => props.modelValue.caption?.trim() ? props.modelValue.caption : props.mainCaption);
const len = computed(() => [...effective.value].length);
const tags = computed(() => countHashtags(effective.value));

const hasFirstComment = computed(() => ['instagram', 'facebook', 'youtube', 'linkedin', 'x', 'threads'].includes(props.platform) && props.kind !== 'story');
const firstLabel = computed(() => (props.platform === 'x' || props.platform === 'threads' ? 'First reply' : 'First comment'));
const coverable = computed(() => !!props.video && ['reel', 'video'].includes(props.kind) && ['instagram', 'facebook', 'tiktok', 'youtube'].includes(props.platform));

// cover frame: scrub a preview of the first video
const vid = ref<HTMLVideoElement | null>(null);
const dur = computed(() => props.video?.durationMs ?? 0);
const cover = computed(() => props.modelValue.coverMs ?? 0);
watch(cover, ms => { if (vid.value && Math.abs(vid.value.currentTime * 1000 - ms) > 40) vid.value.currentTime = ms / 1000; });
const onMeta = () => { if (vid.value) vid.value.currentTime = cover.value / 1000; };
</script>

<template>
  <div class="po">
    <Field :label="`Caption for ${spec.name}`" :hint="caption ? undefined : 'Empty = uses the main caption'">
      <textarea v-autosize class="textarea" rows="3" :value="caption" :placeholder="mainCaption || 'Uses the main caption'" data-max="320" @input="set('caption', ($event.target as HTMLTextAreaElement).value)" />
    </Field>
    <div class="counts tiny">
      <span :class="{ over: len > spec.captionMax }" class="num">{{ len.toLocaleString() }} / {{ spec.captionMax.toLocaleString() }} characters</span>
      <span :class="{ over: tags > spec.hashtagMax }" class="num">{{ tags }} / {{ spec.hashtagMax }} hashtags</span>
    </div>

    <Field v-if="platform === 'youtube'" label="Title" :hint="`${(modelValue.title ?? '').length} / 100`" :error="(modelValue.title ?? '').length > 100 ? 'YouTube titles stop at 100 characters' : null" class="mt-4">
      <input class="input" :value="modelValue.title ?? ''" placeholder="Defaults to the first line of the caption" @input="set('title', ($event.target as HTMLInputElement).value)" />
    </Field>

    <Field v-if="hasFirstComment" :label="firstLabel" hint="Posted right after publishing — a good place for hashtags or a link." class="mt-4">
      <textarea v-autosize class="textarea" rows="2" :value="modelValue.firstComment ?? ''" data-max="200" @input="set('firstComment', ($event.target as HTMLTextAreaElement).value)" />
    </Field>

    <Field v-if="platform === 'facebook'" label="Facebook Page" hint="Which Page to post as, when the account manages more than one." class="mt-4">
      <input class="input" :value="modelValue.fbPageName ?? ''" placeholder="Page name" @input="set('fbPageName', ($event.target as HTMLInputElement).value)" />
    </Field>

    <div v-if="platform === 'tiktok'" class="mt-4 col gap-4">
      <Field label="Who can watch">
        <Select :model-value="modelValue.tiktokPrivacy ?? 'public'" :options="[{ value: 'public', label: 'Everyone' }, { value: 'friends', label: 'Friends' }, { value: 'private', label: 'Only me' }]" @update:model-value="set('tiktokPrivacy', $event)" />
      </Field>
      <div class="toggles">
        <Toggle :model-value="modelValue.allowComments ?? true" label="Comments" @update:model-value="set('allowComments', $event)" />
        <Toggle :model-value="modelValue.allowDuet ?? true" label="Duet" @update:model-value="set('allowDuet', $event)" />
        <Toggle :model-value="modelValue.allowStitch ?? true" label="Stitch" @update:model-value="set('allowStitch', $event)" />
      </div>
    </div>

    <div v-if="platform === 'instagram' && kind === 'reel'" class="mt-4">
      <Toggle :model-value="modelValue.igShareToFeed ?? true" label="Also share to feed" hint="Shows the reel on the profile grid, not only in Reels." @update:model-value="set('igShareToFeed', $event)" />
    </div>

    <div v-if="coverable && video" class="mt-5">
      <div class="label mb-2">Cover frame</div>
      <div class="cover">
        <video ref="vid" :src="fileUrl(video.path)" muted preload="metadata" playsinline @loadedmetadata="onMeta" />
        <div class="grow col gap-2">
          <input type="range" class="range" min="0" :max="Math.max(0, dur - 100)" step="100" :value="cover" aria-label="Cover frame time" @input="set('coverMs', Number(($event.target as HTMLInputElement).value))" />
          <div class="row between tiny muted"><span class="num">{{ clock(cover) }}</span><span class="num">{{ clock(dur) }}</span></div>
          <p class="tiny muted">Drag to choose the frame {{ spec.name }} shows before the video plays.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.counts { display: flex; gap: 14px; margin-top: 6px; color: var(--muted); }
.over { color: var(--bad); font-weight: 600; }
.toggles { display: flex; gap: 24px; flex-wrap: wrap; }
.cover { display: flex; gap: 16px; align-items: center; }
.cover video { width: 96px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 6px; background: #000; flex: none; }
.range { width: 100%; accent-color: var(--fg); }
</style>
