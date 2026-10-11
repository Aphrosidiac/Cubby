// Brands, groups and tags: CRUD, recycle bin, ordering, batch actions, CSV batch create.
import { mkdirSync, rmSync } from 'node:fs'
import { parseCsvObjects } from '@shared/csv'
import { PLATFORMS, type Brand, type BrandRow, type Platform } from '@shared/types'
import { db, j } from '../../core/db'
import { UserError } from '../../core/errors'
import { emit } from '../../core/events'
import { newId, nowIso, slugify } from '../../core/ids'
import { paths } from '../../core/paths'
import { implement } from '../../core/registry'
import { requestStatus } from '../../core/runtime'
import { getSettings } from '../../core/settings'
import { insertAccount, type NewAccount } from '../accounts/repo'
import { closeBrand, importChromeProfile, isBrandOpen, openBrand } from '../browser'
import { checkBrandHealth } from '../health'
import { ensureTags, getBrand, getBrandRow, listBrandsRaw, mapGroup, mapTag, nextSerial, toBrandRows, uniqueSlug } from './repo'

const PALETTE = ['#0b0b0a', '#2c4f9c', '#1d6b45', '#a3261d', '#8a5a00', '#6b3fa0', '#0f766e', '#be185d', '#475569', '#b45309']
const RECYCLE_DAYS = 30

function changed(ids?: string[]): void {
  emit('brands.changed', { ids })
  requestStatus()
}

export interface CreateBrandInput {
  name: string
  color?: string
  logo?: string | null
  groupId?: string | null
  tags?: string[]
  notes?: string
  startupUrls?: string[]
  window?: Brand['window']
  downloadsDir?: string | null
  chromePath?: string | null
  approvalRequired?: boolean
  accounts?: NewAccount[]
  importFromChromeProfile?: string
}

export async function createBrand(i: CreateBrandInput): Promise<BrandRow> {
  const name = i.name.trim()
  if (!name) throw new UserError('Brand name is required')
  const s = getSettings()
  const id = newId('br_')
  const serial = nextSerial()
  const slug = uniqueSlug(slugify(name))
  const profileDir = paths.profile(slug)
  mkdirSync(profileDir, { recursive: true })
  if (i.importFromChromeProfile) await importChromeProfile(i.importFromChromeProfile, profileDir)
  const minSort = db.get<{ m: number | null }>('SELECT min(sort) m FROM brands')?.m ?? 0
  db.tx(() => {
    db.run(
      `INSERT INTO brands (id, serial, name, slug, logo, color, group_id, tags, notes, sort, chrome_path, startup_urls, window, downloads_dir, approval_required, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, serial, name, slug, i.logo ?? null, i.color || PALETTE[(serial - 1) % PALETTE.length], i.groupId ?? null, j(i.tags ?? []), i.notes ?? '',
      minSort - 1, i.chromePath ?? null, j(i.startupUrls ?? []), j(i.window ?? s.defaultWindow), i.downloadsDir ?? null, i.approvalRequired ?? s.approvalDefault, nowIso()
    )
    ensureTags(i.tags ?? [])
    for (const a of i.accounts ?? []) insertAccount(id, a)
  })
  changed([id])
  return getBrandRow(id)
}

function matchesFilter(r: BrandRow, f: NonNullable<NonNullable<Parameters<typeof listBrands>[0]>>): boolean {
  if (f.groupId && (f.groupId === 'none' ? r.groupId : r.groupId !== f.groupId)) return false
  if (f.tag && !r.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false
  if (f.platform && !r.accounts.some((a) => a.platform === f.platform)) return false
  if (f.status && r.status !== f.status) return false
  if (f.loginState) {
    const want = f.loginState
    if (want === 'relogin' ? !r.accounts.some((a) => a.loginState === 'expired') : !r.accounts.some((a) => a.loginState === want)) return false
  }
  if (f.q) {
    const q = f.q.toLowerCase().replace(/^#/, '')
    const hay = [r.name, r.slug, String(r.serial), r.notes, r.groupName ?? '', ...r.tags, ...r.accounts.map((a) => a.handle)].join(' ').toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

export function listBrands(filter?: { groupId?: string; tag?: string; platform?: Platform; loginState?: string; status?: string; q?: string; deleted?: boolean }): BrandRow[] {
  const f = filter ?? {}
  const all = listBrandsRaw(true).filter((b) => (f.deleted ? !!b.deletedAt : !b.deletedAt))
  return toBrandRows(all).filter((r) => matchesFilter(r, f))
}

async function purge(ids: string[]): Promise<void> {
  for (const id of ids) {
    const b = getBrand(id)
    if (isBrandOpen(id)) await closeBrand(id).catch(() => {})
    db.run('DELETE FROM brands WHERE id = ?', id)
    try {
      rmSync(b.profileDir, { recursive: true, force: true, maxRetries: 3 })
    } catch (e) {
      console.warn('could not remove profile folder', b.profileDir, e)
    }
  }
  changed(ids)
}

/** Brands in the recycle bin longer than 30 days are deleted for good. */
async function purgeExpired(): Promise<void> {
  const cutoff = new Date(Date.now() - RECYCLE_DAYS * 864e5).toISOString()
  const ids = db.all<{ id: string }>('SELECT id FROM brands WHERE deleted_at IS NOT NULL AND deleted_at < ?', cutoff).map((r) => r.id)
  if (ids.length) await purge(ids)
}

implement({
  'brands.list': ({ filter }) => listBrands(filter),
  'brands.get': ({ id }) => getBrandRow(id),
  'brands.create': (i) => createBrand(i),

  'brands.update': ({ id, patch }) => {
    getBrand(id)
    const map: Record<string, [string, (v: unknown) => unknown]> = {
      name: ['name', (v) => String(v).trim()],
      color: ['color', (v) => v],
      logo: ['logo', (v) => v ?? null],
      groupId: ['group_id', (v) => v ?? null],
      tags: ['tags', (v) => j(v)],
      notes: ['notes', (v) => v],
      startupUrls: ['startup_urls', (v) => j(v)],
      window: ['window', (v) => j(v)],
      downloadsDir: ['downloads_dir', (v) => v ?? null],
      chromePath: ['chrome_path', (v) => v ?? null],
      approvalRequired: ['approval_required', (v) => (v ? 1 : 0)]
    }
    const sets: string[] = []
    const vals: (string | number | null)[] = []
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !map[k]) continue
      sets.push(`${map[k][0]} = ?`)
      vals.push(map[k][1](v) as string | number | null)
    }
    if (sets.length) db.run(`UPDATE brands SET ${sets.join(', ')} WHERE id = ?`, ...vals, id)
    if (patch.tags) ensureTags(patch.tags)
    changed([id])
    return getBrandRow(id)
  },

  'brands.delete': async ({ ids }) => {
    for (const id of ids) {
      if (isBrandOpen(id)) await closeBrand(id).catch(() => {})
    }
    const at = nowIso()
    db.tx(() => ids.forEach((id) => db.run('UPDATE brands SET deleted_at = ? WHERE id = ?', at, id)))
    changed(ids)
  },
  'brands.restore': ({ ids }) => {
    db.tx(() => ids.forEach((id) => db.run('UPDATE brands SET deleted_at = NULL WHERE id = ?', id)))
    changed(ids)
  },
  'brands.purge': ({ ids }) => purge(ids),
  'brands.reorder': ({ ids }) => {
    db.tx(() => ids.forEach((id, i) => db.run('UPDATE brands SET sort = ? WHERE id = ?', i, id)))
    changed(ids)
  },

  'brands.batch': async ({ ids, action, tags, groupId }) => {
    const errors: string[] = []
    let ok = 0
    const each = async (fn: (b: Brand) => Promise<void> | void) => {
      for (const id of ids) {
        try {
          await fn(getBrand(id))
          ok++
        } catch (e) {
          errors.push(`${id}: ${e instanceof Error ? e.message : e}`)
        }
      }
    }
    if (action === 'open') await each((b) => openBrand(b.id, { actor: 'you' }).then(() => {}))
    else if (action === 'close') await each((b) => closeBrand(b.id))
    else if (action === 'health') await each((b) => checkBrandHealth(b.id, false).then(() => {}))
    else if (action === 'addTags' || action === 'removeTags') {
      const t = (tags ?? []).map((x) => x.trim()).filter(Boolean)
      if (action === 'addTags') ensureTags(t)
      await each((b) => {
        const next = action === 'addTags' ? [...new Set([...b.tags, ...t])] : b.tags.filter((x) => !t.some((y) => y.toLowerCase() === x.toLowerCase()))
        db.run('UPDATE brands SET tags = ? WHERE id = ?', j(next), b.id)
      })
    } else if (action === 'move') await each((b) => void db.run('UPDATE brands SET group_id = ? WHERE id = ?', groupId ?? null, b.id))
    else if (action === 'delete') {
      const at = nowIso()
      await each(async (b) => {
        if (isBrandOpen(b.id)) await closeBrand(b.id).catch(() => {})
        db.run('UPDATE brands SET deleted_at = ? WHERE id = ?', at, b.id)
      })
    }
    changed(ids)
    return { ok, errors }
  },

  'brands.batchCreateCsv': async ({ csv }) => {
    // columns: name, group, tags (; separated), notes, color, approval, startup_urls (space separated),
    // and one column per platform holding the handle (instagram, facebook, tiktok, youtube, x, linkedin, threads)
    const rows = parseCsvObjects(csv)
    const errors: string[] = []
    let created = 0
    const groups = new Map(db.all<{ id: string; name: string }>('SELECT id, name FROM groups').map((g) => [g.name.toLowerCase(), g.id]))
    for (const [n, r] of rows.entries()) {
      try {
        if (!r.name) throw new UserError('name is empty')
        let groupId: string | null = null
        if (r.group) {
          groupId = groups.get(r.group.toLowerCase()) ?? null
          if (!groupId) {
            groupId = newId('grp_')
            db.run('INSERT INTO groups (id, name, color, sort) VALUES (?, ?, ?, ?)', groupId, r.group, '#8b8981', groups.size)
            groups.set(r.group.toLowerCase(), groupId)
          }
        }
        const accounts: NewAccount[] = PLATFORMS.filter((p) => p !== 'custom' && r[p]).map((p) => ({ platform: p, handle: r[p], ageTier: (r.age_tier as NewAccount['ageTier']) || 'new' }))
        await createBrand({
          name: r.name,
          groupId,
          tags: r.tags ? r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
          notes: r.notes,
          color: /^#[0-9a-f]{6}$/i.test(r.color ?? '') ? r.color : undefined,
          approvalRequired: r.approval ? !/^(0|no|false|off)$/i.test(r.approval) : undefined,
          startupUrls: r.startup_urls ? r.startup_urls.split(/\s+/).filter(Boolean) : [],
          accounts
        })
        created++
      } catch (e) {
        errors.push(`row ${n + 2}: ${e instanceof Error ? e.message : e}`)
      }
    }
    return { created, errors }
  },

  'groups.list': () =>
    db.all<{ id: string; name: string; color: string; sort: number; count: number }>(
      'SELECT g.*, (SELECT count(*) FROM brands b WHERE b.group_id = g.id AND b.deleted_at IS NULL) count FROM groups g ORDER BY sort, name'
    ).map(mapGroup),
  'groups.create': ({ name, color }) => {
    const id = newId('grp_')
    const sort = (db.get<{ m: number | null }>('SELECT max(sort) m FROM groups')?.m ?? -1) + 1
    db.run('INSERT INTO groups (id, name, color, sort) VALUES (?, ?, ?, ?)', id, name.trim(), color ?? '#8b8981', sort)
    changed()
    return mapGroup({ id, name: name.trim(), color: color ?? '#8b8981', sort })
  },
  'groups.update': ({ id, patch }) => {
    if (patch.name !== undefined) db.run('UPDATE groups SET name = ? WHERE id = ?', patch.name.trim(), id)
    if (patch.color !== undefined) db.run('UPDATE groups SET color = ? WHERE id = ?', patch.color, id)
    if (patch.sort !== undefined) db.run('UPDATE groups SET sort = ? WHERE id = ?', patch.sort, id)
    changed()
    const r = db.get<{ id: string; name: string; color: string; sort: number }>('SELECT * FROM groups WHERE id = ?', id)
    if (!r) throw new UserError('Group not found', 'not_found')
    return mapGroup(r)
  },
  'groups.delete': ({ id }) => {
    db.run('DELETE FROM groups WHERE id = ?', id)
    changed()
  },

  'tags.list': () => {
    const tags = db.all<{ id: string; name: string; color: string }>('SELECT * FROM tags ORDER BY name COLLATE NOCASE')
    const counts = new Map<string, number>()
    for (const b of listBrandsRaw()) for (const t of b.tags) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1)
    return tags.map((t) => mapTag({ ...t, count: counts.get(t.name.toLowerCase()) ?? 0 }))
  },
  'tags.create': ({ name, color }) => {
    const id = newId('tag_')
    db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', id, name.trim(), color ?? '#8b8981')
    changed()
    return mapTag({ id, name: name.trim(), color: color ?? '#8b8981' })
  },
  'tags.update': ({ id, patch }) => {
    const old = db.get<{ id: string; name: string; color: string }>('SELECT * FROM tags WHERE id = ?', id)
    if (!old) throw new UserError('Tag not found', 'not_found')
    db.tx(() => {
      if (patch.color !== undefined) db.run('UPDATE tags SET color = ? WHERE id = ?', patch.color, id)
      if (patch.name !== undefined && patch.name.trim() !== old.name) {
        const nn = patch.name.trim()
        db.run('UPDATE tags SET name = ? WHERE id = ?', nn, id)
        for (const b of listBrandsRaw(true))
          if (b.tags.some((t) => t.toLowerCase() === old.name.toLowerCase()))
            db.run('UPDATE brands SET tags = ? WHERE id = ?', j(b.tags.map((t) => (t.toLowerCase() === old.name.toLowerCase() ? nn : t))), b.id)
      }
    })
    changed()
    const r = db.get<{ id: string; name: string; color: string }>('SELECT * FROM tags WHERE id = ?', id)!
    return mapTag(r)
  },
  'tags.delete': ({ id }) => {
    const old = db.get<{ name: string }>('SELECT name FROM tags WHERE id = ?', id)
    if (!old) return
    db.tx(() => {
      db.run('DELETE FROM tags WHERE id = ?', id)
      for (const b of listBrandsRaw(true))
        if (b.tags.some((t) => t.toLowerCase() === old.name.toLowerCase())) db.run('UPDATE brands SET tags = ? WHERE id = ?', j(b.tags.filter((t) => t.toLowerCase() !== old.name.toLowerCase())), b.id)
    })
    changed()
  }
})

let timer: NodeJS.Timeout | null = null
export function start(): void {
  purgeExpired().catch((e) => console.warn('recycle purge failed', e))
  timer = setInterval(() => purgeExpired().catch(() => {}), 6 * 3600_000)
}
export async function stop(): Promise<void> {
  if (timer) clearInterval(timer)
}
