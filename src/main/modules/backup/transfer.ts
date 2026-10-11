// Moving brands between machines (PLAN §11): a `.brand` file is encryptBuffer(JSON) holding brand
// settings, accounts (credentials only when ticked), posting slots and every cookie read over CDP —
// decrypted on this machine, re-encrypted with the person's passphrase. Import recreates the brands
// with fresh ids/profiles and writes the cookies into them.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { PLATFORMS, AGE_TIERS, type BrandRow } from '@shared/types'
import { decryptBuffer, encryptBuffer } from '../../core/crypto'
import { db, j, pj } from '../../core/db'
import { UserError } from '../../core/errors'
import { emit, toast } from '../../core/events'
import { newId, nowIso } from '../../core/ids'
import { paths } from '../../core/paths'
import { listAccounts } from '../accounts/repo'
import { readAccountSecret } from '../accounts/secrets'
import { createBrand } from '../brands'
import { getBrandRow } from '../brands/repo'
import { checkBrandHealth } from '../health'
import { cookieSchema, readCookies, withBrandContext, writeCookies, type PortableCookie } from './cookies'
import { exportFileName, uniqueName } from './names'

const FORMAT = 'cubby-brand'
const VERSION = 1

const opt = <T extends z.ZodType>(t: T) => t.nullable().optional()
const brandSchema = z.object({
  name: z.string().min(1),
  color: opt(z.string()),
  logo: opt(z.string()),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(''),
  startupUrls: z.array(z.string()).default([]),
  window: opt(z.object({ width: z.number(), height: z.number(), x: z.number().optional(), y: z.number().optional() })),
  approvalRequired: opt(z.boolean()),
  groupName: opt(z.string()),
  groupColor: opt(z.string()),
  accounts: z
    .array(
      z.object({
        platform: z.enum(PLATFORMS),
        handle: z.string().min(1),
        displayName: opt(z.string()),
        profileUrl: opt(z.string()),
        ageTier: z.enum(AGE_TIERS).default('new'),
        notes: opt(z.string()),
        username: opt(z.string()),
        password: opt(z.string()),
        totpSecret: opt(z.string())
      })
    )
    .default([]),
  slots: z.array(z.object({ weekdays: z.array(z.number().int().min(0).max(6)), time: z.string().regex(/^\d{2}:\d{2}$/) })).default([]),
  cookies: z.array(cookieSchema).default([])
})
const fileSchema = z.object({ format: z.literal(FORMAT), version: z.number(), exportedAt: z.string().optional(), brands: z.array(brandSchema) })
type ExportedBrand = z.input<typeof brandSchema>

export async function exportBrands(ids: string[], includeCredentials: boolean, passphrase: string, outPath?: string): Promise<{ path: string; brands: number; warnings: string[] }> {
  const warnings: string[] = []
  const brands: ExportedBrand[] = []
  for (const id of ids) {
    const b = getBrandRow(id)
    const group = b.groupId ? db.get<{ name: string; color: string }>('SELECT name, color FROM groups WHERE id = ?', b.groupId) : undefined
    const accounts = listAccounts(id).map((a) => {
      const base = { platform: a.platform, handle: a.handle, displayName: a.displayName, profileUrl: a.profileUrl, ageTier: a.ageTier, notes: a.notes }
      if (!includeCredentials) return base
      const s = readAccountSecret(a.id)
      return { ...base, username: s.username, password: s.password, totpSecret: s.totpSecret }
    })
    const slots = db.all<{ weekdays: string; time: string }>('SELECT weekdays, time FROM slots WHERE brand_id = ?', id).map((s) => ({ weekdays: pj<number[]>(s.weekdays, []), time: s.time }))
    let cookies: PortableCookie[] = []
    try {
      cookies = await withBrandContext(id, readCookies)
    } catch (e) {
      warnings.push(`${b.name}: cookies could not be read (${(e as Error).message}) — exported without logins`)
    }
    brands.push({
      name: b.name, color: b.color, logo: b.logo, tags: b.tags, notes: b.notes, startupUrls: b.startupUrls, window: b.window,
      approvalRequired: b.approvalRequired, groupName: group?.name ?? null, groupColor: group?.color ?? null, accounts, slots, cookies
    })
  }
  const data = Buffer.from(JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: nowIso(), brands }), 'utf8')
  let out = outPath ? resolve(outPath) : join(paths.exports, exportFileName(brands.map((b) => b.name), new Date()))
  if (!outPath) {
    const stem = out.replace(/\.brand$/, '')
    for (let i = 2; existsSync(out); i++) out = `${stem}-${i}.brand`
  }
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, encryptBuffer(data, passphrase))
  return { path: out, brands: brands.length, warnings }
}

function groupIdFor(name: string | null | undefined, color: string | null | undefined): string | null {
  const n = name?.trim()
  if (!n) return null
  const g = db.get<{ id: string }>('SELECT id FROM groups WHERE lower(name) = lower(?)', n)
  if (g) return g.id
  const id = newId('grp_')
  const sort = (db.get<{ m: number | null }>('SELECT max(sort) m FROM groups')?.m ?? -1) + 1
  db.run('INSERT INTO groups (id, name, color, sort) VALUES (?, ?, ?, ?)', id, n, color || '#8b8981', sort)
  return id
}

export async function importBrands(file: string, passphrase: string): Promise<{ brands: BrandRow[]; warnings: string[] }> {
  let raw: Buffer
  try {
    raw = await readFile(file)
  } catch {
    throw new UserError(`File not found: ${file}`)
  }
  const plain = decryptBuffer(raw, passphrase)
  let json: unknown
  try {
    json = JSON.parse(plain.toString('utf8'))
  } catch {
    throw new UserError('This file is not a Cubby brand export')
  }
  const head = json as { format?: unknown; version?: unknown }
  if (head?.format !== FORMAT) throw new UserError('This file is not a Cubby brand export')
  if (typeof head.version === 'number' && head.version > VERSION) throw new UserError('This export was made by a newer Cubby — update Cubby to import it')
  const parsed = fileSchema.safeParse(json)
  if (!parsed.success) throw new UserError(`The brand file is damaged: ${parsed.error.issues[0]?.message ?? 'invalid'}`)

  const warnings: string[] = []
  const created: string[] = []
  for (const eb of parsed.data.brands) {
    const taken = db.all<{ name: string }>('SELECT name FROM brands WHERE deleted_at IS NULL').map((r) => r.name)
    const name = uniqueName(eb.name, taken)
    const row = await createBrand({
      name,
      color: eb.color ?? undefined,
      logo: eb.logo ?? null,
      groupId: groupIdFor(eb.groupName, eb.groupColor),
      tags: eb.tags,
      notes: eb.notes,
      startupUrls: eb.startupUrls,
      window: eb.window ?? undefined,
      approvalRequired: eb.approvalRequired ?? undefined,
      accounts: eb.accounts.map((a) => ({
        platform: a.platform,
        handle: a.handle,
        displayName: a.displayName ?? undefined,
        profileUrl: a.profileUrl ?? undefined,
        ageTier: a.ageTier,
        notes: a.notes ?? undefined,
        username: a.username ?? undefined,
        password: a.password ?? undefined,
        totpSecret: a.totpSecret ?? undefined
      }))
    })
    created.push(row.id)
    for (const s of eb.slots) db.run('INSERT INTO slots (id, brand_id, weekdays, time) VALUES (?, ?, ?, ?)', newId('slot_'), row.id, j(s.weekdays), s.time)
    if (eb.cookies.length) {
      try {
        const r = await withBrandContext(row.id, async (ctx) => {
          const w = await writeCookies(ctx, eb.cookies)
          await checkBrandHealth(row.id, false).catch(() => [])
          return w
        })
        if (r.failed) warnings.push(`${name}: ${r.failed} of ${r.written + r.failed} cookies could not be written`)
      } catch (e) {
        warnings.push(`${name}: created, but its logins (cookies) could not be imported — ${(e as Error).message}`)
      }
    }
  }
  if (created.length) emit('brands.changed', { ids: created })
  if (warnings.length) toast('warn', warnings.join(' · '))
  return { brands: created.map((id) => getBrandRow(id)), warnings }
}
