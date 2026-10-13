// Words, tones and small lookups the posting screens share (composer, calendar, approvals, drawers),
// so a status reads the same everywhere.
import { reactive } from 'vue';
import type { BrandRow, PostKind, PostStatus, RunStatus } from '@shared/types';
import { api } from '@/lib/api';
import { onTopics } from '@/lib/live';
import { isDark } from '@/lib/store';

export const POST_STATUS: Record<PostStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'muted' },
  ready_for_approval: { label: 'Awaiting approval', tone: 'ink' },
  approved: { label: 'Approved', tone: 'good' },
  queued: { label: 'Queued', tone: 'info' },
  running: { label: 'Running', tone: 'warn' },
  needs_human: { label: 'Needs you', tone: 'bad' },
  posted: { label: 'Posted', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' }
};
/** Statuses that are in progress right now: their chip's dot pulses (StatusChip). */
export const LIVE_STATUS = new Set(['running']);

export const postStatus = (s: string) => POST_STATUS[s as PostStatus] ?? { label: s, tone: 'neutral' };

export const RUN_STATUS: Record<RunStatus, { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'warn' },
  ok: { label: 'Done', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  aborted: { label: 'Aborted', tone: 'muted' },
  needs_human: { label: 'Needs you', tone: 'bad' }
};
export const runStatus = (s: string) => RUN_STATUS[s as RunStatus] ?? { label: s, tone: 'neutral' };

export const KIND_LABEL: Record<PostKind, string> = { reel: 'Reel', video: 'Video', image: 'Image', carousel: 'Carousel', text: 'Text', story: 'Story' };

/** Statuses a person can still change (edit, cancel). */
export const EDITABLE: PostStatus[] = ['draft', 'ready_for_approval', 'approved', 'queued', 'failed', 'needs_human'];
/** Statuses whose time can move (drag on the calendar, Reschedule). Failed / needs-you posts are retried or edited instead. */
export const RESCHEDULABLE: PostStatus[] = ['draft', 'ready_for_approval', 'approved', 'queued'];
/** Failed or stuck posts that can be published again as they are (accounts already posted are skipped). */
export const RETRYABLE: PostStatus[] = ['failed', 'needs_human'];

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

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/**
 * The brand colour as a mark on the current theme's panels: a colour too close to the panel
 * (FF's Ink on dark, a Bone brand on light) falls back to the secondary text colour so it never vanishes.
 */
export function brandMark(id: string | null | undefined): string {
  const c = brandById(id)?.color;
  if (!c) return 'var(--faint)';
  const l = luminance(c);
  if (l === null) return c;
  const panel = isDark() ? 0.0071 : 0.955; // --panel #141413 / #fbfaf6
  const ratio = (Math.max(l, panel) + 0.05) / (Math.min(l, panel) + 0.05);
  return ratio < 1.6 ? 'var(--fg-2)' : c;
}
export const brandName = (id: string | null | undefined) => brandById(id)?.name ?? '—';
/** For avatars: the brand, or a neutral stand-in when it was deleted or hasn't loaded. */
export const brandOrStub = (id: string | null | undefined) => brandById(id) ?? { name: '?', color: null, logo: null };

/** A result's error without the "Instagram @handle: " lead-in when it sits next to that account already. */
export function errorFor(error: string, acc?: { platform: string; handle: string } | null): string {
  if (!acc) return error;
  const h = acc.handle.replace(/^@/, '');
  const m = error.match(/^[A-Za-z ]+ @([^:\s]+): (.+)$/s);
  return m && m[1].toLowerCase() === h.toLowerCase() ? m[2] : error;
}
