// Media helpers shared by the library, the composer's picker and the asset drawer.
import type { FitLevel, MediaAsset, Platform } from '@shared/types';
import { FIT_TARGETS, fmtRatio } from '@shared/platforms';

const RANK: Record<FitLevel, number> = { ok: 0, warn: 1, bad: 2 };

/** Best level per platform across its fit targets ("can this go to Instagram in some form?"). */
export function platformSummary(a: MediaAsset): { platform: Platform; level: FitLevel }[] {
  const best = new Map<Platform, FitLevel>();
  for (const t of FIT_TARGETS) {
    const l = a.platformFit?.[t.id];
    if (!l) continue;
    const cur = best.get(t.platform);
    if (!cur || RANK[l] < RANK[cur]) best.set(t.platform, l);
  }
  return [...best.entries()].map(([platform, level]) => ({ platform, level }));
}

export function aspectLabel(a: Pick<MediaAsset, 'width' | 'height'>): string {
  return a.width && a.height ? fmtRatio(a.width / a.height) : '—';
}

/** Absolute paths of files/folders dropped from Explorer/Finder. */
export function droppedPaths(e: DragEvent): string[] {
  const out: string[] = [];
  for (const f of Array.from(e.dataTransfer?.files ?? [])) {
    try {
      const p = window.cubby.pathForFile(f);
      if (p) out.push(p);
    } catch {
      /* not a real file (dragged text, a browser image) */
    }
  }
  return out;
}

/** True while something from outside the page (files) is being dragged over. */
export const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export const MEDIA_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'];
