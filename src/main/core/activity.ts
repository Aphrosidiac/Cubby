// Append-only activity log. Every mutating command lands here via the registry; runs, health
// checks and guardrail stops add their own rows.
import type { Activity, Actor } from '@shared/types'
import { db, j, pj } from './db'
import { emit } from './events'
import { nowIso } from './ids'

export interface ActivityInput {
  actor: Actor
  brandId?: string | null
  action: string
  detail?: Record<string, unknown>
  screen?: string | null
}

export function logActivity(a: ActivityInput): Activity {
  const at = nowIso()
  const r = db.run('INSERT INTO activity (at, actor, brand_id, action, detail, screen) VALUES (?, ?, ?, ?, ?, ?)', at, a.actor, a.brandId ?? null, a.action, j(a.detail ?? {}), a.screen ?? null)
  const brandName = a.brandId ? (db.get<{ name: string }>('SELECT name FROM brands WHERE id = ?', a.brandId)?.name ?? null) : null
  const row: Activity = { id: r.lastInsertRowid, at, actor: a.actor, brandId: a.brandId ?? null, brandName, action: a.action, detail: a.detail ?? {}, screen: a.screen ?? null }
  emit('activity.new', row)
  return row
}

export interface ActivityRow {
  id: number
  at: string
  actor: string
  brand_id: string | null
  brand_name: string | null
  action: string
  detail: string
  screen: string | null
}

export const mapActivity = (r: ActivityRow): Activity => ({
  id: r.id,
  at: r.at,
  actor: r.actor as Actor,
  brandId: r.brand_id,
  brandName: r.brand_name,
  action: r.action,
  detail: pj(r.detail, {}),
  screen: r.screen
})
