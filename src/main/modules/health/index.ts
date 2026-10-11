// Login health (PLAN §9) and the Cookies tab (§6.3). Health reads each account's platform session
// cookies over CDP — context.cookies(cookieUrl), no page loads — and grades them (grade.ts). Open
// brands are checked right after opening and every 15 min; closed brands once a day at
// Settings.healthCheckHour by opening them in the background and closing them again.
// Cookie commands never return values; export is passphrase-encrypted.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Cookie } from 'playwright-core'
import { PLATFORM_SPECS, platformName } from '@shared/platforms'
import type { Account } from '@shared/types'
import { logActivity } from '../../core/activity'
import { decryptBuffer, encryptBuffer, isEncrypted } from '../../core/crypto'
import { db } from '../../core/db'
import { UserError } from '../../core/errors'
import { emit, on } from '../../core/events'
import { nowIso } from '../../core/ids'
import { notify } from '../../core/notify'
import { paths } from '../../core/paths'
import { implement } from '../../core/registry'
import { requestStatus } from '../../core/runtime'
import { getSettings } from '../../core/settings'
import { listAccounts, setLoginState } from '../accounts/repo'
import { getBrand, listBrandsRaw } from '../brands/repo'
import { closeBrand, getBrowser, getContext, isBackground, isBrandOpen, openBrand } from '../browser'
import { COOKIE_FILE_FORMAT, PLATFORM_DOMAINS, domainMatches, domainRegex, gradeLogin, normalizeCookies, toCookieInfo, type FullCookie, type SetCookie } from './grade'

export { gradeLogin } from './grade'

// ── brand access for background jobs ─────────────────────────────────────────

/** Brands this module opened in the background → number of jobs using them. */
const borrowed = new Map<string, number>()

/** Run fn with the brand's context; opens it in the background when closed and closes it after. */
async function withBrand<T>(brandId: string, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const ours = borrowed.has(brandId) || !isBrandOpen(brandId)
  if (ours) borrowed.set(brandId, (borrowed.get(brandId) ?? 0) + 1)
  try {
    if (!isBrandOpen(brandId)) await openBrand(brandId, { background: true })
    return await fn(await getContext(brandId, false))
  } finally {
    if (ours) {
      const n = (borrowed.get(brandId) ?? 1) - 1
      if (n > 0) borrowed.set(brandId, n)
      else {
        borrowed.delete(brandId)
        // the person may have brought it up meanwhile (openBrand without background) → leave it open
        if (isBackground(brandId)) await closeBrand(brandId).catch((e) => console.warn('closing background brand failed', e))
      }
    }
  }
}

/** Every cookie of a brand (values included — main process only: backup/transfer use this). */
export async function readBrandCookies(brandId: string): Promise<Cookie[]> {
  return withBrand(brandId, (ctx) => ctx.cookies())
}

/** Add cookies to a brand; returns how many were accepted. */
export async function writeBrandCookies(brandId: string, cookies: SetCookie[]): Promise<number> {
  return withBrand(brandId, (ctx) => addCookiesTolerant(ctx, cookies))
}

async function addCookiesTolerant(ctx: BrowserContext, cookies: SetCookie[]): Promise<number> {
  let n = 0
  for (let i = 0; i < cookies.length; i += 200) {
    const chunk = cookies.slice(i, i + 200)
    try {
      await ctx.addCookies(chunk)
      n += chunk.length
    } catch {
      // one bad cookie rejects the batch; retry one by one and skip the bad ones
      for (const c of chunk) {
        try {
          await ctx.addCookies([c])
          n++
        } catch {
          /* skipped */
        }
      }
    }
  }
  return n
}

// ── health ───────────────────────────────────────────────────────────────────

const checking = new Set<string>()

function checkable(a: Account): boolean {
  const spec = PLATFORM_SPECS[a.platform]
  return !!spec && spec.sessionCookies.length > 0 && !!spec.cookieUrl
}

/** Check every account of one brand (opens the brand only if openIfClosed). */
export async function checkBrandHealth(brandId: string, openIfClosed = false): Promise<Account[]> {
  const brand = getBrand(brandId)
  const accounts = listAccounts(brandId).filter(checkable)
  if (!accounts.length || brand.deletedAt) return listAccounts(brandId)
  if (!isBrandOpen(brandId) && !openIfClosed) return listAccounts(brandId)
  if (checking.has(brandId)) return listAccounts(brandId)
  checking.add(brandId)
  try {
    await withBrand(brandId, async (ctx) => {
      const byUrl = new Map<string, Cookie[]>()
      for (const a of accounts) {
        const url = PLATFORM_SPECS[a.platform].cookieUrl
        if (!byUrl.has(url)) byUrl.set(url, await ctx.cookies(url))
        const g = gradeLogin(PLATFORM_SPECS[a.platform].sessionCookies, byUrl.get(url)!)
        setLoginState(a.id, g.state, g.expiresAt)
        if (g.state === 'expired' && (a.loginState === 'ok' || a.loginState === 'expiring')) {
          logActivity({ actor: 'scheduler', brandId, action: 'health.relogin_needed', detail: { accountId: a.id, platform: a.platform, handle: a.handle, missing: g.missing } })
          notify({ title: `${brand.name}: log in to ${platformName(a.platform)} again`, body: `${a.handle} is logged out. Open the brand → Accounts → Fill login.`, path: `/brands/${brandId}` })
        }
      }
    })
  } finally {
    checking.delete(brandId)
  }
  emit('accounts.changed', { brandId })
  emit('brands.changed', { ids: [brandId] })
  requestStatus()
  return listAccounts(brandId)
}

function hasCheckable(brandId: string): boolean {
  return listAccounts(brandId).some(checkable)
}

/** Live check of every open brand (15-minute timer). */
async function checkOpenBrands(): Promise<void> {
  for (const b of listBrandsRaw()) {
    if (isBrandOpen(b.id) && hasCheckable(b.id)) {
      await checkBrandHealth(b.id, false).catch((e) => console.warn('health check failed', b.name, e))
    }
  }
}

const DAILY_KEY = 'health.lastDaily'

/** Once a day at/after Settings.healthCheckHour: closed brands, one at a time, in the background. */
async function dailyIfDue(now = new Date()): Promise<void> {
  const s = getSettings()
  const today = now.toLocaleDateString('en-CA', { timeZone: s.timezone })
  const hour = Number(now.toLocaleString('en-GB', { timeZone: s.timezone, hour: '2-digit', hour12: false }))
  const last = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', DAILY_KEY)?.value
  if (last === JSON.stringify(today) || hour < s.healthCheckHour) return
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', DAILY_KEY, JSON.stringify(today))
  for (const b of listBrandsRaw()) {
    if (!isBrandOpen(b.id) && hasCheckable(b.id)) {
      await checkBrandHealth(b.id, true).catch((e) => console.warn('daily health check failed', b.name, e))
    }
  }
}

// ── cookies ──────────────────────────────────────────────────────────────────

function today(): string {
  return nowIso().slice(0, 10)
}

implement({
  'health.check': async ({ brandId }) => {
    if (brandId) return checkBrandHealth(brandId, true)
    const out: Account[] = []
    for (const b of listBrandsRaw()) {
      out.push(...(await checkBrandHealth(b.id, true)))
    }
    return out
  },

  'cookies.list': ({ brandId }) => withBrand(brandId, async (ctx) => toCookieInfo((await ctx.cookies()) as FullCookie[])),

  'cookies.export': async ({ brandId, passphrase, path }) => {
    const brand = getBrand(brandId)
    const cookies = await readBrandCookies(brandId)
    const body = { format: COOKIE_FILE_FORMAT, version: 1, exportedAt: nowIso(), brand: { name: brand.name, slug: brand.slug }, cookies }
    const file = path ?? join(paths.exports, `${brand.slug}-cookies-${today()}.cubby-cookies`)
    writeFileSync(file, encryptBuffer(Buffer.from(JSON.stringify(body), 'utf8'), passphrase))
    return { path: file, count: cookies.length }
  },

  'cookies.import': async ({ brandId, path, passphrase }) => {
    getBrand(brandId)
    let data: Buffer
    try {
      data = readFileSync(path)
    } catch {
      throw new UserError('That file could not be read')
    }
    if (isEncrypted(data)) {
      if (!passphrase) throw new UserError('This cookie file is encrypted — enter the passphrase it was exported with')
      data = decryptBuffer(data, passphrase)
    }
    let list: SetCookie[]
    try {
      list = normalizeCookies(JSON.parse(data.toString('utf8').replace(/^﻿/, '')))
    } catch (e) {
      throw new UserError(e instanceof SyntaxError ? 'That file is not JSON' : e instanceof Error ? e.message : String(e))
    }
    const count = await writeBrandCookies(brandId, list)
    if (!count) throw new UserError('None of the cookies in that file could be added')
    return { count }
  },

  'cookies.clear': async ({ brandId, platform }) => {
    const domains = PLATFORM_DOMAINS[platform]
    if (!domains.length) throw new UserError('Pick a specific platform to clear')
    const count = await withBrand(brandId, async (ctx) => {
      const n = (await ctx.cookies()).filter((c) => domains.some((d) => domainMatches(c.domain, d))).length
      await ctx.clearCookies({ domain: domainRegex(domains) })
      const cdp = await (await getBrowser(brandId, false)).newBrowserCDPSession()
      try {
        for (const d of domains) {
          for (const origin of [`https://${d}`, `https://www.${d}`]) {
            await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {})
          }
        }
      } finally {
        await cdp.detach().catch(() => {})
      }
      return n
    })
    const acc = listAccounts(brandId).filter((a) => a.platform === platform)
    for (const a of acc) setLoginState(a.id, 'expired', null)
    if (acc.length) {
      emit('accounts.changed', { brandId })
      emit('brands.changed', { ids: [brandId] })
      requestStatus()
    }
    return { count }
  }
})

// ── timers ───────────────────────────────────────────────────────────────────

const timers: NodeJS.Timeout[] = []
let offStatus: (() => void) | null = null

export function start(): void {
  // right after a brand opens (by the person / a run), look at its logins
  offStatus = on('brand.status', ({ id, status }) => {
    if (status !== 'open' || borrowed.has(id)) return
    const t = setTimeout(() => {
      if (isBrandOpen(id) && hasCheckable(id)) checkBrandHealth(id, false).catch(() => {})
    }, 4000)
    t.unref?.()
  })
  const live = setInterval(() => checkOpenBrands().catch(() => {}), 15 * 60_000)
  const daily = setInterval(() => dailyIfDue().catch((e) => console.warn('daily health failed', e)), 10 * 60_000)
  const first = setTimeout(() => dailyIfDue().catch(() => {}), 60_000)
  for (const t of [live, daily, first]) {
    t.unref?.()
    timers.push(t)
  }
}

export async function stop(): Promise<void> {
  for (const t of timers.splice(0)) clearTimeout(t)
  offStatus?.()
  offStatus = null
}
