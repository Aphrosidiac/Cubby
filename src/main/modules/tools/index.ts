// Browser tools for Claude and API tokens (PLAN §8): every command acts on the brand's active page
// (modules/browser) through Playwright. Guardrails for actor claude / api live here, not in the doors:
// brand busy with a run, off-limits pages (before navigating and after every action), checkpoint stop
// after actions, no typing into password / 2FA fields, uploads only from the media library or watch
// folders. Screenshots are saved under paths.screens.
// Implements commands: browser.*
import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { detectCheckpoint } from '@shared/checkpoints'
import { isOffLimits } from '@shared/platforms'
import type { Brand, Checkpoint, TabInfo } from '@shared/types'
import { logActivity } from '../../core/activity'
import { db } from '../../core/db'
import { GuardrailError, UserError } from '../../core/errors'
import { notify } from '../../core/notify'
import { paths } from '../../core/paths'
import { implement, type Ctx } from '../../core/registry'
import { getBrand } from '../brands/repo'
import { activePage, frontBrand, getContext, isBrandOpen, setActivePage } from '../browser'
// pageFacts: the run manager's visible-text / visible-frame / dialog reader, so Claude's tools and
// recipes judge checkpoints from the same facts
import { brandBusy, pageFacts } from '../runs'
import { checkUploadPaths, checkUrl, cleanRef, describeField, isSecretField, isTypingKey, normPath, truncate, type FieldInfo } from './guards'

const ACTION_TIMEOUT = 10_000
const SNAPSHOT_MAX = 40_000
const TEXT_MAX = 20_000

/** Guardrails apply to Claude and API tokens; the person (and runs, which guard themselves) are trusted. */
const guarded = (ctx: Ctx): boolean => ctx.actor === 'claude' || ctx.actor === 'api'

function stopped(ctx: Ctx): Error {
  return ctx.signal?.reason instanceof UserError ? ctx.signal.reason : new GuardrailError('Stopped — Cubby\'s kill switch was pressed or the request was cancelled.', 'kill_switch')
}

/** Reject as soon as ctx.signal aborts (kill switch / MCP request cancelled). */
async function abortable<T>(ctx: Ctx, p: Promise<T>): Promise<T> {
  const sig = ctx.signal
  if (!sig) return p
  if (sig.aborted) throw stopped(ctx)
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, rej) => {
    onAbort = () => rej(stopped(ctx))
    sig.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([p, aborted])
  } finally {
    sig.removeEventListener('abort', onAbort)
  }
}

interface Target {
  brand: Brand
  page: Page
}

/** Brand + its active page, after the busy / open checks. */
async function prepare(brandId: string, ctx: Ctx): Promise<Target> {
  const brand = getBrand(brandId)
  if (brand.deletedAt) throw new UserError(`${brand.name} is in the recycle bin`)
  if (guarded(ctx)) {
    const live = brandBusy(brandId)
    if (live && live.runId !== ctx.runId)
      throw new GuardrailError(`${brand.name} is busy: "${live.label}" (${live.actor}) is running in it. Wait for it to finish (check activity_tail), then try again.`, 'brand_busy')
    if (!isBrandOpen(brandId)) throw new UserError(`${brand.name} is not open — open it first (brand_open / POST /api/brands/:ref/open).`)
  }
  if (ctx.signal?.aborted) throw stopped(ctx)
  const page = await abortable(ctx, activePage(brandId, !guarded(ctx)))
  return { brand, page }
}

async function settle(page: Page, ms = 400): Promise<void> {
  await page.waitForTimeout(ms).catch(() => {})
  await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {})
}

function refuseOffLimitsPage(page: Page, ctx: Ctx, what: string): void {
  if (guarded(ctx) && isOffLimits(page.url())) throw new GuardrailError(`The current tab is an off-limits page (${page.url()}); ${what} is not allowed there. Navigate somewhere else first.`, 'off_limits')
}

/** After an action: if the page ended up on an off-limits URL, go back and refuse. */
async function offLimitsAfter(t: Target, ctx: Ctx): Promise<void> {
  if (!guarded(ctx) || !isOffLimits(t.page.url())) return
  const url = t.page.url()
  await t.page.goBack({ timeout: 5_000 }).catch(() => null)
  if (isOffLimits(t.page.url())) await t.page.goto('about:blank').catch(() => {})
  logActivity({ actor: ctx.actor, brandId: t.brand.id, action: 'guardrail.off_limits', detail: { url, via: ctx.tokenName ?? undefined } })
  throw new GuardrailError(`That action led to an off-limits page (${url}) — went back. Account settings, security, passwords, 2FA, billing and deactivation pages are for the person only.`, 'off_limits')
}

const KIND_LABEL: Record<Checkpoint['kind'], string> = { checkpoint: 'security checkpoint', captcha: 'captcha', rate_limit: 'rate-limit warning', login_wall: 'login wall' }

/** Checkpoint stop: front the window, tell the person, refuse. Never solved by Cubby. */
async function checkpointAfter(t: Target, ctx: Ctx, action: string): Promise<void> {
  if (!guarded(ctx)) return
  const facts = await pageFacts(t.page)
  const hit = detectCheckpoint(facts)
  if (!hit) return
  await frontBrand(t.brand.id, t.page).catch(() => {})
  notify({ title: `${t.brand.name} needs you`, body: `${KIND_LABEL[hit.kind]}: ${hit.reason}`, urgent: true })
  logActivity({ actor: ctx.actor, brandId: t.brand.id, action: 'guardrail.checkpoint', detail: { kind: hit.kind, reason: hit.reason, url: facts.url, after: action, via: ctx.tokenName ?? undefined } })
  throw new GuardrailError(
    `STOP: ${t.brand.name} is showing a ${KIND_LABEL[hit.kind]} (${hit.reason}). Do not try to solve or bypass it. Tell the person — the ${t.brand.name} window is now in front and they need to handle it themselves.`,
    'checkpoint'
  )
}

/** Locator for ref (from snapshot) | selector | text. */
function locate(page: Page, i: { ref?: string; selector?: string; text?: string }): Locator {
  if (i.ref) return page.getByRef(cleanRef(i.ref))
  if (i.selector) return page.locator(i.selector).first()
  if (i.text) return page.getByText(i.text).filter({ visible: true }).first()
  throw new UserError('Say which element: ref (from snapshot), selector or text.')
}

/** The focused field in any frame of the page (password fields often live in login iframes). */
async function focusedField(page: Page): Promise<FieldInfo | null> {
  for (const f of page.frames()) {
    const info = await f
      .evaluate(() => {
        if (!document.hasFocus()) return null
        const el = document.activeElement
        if (!el || el === document.body || el.tagName === 'IFRAME') return null
        return { tag: el.tagName, type: el.getAttribute('type'), autocomplete: el.getAttribute('autocomplete'), name: el.getAttribute('name'), id: el.getAttribute('id') }
      })
      .catch(() => null)
    if (info) return info
  }
  return null
}

const NO_SECRETS = 'Claude never types into password, 2FA or one-time-code fields. Ask the person to fill it in (Cubby\'s Fill login can do it for them).'

async function tabInfos(brandId: string): Promise<TabInfo[]> {
  const ctx = await getContext(brandId, false)
  const active = await activePage(brandId, false).catch(() => null)
  const pages = ctx.pages()
  return Promise.all(pages.map(async (p, index) => ({ index, url: p.url(), title: await p.title().catch(() => ''), active: p === active })))
}

async function pageAt(brandId: string, index: number): Promise<Page> {
  const pages = (await getContext(brandId, false)).pages()
  const p = pages[index]
  if (!p) throw new UserError(`No tab ${index} — there are ${pages.length} tab(s) (0-${Math.max(0, pages.length - 1)}). Call tabs to list them.`)
  return p
}

/** Run an action that may open a new tab; a tab opened by it becomes the active page (after guards). */
async function act(t: Target, ctx: Ctx, action: string, fn: () => Promise<unknown>): Promise<{ url: string }> {
  const context = t.page.context()
  const before = new Set(context.pages())
  await abortable(ctx, fn())
  await settle(t.page)
  const opened = context.pages().filter((p) => !before.has(p))
  for (const p of opened) {
    await p.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {})
    if (guarded(ctx) && isOffLimits(p.url())) {
      const url = p.url()
      await p.close().catch(() => {})
      throw new GuardrailError(`That action opened an off-limits page (${url}) — closed it.`, 'off_limits')
    }
  }
  if (opened.length) {
    t.page = opened[opened.length - 1]
    setActivePage(t.brand.id, t.page)
  }
  await offLimitsAfter(t, ctx)
  await checkpointAfter(t, ctx, action)
  return { url: t.page.url() }
}

function screensFile(brand: Brand): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return join(paths.screens, `${brand.slug}-${ts}.png`)
}

/** Allow-list for uploads: indexed media files + watch folders. */
function uploadAllowList(): { mediaPaths: Set<string>; folders: string[] } {
  const media = db.all<{ path: string }>('SELECT path FROM media WHERE missing = 0')
  const folders = db.all<{ path: string }>('SELECT path FROM watch_folders')
  return { mediaPaths: new Set(media.map((m) => normPath(m.path))), folders: folders.map((f) => normPath(f.path)) }
}

export function guardUploadPaths(paths: string[]): void {
  const { bad } = checkUploadPaths(paths, uploadAllowList(), (p) => realpathSync.native(p))
  if (bad.length)
    throw new GuardrailError(
      `Can only upload files from Cubby's media library or its watch folders. Refused: ${bad.join(', ')}. Use media_find to get library paths, or ask the person to add the file to the library.`,
      'upload_path'
    )
}

implement({
  'browser.tabs': async ({ brandId }, ctx) => {
    await prepare(brandId, ctx)
    return tabInfos(brandId)
  },

  'browser.tabOpen': async ({ brandId, url }, ctx) => {
    await prepare(brandId, ctx)
    let target = 'about:blank'
    if (url) {
      const c = checkUrl(url)
      if ('refused' in c) {
        if (guarded(ctx)) throw new GuardrailError(c.refused, 'off_limits')
        target = url
      } else target = c.url
    }
    const context = await getContext(brandId, false)
    const page = await abortable(ctx, context.newPage())
    setActivePage(brandId, page)
    if (target !== 'about:blank') {
      const t: Target = { brand: getBrand(brandId), page }
      await act(t, ctx, 'browser.tabOpen', () => page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 }))
    }
    return tabInfos(brandId)
  },

  'browser.tabSelect': async ({ brandId, index }, ctx) => {
    await prepare(brandId, ctx)
    const page = await pageAt(brandId, index)
    if (guarded(ctx) && isOffLimits(page.url())) throw new GuardrailError(`Tab ${index} is an off-limits page (${page.url()}) — it stays with the person.`, 'off_limits')
    setActivePage(brandId, page)
    await page.bringToFront().catch(() => {})
    return tabInfos(brandId)
  },

  'browser.tabClose': async ({ brandId, index }, ctx) => {
    const { page: active } = await prepare(brandId, ctx)
    const pages = (await getContext(brandId, false)).pages()
    const page = index === undefined ? active : await pageAt(brandId, index)
    if (pages.length <= 1) throw new UserError('That is the last tab — closing it would close the brand window. Use brand_close to close the brand.')
    await page.close()
    if (page === active) {
      const rest = (await getContext(brandId, false)).pages()
      if (rest.length) setActivePage(brandId, rest[rest.length - 1])
    }
    return tabInfos(brandId)
  },

  'browser.navigate': async ({ brandId, url }, ctx) => {
    const t = await prepare(brandId, ctx)
    const c = checkUrl(url)
    let target = url
    if ('refused' in c) {
      if (guarded(ctx)) throw new GuardrailError(c.refused, 'off_limits')
    } else target = c.url
    await act(t, ctx, 'browser.navigate', () => t.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 }))
    return { url: t.page.url(), title: await t.page.title().catch(() => '') }
  },

  'browser.snapshot': async ({ brandId }, ctx) => {
    const t = await prepare(brandId, ctx)
    refuseOffLimitsPage(t.page, ctx, 'reading it')
    let snap: string
    try {
      snap = await abortable(ctx, t.page.ariaSnapshot({ mode: 'ai', timeout: 15_000 }))
    } catch (e) {
      if (e instanceof UserError) throw e
      snap = await abortable(ctx, t.page.locator('body').ariaSnapshot({ timeout: 15_000 }))
    }
    return { url: t.page.url(), title: await t.page.title().catch(() => ''), snapshot: truncate(snap, SNAPSHOT_MAX, 'snapshot') }
  },

  'browser.click': async (i, ctx) => {
    const t = await prepare(i.brandId, ctx)
    refuseOffLimitsPage(t.page, ctx, 'clicking')
    const loc = locate(t.page, i)
    return act(t, ctx, 'browser.click', () => loc.click({ timeout: ACTION_TIMEOUT }))
  },

  'browser.type': async (i, ctx) => {
    const t = await prepare(i.brandId, ctx)
    refuseOffLimitsPage(t.page, ctx, 'typing')
    const hasTarget = !!(i.ref || i.selector || i.text)
    const loc = hasTarget ? locate(t.page, i) : null
    if (guarded(ctx)) {
      const field = loc ? await loc.evaluate(describeField, undefined, { timeout: ACTION_TIMEOUT }) : await focusedField(t.page)
      if (isSecretField(field)) throw new GuardrailError(NO_SECRETS, 'no_secrets')
    }
    return act(t, ctx, 'browser.type', async () => {
      if (loc && i.clear !== false) await loc.fill(i.value, { timeout: ACTION_TIMEOUT })
      else {
        if (loc) await loc.click({ timeout: ACTION_TIMEOUT })
        await t.page.keyboard.type(i.value, { delay: 15 })
      }
      if (i.submit) await t.page.keyboard.press('Enter')
    })
  },

  'browser.press': async ({ brandId, key }, ctx) => {
    const t = await prepare(brandId, ctx)
    refuseOffLimitsPage(t.page, ctx, 'pressing keys')
    if (guarded(ctx) && isTypingKey(key) && isSecretField(await focusedField(t.page))) throw new GuardrailError(NO_SECRETS, 'no_secrets')
    return act(t, ctx, 'browser.press', () => t.page.keyboard.press(key))
  },

  'browser.scroll': async ({ brandId, dy }, ctx) => {
    const t = await prepare(brandId, ctx)
    await abortable(ctx, t.page.mouse.wheel(0, dy))
    await t.page.waitForTimeout(350).catch(() => {})
    return { url: t.page.url() }
  },

  'browser.waitFor': async ({ brandId, selector, text, timeoutMs }, ctx) => {
    const t = await prepare(brandId, ctx)
    if (!selector && !text) throw new UserError('Give a selector or text to wait for.')
    const loc = selector ? t.page.locator(selector).first() : t.page.getByText(text!).first()
    try {
      await abortable(ctx, loc.waitFor({ state: 'visible', timeout: timeoutMs ?? 10_000 }))
      return { found: true }
    } catch (e) {
      if (e instanceof UserError) throw e
      return { found: false }
    }
  },

  'browser.screenshot': async ({ brandId, fullPage }, ctx) => {
    const t = await prepare(brandId, ctx)
    refuseOffLimitsPage(t.page, ctx, 'a screenshot')
    const buf = await abortable(ctx, t.page.screenshot({ type: 'png', fullPage: !!fullPage, timeout: 20_000 }))
    const file = screensFile(t.brand)
    writeFileSync(file, buf)
    return { path: file, base64: buf.toString('base64') }
  },

  'browser.pageText': async ({ brandId, maxChars }, ctx) => {
    const t = await prepare(brandId, ctx)
    refuseOffLimitsPage(t.page, ctx, 'reading it')
    const max = Math.min(Math.max(maxChars ?? TEXT_MAX, 500), 100_000)
    const text = await abortable(ctx, t.page.evaluate(() => (document.body ? document.body.innerText : '')))
    return { url: t.page.url(), title: await t.page.title().catch(() => ''), text: truncate(text, max, 'text') }
  },

  'browser.upload': async (i, ctx) => {
    const t = await prepare(i.brandId, ctx)
    refuseOffLimitsPage(t.page, ctx, 'uploading')
    if (guarded(ctx)) guardUploadPaths(i.paths)
    const loc = i.ref || i.selector || i.text ? locate(t.page, i) : t.page.locator('input[type=file]').first()
    return act(t, ctx, 'browser.upload', async () => {
      const isFileInput = await loc.evaluate((el) => el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file', undefined, { timeout: ACTION_TIMEOUT })
      if (isFileInput) await loc.setInputFiles(i.paths, { timeout: ACTION_TIMEOUT })
      else {
        const [chooser] = await Promise.all([t.page.waitForEvent('filechooser', { timeout: ACTION_TIMEOUT }), loc.click({ timeout: ACTION_TIMEOUT })])
        await chooser.setFiles(i.paths)
      }
    })
  }
})

export function start(): void {}
export async function stop(): Promise<void> {}
