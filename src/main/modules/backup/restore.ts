// backup.restore: decrypt + extract into tmp, open the snapshot DB read-only and MERGE — brands whose
// id is not here yet come back with their accounts, slots, posts (+ the media rows those posts use),
// group and tags, and their profile folder. Existing brands are never touched.
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { db, pj, type Param } from '../../core/db'
import { UserError } from '../../core/errors'
import { paths } from '../../core/paths'
import { ensureTags, nextSerial } from '../brands/repo'
import { extractArchive } from './archive'
import { cookieSchema, withBrandContext, writeCookies } from './cookies'

type Row = Record<string, unknown>

const colsCache = new Map<string, string[]>()
function localCols(table: string): string[] {
  let c = colsCache.get(table)
  if (!c) {
    c = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name)
    colsCache.set(table, c)
  }
  return c
}

/** Insert a snapshot row into the live table, using only columns both schemas have. */
function insertRow(table: string, row: Row, overrides: Row = {}): boolean {
  const cols = localCols(table).filter((c) => c in row || c in overrides)
  const vals = cols.map((c) => (c in overrides ? overrides[c] : row[c]) as Param)
  return db.run(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals).changes > 0
}

function freeSlug(base: string): string {
  let slug = base
  for (let i = 2; db.get('SELECT 1 FROM brands WHERE slug = ?', slug) || existsSync(paths.profile(slug)); i++) slug = `${base}-${i}`
  return slug
}

interface Planned {
  brandId: string
  name: string
  fromProfile: string
  toProfile: string
  cookiesFile: string
}

export async function restoreBackup(file: string, passphrase: string): Promise<{ brands: number; warnings: string[] }> {
  if (!existsSync(file)) throw new UserError(`Backup file not found: ${file}`)
  const tmp = join(paths.tmp, `restore-${Date.now()}`)
  const warnings: string[] = []
  try {
    await extractArchive(file, passphrase, tmp)
    const manifest = pj<{ format?: string; version?: number }>(await readFile(join(tmp, 'manifest.json'), 'utf8').catch(() => ''), {})
    if (manifest.format !== 'cubby-backup') throw new UserError('This file is not a Cubby backup')
    if (!existsSync(join(tmp, 'app.sqlite'))) throw new UserError('The backup has no database in it')

    const snap = new DatabaseSync(join(tmp, 'app.sqlite'), { readOnly: true })
    let planned: Planned[]
    try {
      const all = <T = Row>(sql: string, ...p: (string | number)[]) => snap.prepare(sql).all(...p) as T[]
      planned = db.tx(() => {
        const out: Planned[] = []
        for (const b of all('SELECT * FROM brands WHERE deleted_at IS NULL ORDER BY serial')) {
          const id = String(b.id)
          if (db.get('SELECT 1 FROM brands WHERE id = ?', id)) continue
          // group: same id, else same name, else bring the group over
          let groupId = (b.group_id as string | null) ?? null
          if (groupId && !db.get('SELECT 1 FROM groups WHERE id = ?', groupId)) {
            const g = all('SELECT * FROM groups WHERE id = ?', groupId)[0]
            const byName = g ? db.get<{ id: string }>('SELECT id FROM groups WHERE lower(name) = lower(?)', String(g.name)) : undefined
            if (byName) groupId = byName.id
            else if (g) insertRow('groups', g)
            else groupId = null
          }
          ensureTags(pj<string[]>(b.tags, []))
          const oldSlug = String(b.slug)
          const slug = freeSlug(oldSlug)
          const serial = db.get('SELECT 1 FROM brands WHERE serial = ?', Number(b.serial)) ? nextSerial() : Number(b.serial)
          insertRow('brands', b, { slug, serial, group_id: groupId, status: 'closed', status_error: null, cdp_port: null, pid: null })
          for (const a of all('SELECT * FROM accounts WHERE brand_id = ?', id)) insertRow('accounts', a)
          for (const s of all('SELECT * FROM slots WHERE brand_id = ?', id)) insertRow('slots', s)
          const assetIds = new Set<string>()
          for (const p of all('SELECT * FROM posts WHERE brand_id = ?', id)) {
            const running = p.status === 'running'
            insertRow('posts', p, running ? { status: 'failed', error: 'Interrupted — restored from a backup' } : {})
            for (const a of pj<string[]>(p.asset_ids, [])) assetIds.add(a)
          }
          for (const aid of assetIds) {
            const m = all('SELECT * FROM media WHERE id = ?', aid)[0]
            if (!m || db.get('SELECT 1 FROM media WHERE id = ? OR path = ?', aid, String(m.path))) continue
            insertRow('media', m, { thumb: m.thumb && existsSync(String(m.thumb)) ? m.thumb : null, missing: existsSync(String(m.path)) ? 0 : 1 })
          }
          out.push({ brandId: id, name: String(b.name), fromProfile: join(tmp, 'profiles', oldSlug), toProfile: paths.profile(slug), cookiesFile: join(tmp, 'cookies', `${oldSlug}.json`) })
        }
        return out
      })
    } finally {
      snap.close()
    }

    // profile folders: tmp is inside the data folder, so a rename is instant
    for (const p of planned) {
      try {
        if (existsSync(p.fromProfile)) {
          await rename(p.fromProfile, p.toProfile).catch(async () => {
            await cp(p.fromProfile, p.toProfile, { recursive: true })
          })
        } else await mkdir(p.toProfile, { recursive: true })
      } catch (e) {
        warnings.push(`${p.name}: profile folder could not be restored (${(e as Error).message})`)
        await mkdir(p.toProfile, { recursive: true }).catch(() => {})
      }
    }

    // cookies saved over CDP from brands that were open during the backup (Chrome locks the file)
    for (const p of planned) {
      if (!existsSync(p.cookiesFile)) continue
      try {
        const parsed = cookieSchema.array().safeParse(JSON.parse(await readFile(p.cookiesFile, 'utf8')))
        if (!parsed.success) throw new Error('cookie file is malformed')
        const r = await withBrandContext(p.brandId, (ctx) => writeCookies(ctx, parsed.data))
        if (r.failed) warnings.push(`${p.name}: ${r.failed} cookies could not be written`)
      } catch (e) {
        warnings.push(`${p.name}: cookies not restored (${(e as Error).message})`)
      }
    }
    return { brands: planned.length, warnings }
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}
