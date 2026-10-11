// Words, tones and small lookups the posting screens share (composer, calendar, approvals, drawers),
// so a status reads the same everywhere.
import { reactive } from 'vue';
import type { BrandRow, PostKind, PostStatus, RunStatus } from '@shared/types';
import { api } from '@/lib/api';
import { onTopics } from '@/lib/live';

export const POST_STATUS: Record<PostStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'muted' },
  ready_for_approval: { label: 'Awaiting approval', tone: 'signal' },
  approved: { label: 'Approved', tone: 'good' },
  queued: { label: 'Queued', tone: 'info' },
  running: { label: 'Running', tone: 'warn' },
  needs_human: { label: 'Needs you', tone: 'bad' },
  posted: { label: 'Posted', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' }
};
export const postStatus = (s: string) => POST_STATUS[s as PostStatus] ?? { label: s, tone: 'neutral' };

export const RUN_STATUS: Record<RunStatus, { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'signal' },
  ok: { label: 'Done', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  aborted: { label: 'Aborted', tone: 'muted' },
  needs_human: { label: 'Needs you', tone: 'bad' }
};
export const runStatus = (s: string) => RUN_STATUS[s as RunStatus] ?? { label: s, tone: 'neutral' };

export const KIND_LABEL: Record<PostKind, string> = { reel: 'Reel', video: 'Video', image: 'Image', carousel: 'Carousel', text: 'Text', story: 'Story' };

/** Statuses a person can still change (edit, reschedule, cancel). */
export const EDITABLE: PostStatus[] = ['draft', 'ready_for_approval', 'approved', 'queued', 'failed', 'needs_human'];

/** Every brand, cached app-wide and kept live — most posting screens need names and colours. */
export const brandsState = reactive<{ list: BrandRow[]; loaded: boolean; error: string | null }>({ list: [], loaded: false, error: null });
let started = false;
async function loadBrands() {
  try {
    brandsState.list = await api('brands.list', {});
    brandsState.error = null;
  } catch (e) {
    brandsState.error = (e as Error).message;
  } finally {
    brandsState.loaded = true;
  }
}
export function useBrands() {
  if (!started) {
    started = true;
    void loadBrands();
    onTopics(['brands.changed', 'accounts.changed'], () => void loadBrands());
  }
  return brandsState;
}
export const brandById = (id: string | null | undefined) => (id ? brandsState.list.find(b => b.id === id) ?? null : null);
export const brandColor = (id: string | null | undefined) => brandById(id)?.color ?? 'var(--faint)';
export const brandName = (id: string | null | undefined) => brandById(id)?.name ?? '—';
/** For avatars: the brand, or a neutral stand-in when it was deleted or hasn't loaded. */
export const brandOrStub = (id: string | null | undefined) => brandById(id) ?? { name: '?', color: null, logo: null };
