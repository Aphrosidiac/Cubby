// Pure parts of login health and cookie files: grade session cookies into a login state, map
// cookies for display (no values), and normalise imported cookie files (Cubby / Playwright /
// EditThisCookie formats) into what Playwright's addCookies takes.
import type { CookieInfo, LoginState, Platform } from '@shared/types'

export const EXPIRING_DAYS = 7

export interface CookieLike {
  name: string
  domain?: string
  /** seconds since epoch; -1 (or ≤ 0) = session cookie */
  expires: number
}

export interface Grade {
  state: LoginState
  /** earliest expiry among the required cookies (ISO), null when none expire */
  expiresAt: string | null
  missing: string[]
}

/**
 * All required cookies present and unexpired → ok (expiring when one ends within 7 days);
 * any missing or expired → expired; a platform with no session cookies → unknown.
 */
export function gradeLogin(required: string[], cookies: CookieLike[], nowMs = Date.now()): Grade {
  if (!required.length) return { state: 'unknown', expiresAt: null, missing: [] }
  const missing: string[] = []
  let earliest = Infinity
  for (const name of required) {
    const found = cookies.filter((c) => c.name === name)
    if (!found.length) {
      missing.push(name)
      continue
    }
    // the same name can exist on several domains; the longest-lived one counts
    const best = Math.max(...found.map((c) => (c.expires > 0 ? c.expires * 1000 : Infinity)))
    if (best <= nowMs) missing.push(name)
    else earliest = Math.min(earliest, best)
  }
  if (missing.length) return { state: 'expired', expiresAt: null, missing }
  const expiresAt = Number.isFinite(earliest) ? new Date(earliest).toISOString() : null
  const state: LoginState = Number.isFinite(earliest) && earliest - nowMs < EXPIRING_DAYS * 864e5 ? 'expiring' : 'ok'
  return { state, expiresAt, missing }
}

/** Domains whose cookies / site data belong to a platform (for Clear site data). */
export const PLATFORM_DOMAINS: Record<Platform, string[]> = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com'],
  x: ['x.com', 'twitter.com'],
  linkedin: ['linkedin.com'],
  threads: ['threads.com', 'threads.net'],
  custom: []
}

export function domainMatches(cookieDomain: string, domain: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase()
  return d === domain || d.endsWith('.' + domain)
}

export function domainRegex(domains: string[]): RegExp {
  const alt = domains.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(`^\\.?([^.]+\\.)*(${alt})$`, 'i')
}

export interface FullCookie extends CookieLike {
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/** For the Cookies tab: names, domains, expiry — never values. Sorted by domain then name. */
export function toCookieInfo(cookies: FullCookie[]): CookieInfo[] {
  return cookies
    .map((c) => ({ domain: c.domain, name: c.name, expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : null, httpOnly: !!c.httpOnly, secure: !!c.secure }))
    .sort((a, b) => a.domain.replace(/^\./, '').localeCompare(b.domain.replace(/^\./, '')) || a.name.localeCompare(b.name))
}

/** Shape accepted by Playwright BrowserContext.addCookies. */
export interface SetCookie {
  name: string
  value: string
  url?: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export const COOKIE_FILE_FORMAT = 'cubby-cookies'

function sameSiteOf(v: unknown): SetCookie['sameSite'] {
  const s = String(v ?? '').toLowerCase()
  if (s === 'strict') return 'Strict'
  if (s === 'lax') return 'Lax'
  if (s === 'none' || s === 'no_restriction') return 'None'
  return undefined
}

/** Normalise a parsed cookie file. Throws a plain Error with a person-readable message. */
export function normalizeCookies(raw: unknown): SetCookie[] {
  const list = Array.isArray(raw) ? raw : (raw as { cookies?: unknown })?.cookies
  if (!Array.isArray(list)) throw new Error('No cookies found in that file (expected a JSON array or a Cubby cookie export)')
  const out: SetCookie[] = []
  for (const c of list as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue
    const name = typeof c.name === 'string' ? c.name : null
    const value = c.value == null ? '' : String(c.value)
    const domain = typeof c.domain === 'string' ? c.domain.trim() : ''
    if (!name || !domain) continue
    const path = typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/'
    const secure = !!c.secure
    let exp = Number(c.expires ?? c.expirationDate ?? c.expiry ?? -1)
    if (c.session === true || !Number.isFinite(exp) || exp <= 0) exp = -1
    else if (exp > 1e12) exp = exp / 1000 // milliseconds
    let sameSite = sameSiteOf(c.sameSite)
    if (sameSite === 'None' && !secure) sameSite = undefined
    // EditThisCookie marks host-only cookies; Playwright/Cubby exports encode it as "no leading dot"
    const hostOnly = c.hostOnly === true || (c.hostOnly !== false && !domain.startsWith('.'))
    const d = domain.replace(/^\./, '')
    const out1: SetCookie = { name, value, domain: hostOnly ? d : '.' + d, path, expires: exp, httpOnly: !!c.httpOnly, secure }
    if (sameSite) out1.sameSite = sameSite
    out.push(out1)
  }
  if (!out.length) throw new Error('The file has no usable cookies')
  return out
}
