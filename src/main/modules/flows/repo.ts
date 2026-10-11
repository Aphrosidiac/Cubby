// flows table ↔ Flow, plus the media lookup the loop step uses.
import type { Flow, FlowStep } from '@shared/types'
import { b, db, j, pj } from '../../core/db'
import { notFound } from '../../core/errors'
import { newId, nowIso } from '../../core/ids'
import type { MediaRef } from './engine'

interface FlowRow {
  id: string
  name: string
  brand_scope: string
  brand_ids: string
  steps: string
  schedule: string | null
  enabled: number
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export const mapFlow = (r: FlowRow): Flow => ({
  id: r.id,
  name: r.name,
  brandScope: (r.brand_scope as Flow['brandScope']) || 'one',
  brandIds: pj<string[]>(r.brand_ids, []),
  steps: pj<FlowStep[]>(r.steps, []),
  schedule: r.schedule,
  enabled: b(r.enabled),
  nextRunAt: r.next_run_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listFlows(): Flow[] {
  return db.all<FlowRow>('SELECT * FROM flows ORDER BY name COLLATE NOCASE, created_at').map(mapFlow)
}

export function getFlow(id: string): Flow {
  const r = db.get<FlowRow>('SELECT * FROM flows WHERE id = ?', id)
  if (!r) throw notFound('Flow')
  return mapFlow(r)
}

export interface FlowFields {
  name: string
  brandScope: Flow['brandScope']
  brandIds: string[]
  steps: FlowStep[]
  schedule: string | null
  enabled: boolean
  nextRunAt: string | null
}

export function insertFlow(f: FlowFields): Flow {
  const id = newId('flow_')
  const at = nowIso()
  db.run(
    'INSERT INTO flows (id, name, brand_scope, brand_ids, steps, schedule, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, f.name, f.brandScope, j(f.brandIds), j(f.steps), f.schedule, f.enabled, f.nextRunAt, at, at
  )
  return getFlow(id)
}

export function saveFlow(id: string, f: FlowFields): Flow {
  db.run(
    'UPDATE flows SET name = ?, brand_scope = ?, brand_ids = ?, steps = ?, schedule = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
    f.name, f.brandScope, j(f.brandIds), j(f.steps), f.schedule, f.enabled, f.nextRunAt, nowIso(), id
  )
  return getFlow(id)
}

export function setNextRun(id: string, nextRunAt: string | null): void {
  db.run('UPDATE flows SET next_run_at = ? WHERE id = ?', nextRunAt, id)
}

/** Enabled scheduled flows due at `now`. */
export function dueFlows(now: Date): Flow[] {
  return db.all<FlowRow>("SELECT * FROM flows WHERE enabled = 1 AND schedule IS NOT NULL AND schedule <> '' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at", now.toISOString()).map(mapFlow)
}

/** Media for loop_media: picked ids in the order given, or every non-missing file with the tag. */
export function mediaFor(sel: { assetIds?: string[]; tag?: string }): MediaRef[] {
  if (sel.assetIds?.length) {
    const rows = new Map(
      db
        .all<MediaRef & { missing: number }>(`SELECT id, path, filename, missing FROM media WHERE id IN (${sel.assetIds.map(() => '?').join(',')})`, ...sel.assetIds)
        .filter((r) => !b(r.missing))
        .map((r) => [r.id, { id: r.id, path: r.path, filename: r.filename }])
    )
    return sel.assetIds.map((id) => rows.get(id)).filter((x): x is MediaRef => !!x)
  }
  if (sel.tag?.trim()) {
    return db.all<MediaRef>(
      'SELECT id, path, filename FROM media WHERE missing = 0 AND EXISTS (SELECT 1 FROM json_each(media.tags) t WHERE lower(t.value) = lower(?)) ORDER BY added_at, filename',
      sel.tag.trim()
    )
  }
  return []
}
