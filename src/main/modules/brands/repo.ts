// Brand / group / tag rows ↔ domain objects. Other modules read brands through these helpers.
import type { AccountSummary, Brand, BrandRow, BrandStatus, Group, LoginState, Tag } from '@shared/types'
import { b, db, j, pj } from '../../core/db'
import { notFound } from '../../core/errors'
import { emit } from '../../core/events'
import { paths } from '../../core/paths'

export interface BrandDbRow {
  id: string
  serial: number
  name: string
  slug: string
  logo: string | null
  color: string
  group_id: string | null
  tags: string
  notes: string
  sort: number
  cdp_port: number | null
  pid: number | null
  chrome_path: string | null
  startup_urls: string
  window: string
  downloads_dir: string | null
  approval_required: number
  status: string
  status_error: string | null
  last_opened_at: string | null
  created_at: string
  deleted_at: string | null
}

export function mapBrand(r: BrandDbRow): Brand {
  return {
    id: r.id,
    serial: r.serial,
    name: r.name,
    slug: r.slug,
    logo: r.logo,
    color: r.color,
    groupId: r.group_id,
    tags: pj<string[]>(r.tags, []),
    notes: r.notes,
    sort: r.sort,
    profileDir: paths.profile(r.slug),
    cdpPort: r.cdp_port,
    pid: r.pid,
    chromePath: r.chrome_path,
    startupUrls: pj<string[]>(r.startup_urls, []),
    window: pj(r.window, { width: 1280, height: 900 }),
    downloadsDir: r.downloads_dir,
    approvalRequired: b(r.approval_required),
    status: r.status as BrandStatus,
    statusError: r.status_error,
    lastOpenedAt: r.last_opened_at,
    createdAt: r.created_at,
    deletedAt: r.deleted_at
  }
}

/** Brand by id (including recycle bin). Throws if missing. */
export function getBrand(id: string): Brand {
  const r = db.get<BrandDbRow>('SELECT * FROM brands WHERE id = ?', id)
  if (!r) throw notFound('Brand')
  return mapBrand(r)
}

export function findBrand(id: string): Brand | null {
  const r = db.get<BrandDbRow>('SELECT * FROM brands WHERE id = ?', id)
  return r ? mapBrand(r) : null
}

/** Resolve a brand by id, slug, serial ("#3" / "3") or case-insensitive name — used by MCP/API. */
export function resolveBrand(ref: string): Brand {
  const s = ref.trim()
  const serial = /^#?\d+$/.test(s) ? Number(s.replace('#', '')) : null
  const r =
    db.get<BrandDbRow>('SELECT * FROM brands WHERE deleted_at IS NULL AND (id = ? OR slug = ? OR lower(name) = lower(?) OR serial = ?)', s, s, s, serial ?? -1) ??
    db.get<BrandDbRow>("SELECT * FROM brands WHERE deleted_at IS NULL AND lower(name) LIKE lower(?) || '%' ORDER BY serial", s)
  if (!r) throw notFound(`Brand "${ref}"`)
  return mapBrand(r)
}

export function listBrandsRaw(includeDeleted = false): Brand[] {
  return db.all<BrandDbRow>(`SELECT * FROM brands ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY sort, serial`).map(mapBrand)
}

interface AccountSumRow {
  id: string
  brand_id: string
  platform: string
  handle: string
  login_state: string
  age_tier: string
  cookie_expires_at: string | null
}

export function toBrandRows(brands: Brand[]): BrandRow[] {
  if (!brands.length) return []
  const accs = db.all<AccountSumRow>('SELECT id, brand_id, platform, handle, login_state, age_tier, cookie_expires_at FROM accounts ORDER BY created_at')
  const byBrand = new Map<string, AccountSummary[]>()
  for (const a of accs) {
    const list = byBrand.get(a.brand_id) ?? []
    list.push({ id: a.id, platform: a.platform as AccountSummary['platform'], handle: a.handle, loginState: a.login_state as LoginState, ageTier: a.age_tier as AccountSummary['ageTier'], cookieExpiresAt: a.cookie_expires_at })
    byBrand.set(a.brand_id, list)
  }
  const groups = new Map(db.all<{ id: string; name: string }>('SELECT id, name FROM groups').map((g) => [g.id, g.name]))
  const upcoming = new Map(
    db
      .all<{ brand_id: string; n: number }>("SELECT brand_id, count(*) n FROM posts WHERE status IN ('queued','approved','ready_for_approval') AND (scheduled_at IS NULL OR scheduled_at >= ?) GROUP BY brand_id", new Date().toISOString())
      .map((r) => [r.brand_id, r.n])
  )
  return brands.map((br) => ({ ...br, accounts: byBrand.get(br.id) ?? [], groupName: br.groupId ? (groups.get(br.groupId) ?? null) : null, upcoming: upcoming.get(br.id) ?? 0 }))
}

export function getBrandRow(id: string): BrandRow {
  return toBrandRows([getBrand(id)])[0]
}

/** Update live status (launcher calls this) and notify the UI. */
export function setBrandStatus(id: string, status: BrandStatus, extra: { cdpPort?: number | null; pid?: number | null; error?: string | null } = {}): void {
  const sets = ['status = ?', 'status_error = ?']
  const vals: (string | number | null)[] = [status, extra.error ?? null]
  if (extra.cdpPort !== undefined) { sets.push('cdp_port = ?'); vals.push(extra.cdpPort) }
  if (extra.pid !== undefined) { sets.push('pid = ?'); vals.push(extra.pid) }
  if (status === 'open') { sets.push('last_opened_at = ?'); vals.push(new Date().toISOString()) }
  db.run(`UPDATE brands SET ${sets.join(', ')} WHERE id = ?`, ...vals, id)
  emit('brand.status', { id, status, error: extra.error ?? null })
}

export function nextSerial(): number {
  return (db.get<{ m: number | null }>('SELECT max(serial) m FROM brands')?.m ?? 0) + 1
}

export function uniqueSlug(base: string): string {
  let slug = base
  for (let i = 2; db.get('SELECT 1 FROM brands WHERE slug = ?', slug); i++) slug = `${base}-${i}`
  return slug
}

export const mapGroup = (r: { id: string; name: string; color: string; sort: number; count?: number }): Group => ({ id: r.id, name: r.name, color: r.color, sort: r.sort, count: r.count ?? 0 })
export const mapTag = (r: { id: string; name: string; color: string; count?: number }): Tag => ({ id: r.id, name: r.name, color: r.color, count: r.count ?? 0 })

export function ensureTags(names: string[]): void {
  for (const n of names) {
    const name = n.trim()
    if (name) db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING', 'tag_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Math.random().toString(36).slice(2, 6), name, '#8b8981')
  }
}

export { j }
