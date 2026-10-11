// media / watch_folders rows ↔ domain objects.
import type { MediaAsset, Post, WatchFolder } from '@shared/types'
import { b, db, pj } from '../../core/db'

export interface MediaDbRow {
  id: string
  path: string
  filename: string
  kind: string
  hash: string
  duration_ms: number | null
  width: number | null
  height: number | null
  fps: number | null
  codec: string | null
  size_bytes: number
  thumb: string | null
  tags: string
  platform_fit: string
  fit_notes: string
  added_at: string
  missing: number
}

export const mapMedia = (r: MediaDbRow): MediaAsset => ({
  id: r.id,
  path: r.path,
  filename: r.filename,
  kind: r.kind === 'image' ? 'image' : 'video',
  hash: r.hash,
  durationMs: r.duration_ms,
  width: r.width,
  height: r.height,
  fps: r.fps,
  codec: r.codec,
  sizeBytes: r.size_bytes,
  thumb: r.thumb,
  tags: pj<string[]>(r.tags, []),
  platformFit: pj(r.platform_fit, {}),
  fitNotes: pj(r.fit_notes, {}),
  addedAt: r.added_at,
  missing: b(r.missing)
})

export const mapFolder = (r: { id: string; path: string; tags: string }): WatchFolder => ({ id: r.id, path: r.path, tags: pj<string[]>(r.tags, []) })

export function mediaByIds(ids: string[]): MediaAsset[] {
  if (!ids.length) return []
  const rows = db.all<MediaDbRow>(`SELECT * FROM media WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  const byId = new Map(rows.map((r) => [r.id, mapMedia(r)]))
  return ids.map((i) => byId.get(i)).filter((x): x is MediaAsset => !!x)
}

export function mediaByPath(path: string): MediaAsset | null {
  const r = db.get<MediaDbRow>('SELECT * FROM media WHERE path = ?', path)
  return r ? mapMedia(r) : null
}

export function listFolders(): WatchFolder[] {
  return db.all<{ id: string; path: string; tags: string }>('SELECT * FROM watch_folders ORDER BY path').map(mapFolder)
}

interface PostDbRow {
  id: string
  brand_id: string
  account_ids: string
  kind: string
  asset_ids: string
  caption: string
  per_platform: string
  scheduled_at: string | null
  status: string
  approval: string | null
  screens: string
  results: string
  error: string | null
  created_at: string
  updated_at: string
}

/** Posts that use an asset ("used in"). */
export function postsUsing(assetId: string): Post[] {
  return db
    .all<PostDbRow>('SELECT p.* FROM posts p WHERE EXISTS (SELECT 1 FROM json_each(p.asset_ids) WHERE value = ?) ORDER BY coalesce(p.scheduled_at, p.created_at) DESC', assetId)
    .map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      accountIds: pj(r.account_ids, []),
      kind: r.kind as Post['kind'],
      assetIds: pj(r.asset_ids, []),
      caption: r.caption,
      perPlatform: pj(r.per_platform, {}),
      scheduledAt: r.scheduled_at,
      status: r.status as Post['status'],
      approval: pj(r.approval, null),
      screens: pj(r.screens, []),
      results: pj(r.results, []),
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
}
