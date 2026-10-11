<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { MediaAsset, Platform, Post } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import ImageZoom from '@/components/media/ImageZoom.vue';
import { api, fileUrl } from '@/lib/api';
import { ago } from '@/lib/format';
import { fail, ok } from '@/composables/toast';
import { confirm } from '@/composables/confirm';
import { KIND_LABEL, brandById } from './meta';
import { fmtWhen } from './time';

/** One prepared post waiting for a yes: caption, media, and per account the screenshot of the filled composer. */
const props = defineProps<{ post: Post; media: Map<string, MediaAsset>; selected: boolean }>();
const emit = defineEmits<{ 'update:selected': [v: boolean]; done: []; picked: [accountIds: string[]] }>();
const router = useRouter();
const busy = ref<string | null>(null);
const zoom = ref<number | null>(null);
const expanded = ref(false);

const brand = computed(() => brandById(props.post.brandId));
const accounts = computed(() => props.post.accountIds.map(id => {
  const a = brand.value?.accounts.find(x => x.id === id);
  const screen = [...props.post.screens].reverse().find(s => s.accountId === id) ?? null;
  return { id, platform: a?.platform ?? 'custom', handle: a?.handle ?? 'account', screen, approved: !!props.post.approval?.accountIds?.includes(id) };
}));
const images = computed(() => accounts.value.filter(a => a.screen).map(a => ({ path: a.screen!.path, label: `${a.handle} · prepared ${ago(a.screen!.at)}` })));
const zoomFor = (path: string) => (zoom.value = images.value.findIndex(i => i.path === path));
const assets = computed(() => props.post.assetIds.map(id => props.media.get(id)).filter((a): a is MediaAsset => !!a));
const long = computed(() => props.post.caption.length > 220);
/** platforms on this post that use their own caption (shown, so the approver reads what will really go out) */
const overrides = computed(() => Object.entries(props.post.perPlatform ?? {})
  .filter(([p, o]) => o?.caption?.trim() && accounts.value.some(a => a.platform === p))
  .map(([p, o]) => ({ platform: p as Platform, name: PLATFORM_SPECS[p as Platform]?.name ?? p, caption: o!.caption!.trim() })));

// Approving a subset publishes to those accounts only; the rest of the post is dropped for them.
const picked = ref<string[]>([]);
watch(() => props.post.accountIds.join(), () => (picked.value = [...props.post.accountIds]), { immediate: true });
const togglePick = (id: string) => { picked.value = picked.value.includes(id) ? picked.value.filter(x => x !== id) : [...picked.value, id]; };
const partial = computed(() => picked.value.length < props.post.accountIds.length);
// the page's batch approve uses the same picks as this card's own button
watch(picked, v => emit('picked', props.post.accountIds.filter(id => v.includes(id))), { immediate: true });
async function approve() {
  if (!picked.value.length) return;
  const accountIds = partial.value ? props.post.accountIds.filter(id => picked.value.includes(id)) : undefined;
  if (accountIds) {
    const skipped = accounts.value.filter(a => !accountIds.includes(a.id)).map(a => a.handle).join(', ');
    if (!(await confirm({ title: `Approve ${accountIds.length} of ${props.post.accountIds.length} accounts?`, body: `This post will not go to ${skipped}.`, confirm: 'Approve' }))) return;
  }
  busy.value = 'all';
  try {
    await api('posts.approve', { id: props.post.id, accountIds });
    ok(accountIds ? `Approved for ${accountIds.length} of ${props.post.accountIds.length} accounts` : 'Approved', props.post.scheduledAt ? `Goes out ${fmtWhen(props.post.scheduledAt)}` : 'Goes out as soon as pacing allows');
    emit('done');
  } catch (e) { fail(e, 'Could not approve'); }
  finally { busy.value = null; }
}
async function reject() {
  const reason = await confirm({ title: 'Reject this post?', body: 'It goes back to draft so it can be edited; nothing is posted.', confirm: 'Reject', danger: true, input: { label: 'Reason (optional)', placeholder: 'e.g. wrong cover, typo in caption', required: false, multiline: true } });
  if (reason === null) return;
  busy.value = 'reject';
  try { await api('posts.reject', { id: props.post.id, reason: reason || undefined }); ok('Rejected', 'It is a draft again — edit it and send it again from the composer.'); emit('done'); }
  catch (e) { fail(e, 'Could not reject'); }
  finally { busy.value = null; }
}
</script>

<template>
  <article class="card" :class="{ sel: selected }">
    <header class="ch">
      <label class="cb"><input type="checkbox" :checked="selected" :aria-label="`Select post for ${brand?.name}`" @change="emit('update:selected', ($event.target as HTMLInputElement).checked)" /></label>
      <div class="grow">
        <div class="row gap-2 wrap">
          <span class="strong" :title="post.scheduledAt ? 'Goes out at this time once approved' : 'No time set — goes out as soon as it is approved and pacing allows'">{{ post.scheduledAt ? fmtWhen(post.scheduledAt) : 'As soon as approved' }}</span>
          <span class="kind mono">{{ KIND_LABEL[post.kind] }}</span>
        </div>
        <div class="tiny muted">{{ accounts.length }} {{ accounts.length === 1 ? 'account' : 'accounts' }} · prepared {{ ago(post.updatedAt) }}</div>
      </div>
      <div class="acts">
        <Btn size="sm" variant="subtle" :loading="busy === 'reject'" @click="reject">Reject</Btn>
        <Btn size="sm" icon="edit" @click="router.push({ path: '/compose', query: { post: post.id } })">Edit</Btn>
        <Btn size="sm" variant="signal" icon="check" :loading="busy === 'all'" :disabled="!picked.length" @click="approve()">{{ !picked.length ? 'Pick an account' : partial ? `Approve ${picked.length} of ${post.accountIds.length}` : 'Approve all' }}</Btn>
      </div>
    </header>

    <div class="body">
      <div class="content">
        <p class="cap pre small" :class="{ clamp: long && !expanded }">{{ post.caption || 'No caption.' }}</p>
        <button v-if="long" type="button" class="more tiny" @click="expanded = !expanded">{{ expanded ? 'Show less' : 'Show all' }}</button>
        <div v-for="o in overrides" :key="o.platform" class="ovr">
          <div class="tiny muted row gap-1"><PlatformIcon :platform="o.platform" :size="12" colored />{{ o.name }} uses its own caption</div>
          <p class="cap pre small clamp">{{ o.caption }}</p>
        </div>
        <div v-if="assets.length" class="media">
          <img v-for="a in assets.slice(0, 6)" :key="a.id" :src="fileUrl(a.thumb)" :alt="a.filename" :title="a.filename" />
          <span v-if="assets.length > 6" class="morem num">+{{ assets.length - 6 }}</span>
        </div>
      </div>
      <div class="screens">
        <div v-for="a in accounts" :key="a.id" class="scr" :class="{ off: !picked.includes(a.id) }">
          <button v-if="a.screen" type="button" class="shot" :aria-label="`Zoom screenshot for ${a.handle}`" @click="zoomFor(a.screen.path)">
            <img :src="fileUrl(a.screen.path)" alt="" loading="lazy" />
            <span class="zoomi"><Icon name="search" :size="14" /></span>
          </button>
          <div v-else class="shot none"><Icon name="image" :size="18" /><span class="tiny">No screenshot</span></div>
          <div class="sf">
            <PlatformIcon :platform="a.platform" :size="14" colored />
            <span class="grow small ellipsis">{{ a.handle }}</span>
            <label v-if="accounts.length > 1" class="pick tiny" :title="picked.includes(a.id) ? 'Included — untick to leave this account out' : 'Left out'">
              <input type="checkbox" :checked="picked.includes(a.id)" :aria-label="`Post to ${a.handle}`" @change="togglePick(a.id)" />{{ picked.includes(a.id) ? 'Post' : 'Skip' }}
            </label>
          </div>
        </div>
      </div>
    </div>
    <ImageZoom v-model:index="zoom" :images="images" />
  </article>
</template>

<style scoped>
.card { border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); overflow: hidden; transition: border-color 200ms, box-shadow 200ms; container-type: inline-size; }
.card.sel { border-color: var(--fg); box-shadow: 0 0 0 1px var(--fg); }
.ch { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--line-soft); flex-wrap: wrap; }
.cb { display: grid; place-items: center; width: 28px; height: 28px; margin: -6px; border-radius: 6px; cursor: pointer; }
.cb:hover { background: var(--panel-2); }
.cb input { width: 16px; height: 16px; accent-color: var(--fg); cursor: pointer; }
.kind { padding: 2px 7px; border-radius: 4px; background: var(--panel-2); color: var(--fg-2); font-size: var(--fs-2xs); text-transform: uppercase; letter-spacing: .04em; }
.acts { display: flex; gap: 6px; flex-wrap: wrap; }
.body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 16px; }
@container (min-width: 720px) { .body { grid-template-columns: minmax(0, .7fr) minmax(0, 1.3fr); } }
.cap { line-height: 1.5; color: var(--fg-2); overflow-wrap: anywhere; }
.clamp { display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.more { color: var(--muted); margin-top: 4px; } .more:hover { color: var(--fg); }
.ovr { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--line); }
.ovr .cap { margin-top: 4px; }
.media { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
.media img { width: 56px; height: 56px; border-radius: 4px; object-fit: cover; background: var(--panel-2); }
.morem { font-size: var(--fs-xs); color: var(--muted); }
.screens { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 10px; }
.scr { border: 1px solid var(--line-soft); border-radius: 6px; overflow: hidden; background: var(--bg-elev); }
.scr.off { opacity: .55; }
.scr.off .shot img { filter: grayscale(1); }
.pick { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); cursor: pointer; }
.pick input { accent-color: var(--fg); width: 15px; height: 15px; }
.shot { position: relative; display: block; width: 100%; aspect-ratio: 4 / 3; background: var(--panel-2); overflow: hidden; }
.shot img { width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform 400ms var(--ease-out); }
.shot:hover img { transform: scale(1.03); }
.zoomi { position: absolute; right: 6px; bottom: 6px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: rgb(11 11 10 / .65); color: #fff; opacity: 0; transition: opacity 200ms; }
.shot:hover .zoomi, .shot:focus-visible .zoomi { opacity: 1; }
.shot.none { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: var(--faint); }
.sf { display: flex; align-items: center; gap: 8px; padding: 8px 10px; min-height: 46px; }
</style>
