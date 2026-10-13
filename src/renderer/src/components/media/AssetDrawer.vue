<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { MediaAsset, Post } from '@shared/types';
import { FIT_TARGETS } from '@shared/platforms';
import Drawer from '@/components/ui/Drawer.vue';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import StatusChip from '@/components/posts/StatusChip.vue';
import Icon from '@/components/ui/Icon.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import { api, fileUrl } from '@/lib/api';
import { bytes, dateTime } from '@/lib/format';
import { fail, ok } from '@/composables/toast';
import { confirm } from '@/composables/confirm';
import { clock, fmtWhen } from '@/components/posts/time';
import { brandName } from '@/components/posts/meta';
import { aspectLabel } from './fit';

/** Everything about one library file: preview, facts, tags, fit per target, where it is used. */
const props = defineProps<{ asset: MediaAsset | null }>();
const emit = defineEmits<{ close: []; changed: [a: MediaAsset]; removed: [id: string] }>();
const router = useRouter();

const open = computed(() => !!props.asset);
const tags = ref<string[]>([]);
const tagInput = ref('');
const usage = ref<Post[] | null>(null);
const usageErr = ref<string | null>(null);
const saving = ref(false);
const previewErr = ref(false);

watch(() => props.asset?.id, async id => {
  previewErr.value = false;
  tags.value = [...(props.asset?.tags ?? [])];
  usage.value = null; usageErr.value = null;
  if (!id) return;
  try { usage.value = await api('media.usage', { id }); } catch (e) { usageErr.value = (e as Error).message; }
}, { immediate: true });

const fits = computed(() => {
  const a = props.asset; if (!a) return [];
  return FIT_TARGETS.filter(t => a.platformFit?.[t.id]).map(t => ({ t, level: a.platformFit[t.id], notes: a.fitNotes?.[t.id] ?? [] }));
});

async function saveTags(next: string[]) {
  if (!props.asset) return;
  const before = tags.value;
  tags.value = next;
  saving.value = true;
  try { emit('changed', await api('media.update', { id: props.asset.id, tags: next })); }
  catch (e) { tags.value = before; fail(e, 'Could not save tags'); }
  finally { saving.value = false; }
}
function addTag() {
  const t = tagInput.value.trim().replace(/^#/, '');
  tagInput.value = '';
  if (!t || tags.value.includes(t)) return;
  void saveTags([...tags.value, t]);
}
const removeTag = (t: string) => void saveTags(tags.value.filter(x => x !== t));
function tagKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
  else if (e.key === 'Backspace' && !tagInput.value && tags.value.length) removeTag(tags.value[tags.value.length - 1]);
}

// a missing file can't be selected in Explorer: open the folder it was in instead
const folderOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
async function reveal() { try { const a = props.asset; if (a) await api('app.revealPath', { path: a.missing ? folderOf(a.path) : a.path }); } catch (e) { fail(e); } }
const CODEC: Record<string, string> = { mjpeg: 'JPEG', png: 'PNG', webp: 'WebP', gif: 'GIF', hevc: 'HEVC', h264: 'H.264', vp9: 'VP9', av1: 'AV1', prores: 'ProRes' };
const codecLabel = (c: string) => CODEC[c.toLowerCase()] ?? c;
async function remove() {
  const a = props.asset; if (!a) return;
  if (!(await confirm({ title: `Remove ${a.filename} from the library?`, body: 'The file stays where it is on disk — only the library entry goes. Posts that use it keep their reference.', confirm: 'Remove', danger: true }))) return;
  try { await api('media.remove', { ids: [a.id] }); ok('Removed from the library'); emit('removed', a.id); }
  catch (e) { fail(e); }
}
</script>

<template>
  <Drawer :open="open" :title="asset?.filename" eyebrow="Media" :width="600" @update:open="v => !v && emit('close')">
    <template v-if="asset">
      <div class="preview">
        <video v-if="asset.kind === 'video' && !previewErr && !asset.missing" :key="asset.id" controls preload="metadata" :src="fileUrl(asset.path)" :poster="asset.thumb ? fileUrl(asset.thumb) : undefined" @error="previewErr = true" />
        <img v-else-if="asset.kind === 'image' && !previewErr && !asset.missing" :src="fileUrl(asset.path)" alt="" :class="{ alpha: /\.(png|webp|gif|svg|avif)$/i.test(asset.filename) }" @error="previewErr = true" />
        <div v-else class="noprev"><Icon name="warn" :size="18" /><span class="small">{{ asset.missing ? 'The file is missing from disk.' : 'Preview not available for this file.' }}</span></div>
      </div>
      <div v-if="asset.missing" class="warnline small"><Icon name="warn" :size="14" />The file was moved or deleted. Put it back or remove it from the library.</div>

      <dl class="facts mt-4">
        <dt>Type</dt><dd>{{ asset.kind === 'video' ? 'Video' : 'Image' }}<span v-if="asset.codec" class="muted"> · {{ codecLabel(asset.codec) }}</span></dd>
        <dt>Size</dt><dd class="num">{{ asset.width && asset.height ? `${asset.width}×${asset.height}` : '—' }} · {{ aspectLabel(asset) }}</dd>
        <template v-if="asset.kind === 'video'"><dt>Length</dt><dd class="num">{{ clock(asset.durationMs) || '—' }}<span v-if="asset.fps" class="muted"> · {{ Math.round(asset.fps) }} fps</span></dd></template>
        <dt>File size</dt><dd class="num">{{ bytes(asset.sizeBytes) }}</dd>
        <dt>Added</dt><dd>{{ dateTime(asset.addedAt) }}</dd>
        <dt>Path</dt><dd class="code path">{{ asset.path }}</dd>
      </dl>

      <section class="mt-5">
        <div class="label mb-2">Tags</div>
        <div class="tagbox" :class="{ saving }" @click="($refs.ti as HTMLInputElement)?.focus()">
          <span v-for="t in tags" :key="t" class="tag">{{ t }}<button type="button" :aria-label="`Remove tag ${t}`" @click.stop="removeTag(t)"><Icon name="close" :size="11" /></button></span>
          <input ref="ti" v-model="tagInput" class="ti" :placeholder="tags.length ? '' : 'Add a tag and press Enter'" aria-label="Add tag" @keydown="tagKey" @blur="tagInput.trim() && addTag()" />
        </div>
      </section>

      <section class="mt-5">
        <div class="label mb-2">Platform fit</div>
        <ul v-if="fits.length" class="fitlist">
          <li v-for="f in fits" :key="f.t.id">
            <PlatformIcon :platform="f.t.platform" :size="14" />
            <span class="fl">{{ f.t.label }}</span>
            <span class="grow notes small muted">{{ f.notes.join(' · ') || (f.level === 'ok' ? 'fits' : '') }}</span>
            <Chip size="sm" :tone="f.level === 'ok' ? 'good' : f.level === 'warn' ? 'warn' : 'bad'">{{ f.level === 'ok' ? 'OK' : f.level === 'warn' ? 'Check' : 'No' }}</Chip>
          </li>
        </ul>
        <p v-else class="small muted">No fit data yet — it appears once the file has been analysed.</p>
      </section>

      <section class="mt-5">
        <div class="label mb-2">Used in</div>
        <p v-if="usageErr" class="small muted">Could not load where this is used — {{ usageErr }}</p>
        <div v-else-if="usage === null" class="skel-line" style="width: 60%" />
        <p v-else-if="!usage.length" class="small muted">Not used in any post yet.</p>
        <ul v-else class="uses">
          <li v-for="p in usage" :key="p.id">
            <button type="button" class="use" @click="router.push({ path: '/compose', query: { post: p.id } })">
              <span class="grow ellipsis">{{ brandName(p.brandId) }} · {{ p.caption || 'No caption' }}</span>
              <span class="tiny muted nowrap">{{ fmtWhen(p.scheduledAt, { zone: false }) }}</span>
              <StatusChip size="sm" :status="p.status" />
            </button>
          </li>
        </ul>
      </section>
    </template>
    <template #footer>
      <Btn variant="danger" size="sm" icon="trash" @click="remove">Remove from library</Btn>
      <span class="grow" />
      <Btn size="sm" icon="folder" :title="asset?.missing ? 'Open the folder the file was in' : undefined" @click="reveal">Show in folder</Btn>
      <Btn size="sm" variant="primary" icon="compose" :disabled="asset?.missing" :title="asset?.missing ? 'The file is missing — put it back first' : undefined" :to="asset?.missing ? undefined : { path: '/compose', query: { media: asset?.id } }">Use in a post</Btn>
    </template>
  </Drawer>
</template>

<style scoped>
.preview { border-radius: var(--r-lg); background: #0b0b0a; overflow: hidden; display: grid; place-items: center; min-height: 200px; }
.preview video { width: 100%; max-height: 52vh; object-fit: contain; display: block; }
/* the image box hugs the picture: a 1px edge so a black (or white) image never reads as a hole, and
   formats that can be transparent sit on a checkerboard */
.preview img { display: block; width: auto; height: auto; max-width: 100%; max-height: 52vh; outline: 1px solid var(--line); outline-offset: -1px; }
.preview img.alpha { background: repeating-conic-gradient(#d9d6cc 0 25%, #f3efe4 0 50%) 0 0 / 16px 16px; }
.noprev { display: flex; align-items: center; gap: 8px; color: #a19e94; padding: 40px 16px; }
.warnline { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--bad); }
.path { font-size: var(--fs-2xs); text-align: right; word-break: break-all; font-weight: 400; color: var(--fg-2); }
.tagbox { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 40px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r); background: var(--panel); cursor: text; transition: border-color 150ms; }
.tagbox:focus-within { border-color: var(--focus-border); box-shadow: var(--focus-ring); }
.tagbox.saving { opacity: .75; }
.tag { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 9px; border-radius: 99px; background: var(--panel-2); font-size: var(--fs-sm); }
.tag button { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); }
.tag button:hover { background: var(--line); color: var(--fg); }
.ti { flex: 1; min-width: 120px; border: 0; background: none; outline: none; height: 26px; font-size: var(--fs-sm); }
.ti:focus-visible { box-shadow: none; outline: none; }
.fitlist li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line-soft); }
.fitlist li:first-child { border-top: 0; }
.fl { width: 120px; flex: none; font-size: var(--fs-sm); font-weight: 500; }
.notes { line-height: 1.35; }
.uses { display: flex; flex-direction: column; }
.use { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 6px; border-top: 1px solid var(--line-soft); text-align: left; font-size: var(--fs-sm); border-radius: var(--r); }
.uses li:first-child .use { border-top: 0; }
.use:hover { background: var(--panel-hover); }
</style>
