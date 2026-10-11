// Post / slot rows ↔ domain objects (JSON columns via j/pj). Other modules read posts through these.
import type { Post, PostKind, PostStatus, Slot } from '@shared/types'
import { db, j, pj } from '../../core/db'
import { notFound } from '../../core/errors'
import { nowIso } from '../../core/ids'

export interface PostDbRow {
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

export const mapPost = (r: PostDbRow): Post => ({
  id: r.id,
  brandId: r.brand_id,
  accountIds: pj<string[]>(r.account_ids, []),
  kind: r.kind as PostKind,
  assetIds: pj<string[]>(r.asset_ids, []),
  caption: r.caption,
  perPlatform: pj<Post['perPlatform']>(r.per_platform, {}),
  scheduledAt: r.scheduled_at,
  status: r.status as PostStatus,
  approval: pj<Post['approval']>(r.approval, null),
  screens: pj<Post['screens']>(r.screens, []),
  results: pj<Post['results']>(r.results, []),
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function findPost(id: string): Post | null {
  const r = db.get<PostDbRow>('SELECT * FROM posts WHERE id = ?', id)
  return r ? mapPost(r) : null
}

export function getPost(id: string): Post {
  const p = findPost(id)
  if (!p) throw notFound('Post')
  return p
}

export interface PostFilter {
  brandId?: string
  status?: string[]
  from?: string
  to?: string
  limit?: number
}

/** Posts newest-first; with a time range (calendar), by scheduled time ascending. */
export function listPosts(f: PostFilter = {}): Post[] {
  const where: string[] = []
  const vals: string[] = []
  if (f.brandId) { where.push('brand_id = ?'); vals.push(f.brandId) }
  if (f.status?.length) { where.push(`status IN (${f.status.map(() => '?').join(',')})`); vals.push(...f.status) }
  if (f.from) { where.push('scheduled_at >= ?'); vals.push(new Date(f.from).toISOString()) }
  if (f.to) { where.push('scheduled_at <= ?'); vals.push(new Date(f.to).toISOString()) }
  const order = f.from || f.to ? 'scheduled_at ASC' : 'COALESCE(scheduled_at, created_at) DESC'
  const limit = Math.max(1, Math.min(f.limit ?? 500, 5000))
  return db.all<PostDbRow>(`SELECT * FROM posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${limit}`, ...vals).map(mapPost)
}

export function insertPost(p: Post): void {
  db.run(
    `INSERT INTO posts (id, brand_id, account_ids, kind, asset_ids, caption, per_platform, scheduled_at, status, approval, screens, results, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.id, p.brandId, j(p.accountIds), p.kind, j(p.assetIds), p.caption, j(p.perPlatform), p.scheduledAt, p.status,
    p.approval ? j(p.approval) : null, j(p.screens), j(p.results), p.error, p.createdAt, p.updatedAt
  )
}

const COLS: Record<keyof Omit<Post, 'id' | 'brandId' | 'createdAt' | 'updatedAt'>, [string, (v: never) => string | null]> = {
  accountIds: ['account_ids', (v) => j(v)],
  kind: ['kind', (v) => v],
  assetIds: ['asset_ids', (v) => j(v)],
  caption: ['caption', (v) => v],
  perPlatform: ['per_platform', (v) => j(v)],
  scheduledAt: ['scheduled_at', (v) => v ?? null],
  status: ['status', (v) => v],
  approval: ['approval', (v) => (v ? j(v) : null)],
  screens: ['screens', (v) => j(v)],
  results: ['results', (v) => j(v)],
  error: ['error', (v) => v ?? null]
}

/** Write the given fields (updated_at always moves). Returns the fresh post. */
export function savePost(id: string, patch: Partial<Post>): Post {
  const sets: string[] = ['updated_at = ?']
  const vals: (string | null)[] = [nowIso()]
  for (const [k, v] of Object.entries(patch)) {
    const c = COLS[k as keyof typeof COLS]
    if (!c || v === undefined) continue
    sets.push(`${c[0]} = ?`)
    vals.push(c[1](v as never))
  }
  db.run(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`, ...vals, id)
  return getPost(id)
}

/**
 * Compare-and-set on status: only writes when the row still has `from` (guards double runs).
 * Synchronous read + write with no await in between, so it is atomic in the main process.
 */
export function casStatus(id: string, from: PostStatus, patch: Partial<Post> & { status: PostStatus }): Post | null {
  const cur = findPost(id)
  if (!cur || cur.status !== from) return null
  return savePost(id, patch)
}

export function deletePostRow(id: string): void {
  db.run('DELETE FROM posts WHERE id = ?', id)
}

// ── slots ─────────────────────────────────────────────────────────────────────
interface SlotRow {
  id: string
  brand_id: string
  weekdays: string
  time: string
}
const mapSlot = (r: SlotRow): Slot => ({ id: r.id, brandId: r.brand_id, weekdays: pj<number[]>(r.weekdays, []), time: r.time })

export function listSlots(brandId?: string): Slot[] {
  const rows = brandId ? db.all<SlotRow>('SELECT * FROM slots WHERE brand_id = ? ORDER BY time', brandId) : db.all<SlotRow>('SELECT * FROM slots ORDER BY brand_id, time')
  return rows.map(mapSlot)
}

export function replaceSlots(brandId: string, slots: { id: string; weekdays: number[]; time: string }[]): void {
  db.tx(() => {
    db.run('DELETE FROM slots WHERE brand_id = ?', brandId)
    for (const s of slots) db.run('INSERT INTO slots (id, brand_id, weekdays, time) VALUES (?, ?, ?, ?)', s.id, brandId, j(s.weekdays), s.time)
  })
}
