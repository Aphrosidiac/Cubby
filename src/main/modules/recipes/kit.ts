// Shared mechanics for posting recipes: params, navigation with the checkpoint stop, tolerant element
// lookup (platform UIs vary by account and rollout, so every target is a list of candidates), uploads
// through setInputFiles (never the OS dialog), caption replacement, the handle check, and waiting for
// the success signal. Electron-free — tested against local fixture pages.
import { existsSync } from 'node:fs'
import type { Locator, Page } from 'playwright-core'
import type { Account, MediaAsset, Platform, Post } from '@shared/types'
import { GuardrailError, UserError } from '../../core/errors'
import type { RunContext } from '../runs/manager'

export interface PostingParams {
  post: Post
  account: Account
  assets: MediaAsset[]
  mode: 'prepare' | 'publish'
}

export interface RecipeResult {
  url?: string | null
  screen?: string | null
  note?: string
}

// ── params ───────────────────────────────────────────────────────────────────
export function postingParams(params: Record<string, unknown>): PostingParams {
  const p = params as Partial<PostingParams>
  if (!p.post || !p.account || !Array.isArray(p.assets)) throw new UserError('This recipe posts from the composer — it needs a post, an account and its media (start it from the post, not on its own)')
  return { post: p.post, account: p.account, assets: p.assets, mode: p.mode === 'publish' ? 'publish' : 'prepare' }
}

export function captionFor(p: PostingParams, platform: Platform): string {
  const c = p.post.perPlatform?.[platform]?.caption
  return (c !== undefined && c !== null && c !== '' ? c : p.post.caption) ?? ''
}

/** Media paths for this post, checked on disk. */
export function mediaFiles(p: PostingParams, rule: { min?: number; max?: number; kind?: 'video' | 'image' | 'any'; what: string }): string[] {
  const min = rule.min ?? 1
  const assets = p.post.assetIds.length ? p.post.assetIds.map((id) => p.assets.find((a) => a.id === id)).filter((a): a is MediaAsset => !!a) : p.assets
  if (assets.length < min) throw new UserError(`${rule.what} needs ${min === 1 ? 'a media file' : `at least ${min} media files`}`)
  if (rule.max !== undefined && assets.length > rule.max) throw new UserError(`${rule.what} takes at most ${rule.max} file${rule.max === 1 ? '' : 's'} (got ${assets.length})`)
  for (const a of assets) {
    if (rule.kind && rule.kind !== 'any' && a.kind !== rule.kind) throw new UserError(`${rule.what} needs ${rule.kind === 'video' ? 'a video' : 'images'} — ${a.filename} is ${a.kind === 'video' ? 'a video' : 'an image'}`)
    if (!existsSync(a.path)) throw new UserError(`${a.filename} is missing on disk (${a.path})`)
  }
  return assets.map((a) => a.path)
}

// ── navigation ───────────────────────────────────────────────────────────────
const dialogsHandled = new WeakSet<Page>()

/** Leaving a half-filled composer raises "Leave site?"; accept those so navigation is not stuck. */
export function handleDialogs(page: Page): void {
  if (dialogsHandled.has(page)) return
  dialogsHandled.add(page)
  page.on('dialog', (d) => {
    const t = d.type()
    ;(t === 'beforeunload' || t === 'alert' ? d.accept() : d.dismiss()).catch(() => {})
  })
}

/** Navigate the brand's active tab, then run the checkpoint stop. */
export async function openPage(rt: RunContext, url: string): Promise<Page> {
  rt.guardUrl(url)
  const page = await rt.page()
  handleDialogs(page)
  await rt.race(page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }))
  await settle(rt, page)
  await rt.checkpoint()
  return page
}

/** Short wait for the page to quiet down (SPA platforms keep sockets open — never wait for networkidle forever). */
export async function settle(rt: RunContext, page: Page, ms = 1500): Promise<void> {
  await rt.race(page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {}))
  await rt.sleep(ms)
}

// ── finding things ───────────────────────────────────────────────────────────
async function visibleOf(cands: Locator[]): Promise<Locator | null> {
  for (const c of cands) {
    const l = c.first()
    if (await l.isVisible().catch(() => false)) return l
  }
  return null
}

/** First candidate that becomes visible within timeout, or null. */
export async function maybeVisible(rt: RunContext, cands: Locator[], timeout = 2500): Promise<Locator | null> {
  const until = Date.now() + timeout
  for (;;) {
    rt.throwIfAborted()
    const l = await visibleOf(cands)
    if (l) return l
    if (Date.now() >= until) return null
    await rt.sleep(250)
  }
}

export async function firstVisible(rt: RunContext, cands: Locator[], what: string, timeout = 15_000): Promise<Locator> {
  const l = await maybeVisible(rt, cands, timeout)
  if (!l) throw new UserError(`Could not find ${what} — the page layout may have changed`)
  return l
}

export async function clickFirst(rt: RunContext, cands: Locator[], what: string, timeout = 15_000): Promise<void> {
  const l = await firstVisible(rt, cands, what, timeout)
  await rt.race(l.click({ timeout: 10_000 }))
}

export async function maybeClick(rt: RunContext, cands: Locator[], timeout = 2500): Promise<boolean> {
  const l = await maybeVisible(rt, cands, timeout)
  if (!l) return false
  await rt.race(l.click({ timeout: 10_000 }))
  return true
}

/** Wait until a button stops being disabled (uploads finishing). */
export async function waitEnabled(rt: RunContext, cands: Locator[], what: string, timeout = 10 * 60_000): Promise<Locator> {
  const until = Date.now() + timeout
  let checked = Date.now()
  for (;;) {
    rt.throwIfAborted()
    const l = await visibleOf(cands)
    if (l) {
      const off = await l
        .evaluate((el) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'))
        .catch(() => true)
      if (!off) return l
    }
    if (Date.now() >= until) throw new UserError(`${what} never became available (waited ${Math.round(timeout / 60_000)} min)`)
    if (Date.now() - checked > 5000) {
      checked = Date.now()
      await rt.checkpoint()
    }
    await rt.sleep(500)
  }
}

// ── upload ───────────────────────────────────────────────────────────────────
/**
 * Attach files with setInputFiles on the platform's <input type=file> (usually hidden). When no input
 * exists yet, click a trigger while intercepting the file chooser — Playwright then hands us the
 * chooser instead of the OS showing its dialog.
 */
export async function uploadFiles(rt: RunContext, page: Page, files: string[], o: { inputs: Locator[]; triggers?: Locator[]; timeout?: number }): Promise<void> {
  const until = Date.now() + (o.timeout ?? 20_000)
  for (;;) {
    rt.throwIfAborted()
    for (const c of o.inputs) {
      const input = c.first()
      if ((await input.count().catch(() => 0)) > 0) {
        const multiple = await input.evaluate((el) => (el as HTMLInputElement).multiple).catch(() => true)
        if (files.length > 1 && !multiple) throw new UserError('This upload field takes one file at a time')
        await rt.race(input.setInputFiles(files, { timeout: 30_000 }))
        rt.log(`Attached ${files.map((f) => f.split(/[\\/]/).pop()).join(', ')}`)
        return
      }
    }
    const trigger = o.triggers?.length ? await visibleOf(o.triggers) : null
    if (trigger) {
      const [chooser] = await rt.race(Promise.all([page.waitForEvent('filechooser', { timeout: 10_000 }), trigger.click({ timeout: 10_000 })]))
      await rt.race(chooser.setFiles(files))
      rt.log(`Attached ${files.length} file(s) through the file chooser`)
      return
    }
    if (Date.now() >= until) throw new UserError('Could not find the upload field — the page layout may have changed')
    await rt.sleep(300)
  }
}

// ── text ─────────────────────────────────────────────────────────────────────
export async function fieldText(field: Locator): Promise<string> {
  return field.evaluate((el) => {
    const e = el as HTMLInputElement
    return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' ? e.value : (el as HTMLElement).innerText
  })
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Replace whatever a caption field holds (TikTok and YouTube pre-fill the file name) with `text`.
 * Inputs/textareas use fill(); rich editors get select-all + delete + insertText line by line.
 * `closeSuggestions` adds a space after a trailing #tag / @mention so a suggestion popup cannot eat the
 * next Enter. Verifies the result; throws when the field did not take the text.
 */
export async function replaceText(rt: RunContext, page: Page, field: Locator, text: string, o: { closeSuggestions?: boolean; mustNotContain?: string[] } = {}): Promise<string> {
  const tag = await field.evaluate((el) => el.tagName)
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    await rt.race(field.fill(text))
  } else {
    await rt.race(field.click())
    for (let attempt = 0; attempt < 3; attempt++) {
      await rt.race(page.keyboard.press('ControlOrMeta+A'))
      await rt.race(page.keyboard.press('Backspace'))
      if (!squash(await fieldText(field))) break
    }
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    for (const [i, line] of lines.entries()) {
      rt.throwIfAborted()
      if (line) await rt.race(page.keyboard.insertText(line))
      if (o.closeSuggestions && /[#@][\p{L}\p{N}_.]+$/u.test(line)) {
        await rt.race(page.keyboard.insertText(' '))
        await rt.sleep(150)
      }
      if (i < lines.length - 1) await rt.race(page.keyboard.press('Enter'))
    }
  }
  await rt.sleep(300)
  const got = await fieldText(field)
  const want = squash(text)
  const have = squash(got)
  for (const bad of o.mustNotContain ?? []) {
    if (bad && have.includes(squash(bad)) && !want.includes(squash(bad))) throw new UserError(`The caption field still contains "${bad}" after replacing it`)
  }
  if (want && !have.includes(want.slice(0, Math.min(40, want.length)))) throw new UserError('The caption did not stick in the field — the editor may have changed')
  return got
}

// ── handle check ─────────────────────────────────────────────────────────────
/** "@FF.Dev" / "https://x.com/ff.dev/" / "/ff.dev/" → "ff.dev" */
export function normHandle(s: string): string {
  let v = (s || '').trim()
  try {
    if (/^https?:\/\//i.test(v)) v = new URL(v).pathname
  } catch {
    /* keep */
  }
  v = v.replace(/^\/+|\/+$/g, '').replace(/^(in|company)\//i, (m) => m.toLowerCase())
  v = v.replace(/^@/, '')
  return v.toLowerCase()
}

/** Loose form for display names ("FF Dev Studio" ≈ "ffdevstudio"). */
const loose = (s: string) => (s || '').toLowerCase().replace(/^@/, '').replace(/[^\p{L}\p{N}]+/gu, '')

export function identityMatches(found: string, account: Pick<Account, 'handle' | 'displayName'>, allowNames = false): boolean {
  const f = normHandle(found)
  if (!f) return false
  const h = normHandle(account.handle)
  if (f === h || f.replace(/^(in|company)\//, '') === h.replace(/^(in|company)\//, '')) return true
  if (allowNames) {
    const lf = loose(found)
    if (lf && (lf === loose(account.handle) || (account.displayName && lf === loose(account.displayName)))) return true
  }
  return false
}

/**
 * HANDLE CHECK: `found` are the identities the platform shows for the logged-in account (only the
 * current account's own UI — never feed content). Nothing found → refuse rather than guess.
 * allowNames: platforms that show a display name instead of a handle (Facebook, LinkedIn pages).
 */
export function assertHandle(rt: RunContext, account: Pick<Account, 'handle' | 'displayName'>, found: string[], platform: string, allowNames = false): string {
  const list = [...new Set(found.map((f) => (f || '').trim()).filter(Boolean))]
  if (!list.length) throw new GuardrailError(`${platform}: no logged-in account is showing — the brand is probably logged out. Log in from Brand → Accounts, then try again.`, 'handle_check')
  const ok = list.find((f) => identityMatches(f, account, allowNames))
  if (ok) {
    rt.log(`Logged in as ${ok} ✓`)
    return ok
  }
  throw new GuardrailError(`${platform} is logged in as ${list[0].startsWith('@') || allowNames ? list[0] : '@' + normHandle(list[0])}, but this post is for @${normHandle(account.handle)} — switch accounts in the window, then try again`, 'handle_check')
}

// ── outcome ──────────────────────────────────────────────────────────────────
/**
 * After the final click: wait for a success text / URL, fail fast on an error text, and keep the
 * checkpoint stop running while waiting (uploads can take minutes).
 */
export async function waitForOutcome(
  rt: RunContext,
  page: Page,
  o: { success: RegExp[]; successUrl?: RegExp; gone?: Locator; failure?: RegExp[]; timeout?: number; what: string }
): Promise<'text' | 'url' | 'gone'> {
  const until = Date.now() + (o.timeout ?? 5 * 60_000)
  let lastCheck = Date.now()
  for (;;) {
    rt.throwIfAborted()
    if (o.successUrl && o.successUrl.test(page.url())) return 'url'
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (o.success.some((r) => r.test(text))) return 'text'
    const bad = o.failure?.map((r) => text.match(r)).find(Boolean)
    if (bad) throw new UserError(`${o.what}: the platform said "${bad[0].slice(0, 160)}"`)
    if (o.gone && !(await o.gone.first().isVisible().catch(() => false))) return 'gone'
    if (Date.now() >= until) throw new UserError(`${o.what}: no confirmation after ${Math.round((o.timeout ?? 300_000) / 60_000)} min — check the window before retrying, it may have posted`)
    if (Date.now() - lastCheck > 5000) {
      lastCheck = Date.now()
      await rt.checkpoint()
    }
    await rt.sleep(700)
  }
}

/** 'prepare' ends here: screenshot of the filled composer, left open for the person. */
export async function finishPrepare(rt: RunContext, platform: string, extra = ''): Promise<RecipeResult> {
  const screen = await rt.screenshot(`prepared ${platform}`)
  return { screen, note: `${platform} composer is filled and left open — the final button was not clicked.${extra ? ' ' + extra : ''}` }
}

/** Read hrefs / texts from the page in one evaluate (used by identity readers). */
export async function readAll(page: Page, fn: () => string[]): Promise<string[]> {
  return page.evaluate(fn).catch(() => [] as string[])
}
