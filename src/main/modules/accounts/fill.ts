// Fill login: type a saved username + password into a brand's login page, at a human pace, and
// stop there — the person presses Log in (and handles any 2FA / checkpoint). Never submits.
// Electron-free; tested against local HTML pages, never a real platform.
import type { Locator, Page } from 'playwright-core'
import { PLATFORM_SPECS } from '@shared/platforms'
import type { Platform } from '@shared/types'
import { UserError } from '../../core/errors'

export interface LoginCreds {
  username: string | null
  password: string | null
}

export interface FillOptions {
  /** override the platform login URL (tests) */
  loginUrl?: string
  /** per-key delay range in ms */
  delayMs?: [number, number]
  /** how long to wait for each field */
  timeoutMs?: number
}

interface Strategy {
  url?: string
  user: string[]
  pass: string[]
  /** username and password are on separate steps; click this to move on */
  next?: { selectors: string[]; text: RegExp }
}

const GENERIC: Strategy = {
  user: ['input[type="email"]', 'input[autocomplete="username"]', 'input[name="username"]', 'input[name="email"]', 'input[type="text"]', 'input:not([type])'],
  pass: ['input[type="password"]']
}

const STRATEGIES: Partial<Record<Platform, Strategy>> = {
  instagram: { user: ['input[name="username"]', 'input[name="email"]'], pass: ['input[name="password"]', 'input[name="pass"]', 'input[type="password"]'] },
  facebook: { user: ['#email', 'input[name="email"]'], pass: ['#pass', 'input[name="pass"]', 'input[type="password"]'] },
  tiktok: { url: 'https://www.tiktok.com/login/phone-or-email/email', user: ['input[name="username"]'], pass: ['input[type="password"]'] },
  x: { user: ['input[autocomplete="username"]', 'input[name="text"]'], pass: ['input[name="password"]', 'input[type="password"]'], next: { selectors: [], text: /^next$/i } },
  linkedin: { user: ['#username', 'input[name="session_key"]'], pass: ['#password', 'input[name="session_password"]'] },
  youtube: { user: ['input[type="email"]', '#identifierId'], pass: ['input[name="Passwd"]', 'input[type="password"]'], next: { selectors: ['#identifierNext button', '#identifierNext'], text: /^next$/i } }
}

export function loginUrlFor(p: Platform): string {
  return STRATEGIES[p]?.url ?? PLATFORM_SPECS[p].loginUrl
}

/** Already on this platform's login page? (then we fill in place instead of navigating) */
export function isOnLoginPage(url: string, p: Platform): boolean {
  const spec = PLATFORM_SPECS[p]
  if (!spec.loginPathHints.length) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const login = new URL(loginUrlFor(p))
  const sameSite = u.hostname.replace(/^www\./, '') === login.hostname.replace(/^www\./, '') || (p === 'youtube' && u.hostname === 'accounts.google.com')
  if (!sameSite) return false
  const full = u.hostname + u.pathname
  return spec.loginPathHints.some((h) => full.includes(h.replace(/^\//, '')) || u.pathname.startsWith(h))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a)

/** First visible element matching any selector, polling until timeout. */
async function firstVisible(page: Page, selectors: string[], timeoutMs: number): Promise<Locator | null> {
  const end = Date.now() + timeoutMs
  do {
    for (const sel of selectors) {
      const all = page.locator(sel)
      const n = await all.count().catch(() => 0)
      for (let i = 0; i < n; i++) {
        const el = all.nth(i)
        if ((await el.isVisible().catch(() => false)) && (await el.isEditable().catch(() => false))) return el
      }
    }
    await sleep(200)
  } while (Date.now() < end)
  return null
}

/** Type like a person: focus, clear, then one key at a time with uneven gaps. */
async function typeHuman(el: Locator, text: string, delay: [number, number]): Promise<void> {
  await el.click()
  await el.fill('')
  for (const ch of text) {
    await el.pressSequentially(ch)
    await sleep(between(delay))
  }
}

async function clickNext(page: Page, next: NonNullable<Strategy['next']>, timeoutMs: number): Promise<void> {
  for (const sel of next.selectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) return el.click()
  }
  const byRole = page.getByRole('button', { name: next.text }).first()
  await byRole.waitFor({ state: 'visible', timeout: timeoutMs })
  await byRole.click()
}

/** Put `page` on the platform's login form and type the credentials. Does not press Log in. */
export async function fillLoginOnPage(page: Page, platform: Platform, creds: LoginCreds, opts: FillOptions = {}): Promise<void> {
  if (!creds.username && !creds.password) throw new UserError('No saved login for this account — add the username and password first')
  const timeout = opts.timeoutMs ?? 15_000
  const delay = opts.delayMs ?? [45, 140]
  const st = STRATEGIES[platform] ?? GENERIC
  if (opts.loginUrl || !isOnLoginPage(page.url(), platform)) {
    const url = opts.loginUrl ?? loginUrlFor(platform)
    if (!/^https?:/i.test(url)) throw new UserError('This account has no login page to fill — open the site and log in by hand')
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  }
  const formGone = `Couldn't find the login form on ${PLATFORM_SPECS[platform].name} — the page may have changed or you're already logged in. Log in by hand in the brand window.`

  if (creds.username) {
    const user = (await firstVisible(page, st.user, timeout)) ?? (st === GENERIC ? null : await firstVisible(page, GENERIC.user, 1500))
    if (!user) throw new UserError(formGone)
    await typeHuman(user, creds.username, delay)
  }
  if (!creds.password) return
  if (st.next && creds.username) {
    // a pause before moving on, like a person checking what they typed
    await sleep(between([300, 700]))
    await clickNext(page, st.next, timeout).catch(() => {
      throw new UserError(formGone)
    })
  }
  const pass = (await firstVisible(page, st.pass, timeout)) ?? (await firstVisible(page, GENERIC.pass, 1500))
  if (!pass) throw new UserError(formGone)
  await sleep(between([200, 500]))
  await typeHuman(pass, creds.password, delay)
}
