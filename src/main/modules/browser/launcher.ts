// The brand launcher (PLAN §5): spawn Chrome detached on the brand's own profile with CDP on an
// OS-picked port, connect Playwright, watch it (disconnect + 5 s heartbeat), re-adopt Chromes that
// outlived the app, close gracefully, and move windows through CDP. Electron-free — the screen work
// area for tiling is passed in — so a vitest drives real Chromes through this file.
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core'
import type { Brand, WindowBounds } from '@shared/types'
import { UserError } from '../../core/errors'
import { emit } from '../../core/events'
import { requestStatus } from '../../core/runtime'
import { getSettings } from '../../core/settings'
import { getBrand, listBrandsRaw, setBrandStatus } from '../brands/repo'
import { findChrome, type ChromeInstall } from './chrome'
import { isLive, readDevToolsActivePort, removeDevToolsActivePort, type DevToolsPort } from './devtools'
import { writeBrandPrefs } from './prefs'

export interface OpenResult {
  cdpUrl: string
  wsEndpoint: string
}

export interface OpenOptions {
  urls?: string[]
  /** open without taking focus (window minimized right after launch) */
  background?: boolean
}

interface Session {
  brandId: string
  port: number
  wsPath: string
  browser: Browser
  context: BrowserContext
  pid: number | null
  openedAt: number
  /** true when this app spawned it (vs adopted) */
  launched: boolean
  active: Page | null
  cdp: CDPSession | null
  beat: NodeJS.Timeout | null
  misses: number
  closing: boolean
  /** app is stopping: drop the connection, leave Chrome (and its status) alone */
  detaching: boolean
  /** opened in the background (health / cookies) and not yet asked for by the person */
  background: boolean
}

const sessions = new Map<string, Session>()
const opening = new Map<string, Promise<OpenResult>>()

export const LAUNCH_TIMEOUT_MS = 20_000
const HEARTBEAT_MS = 5_000
const CLOSE_GRACE_MS = 5_000

const FLAGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling'
]

// ── Chrome install ───────────────────────────────────────────────────────────

let chromeCache: ChromeInstall | null | undefined

function settingsChromePath(): string | null {
  try {
    return getSettings().chromePath
  } catch {
    return null
  }
}

/** Installed Google Chrome (Settings override first), cached; refresh re-detects. */
export function chromeInfo(refresh = false): ChromeInstall | null {
  if (refresh || chromeCache === undefined) chromeCache = findChrome(settingsChromePath())
  return chromeCache
}

function chromeFor(brand: Brand): string {
  if (brand.chromePath) {
    if (!existsSync(brand.chromePath)) throw new UserError(`The Chrome install set for ${brand.name} was not found (${brand.chromePath}). Fix it in the brand's Settings.`)
    return brand.chromePath
  }
  const c = chromeInfo(true)
  if (!c) throw new UserError('Google Chrome was not found. Install it, or set its location in Settings → Chrome.')
  return c.path
}

// ── helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function pidAlive(pid: number | null | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function killPid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve())
    else {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* gone */
      }
      resolve()
    }
  })
}

/** Is some Chrome (not started with debugging by us) holding this profile? */
export function profileLocked(profileDir: string): boolean {
  if (process.platform === 'win32') {
    const lock = join(profileDir, 'lockfile')
    if (!existsSync(lock)) return false
    try {
      rmSync(lock, { force: true })
      return false
    } catch (e) {
      const c = (e as NodeJS.ErrnoException).code
      return c === 'EBUSY' || c === 'EPERM' || c === 'EACCES'
    }
  }
  try {
    const target = readlinkSync(join(profileDir, 'SingletonLock'))
    const pid = Number(target.split('-').pop())
    return pidAlive(pid)
  } catch {
    return false
  }
}

/** Only URLs (never something Chrome could read as a switch). Bare hosts get https://. */
export function safeUrls(urls: string[]): string[] {
  return urls
    .map((u) => u.trim())
    .filter((u) => u && !u.startsWith('-'))
    .map((u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`))
    .filter((u) => /^(https?|file|chrome|about):/i.test(u))
}

export function chromeArgs(profileDir: string, win: WindowBounds, urls: string[]): string[] {
  const args = [`--user-data-dir=${profileDir}`, '--remote-debugging-port=0', ...FLAGS, `--window-size=${win.width},${win.height}`]
  if (win.x != null && win.y != null) args.push(`--window-position=${win.x},${win.y}`)
  return [...args, ...safeUrls(urls)]
}

const result = (s: Session): OpenResult => ({ cdpUrl: `http://127.0.0.1:${s.port}`, wsEndpoint: `ws://127.0.0.1:${s.port}${s.wsPath}` })

function status(id: string, st: Brand['status'], extra: Parameters<typeof setBrandStatus>[2] = {}): void {
  try {
    setBrandStatus(id, st, extra)
  } catch (e) {
    console.warn('setBrandStatus failed', id, e)
  }
  emit('brands.changed', { ids: [id] })
  requestStatus()
}

// ── sessions ─────────────────────────────────────────────────────────────────

function pickFallback(s: Session): Page | null {
  const pages = s.context.pages().filter((p) => !p.isClosed())
  return pages.length ? pages[pages.length - 1] : null
}

function watchPage(s: Session, p: Page): void {
  p.on('close', () => {
    if (s.active === p) s.active = pickFallback(s)
  })
}

function onGone(s: Session): void {
  if (sessions.get(s.brandId) !== s) return
  sessions.delete(s.brandId)
  if (s.beat) clearInterval(s.beat)
  s.beat = null
  if (s.detaching) return
  if (s.closing) return status(s.brandId, 'closed', { cdpPort: null, pid: null })
  const quick = s.launched && Date.now() - s.openedAt < 3000
  status(s.brandId, quick ? 'error' : 'closed', { cdpPort: null, pid: null, error: quick ? 'Chrome closed right after opening. Try Reopen; if it keeps happening, check the Chrome install in Settings.' : null })
}

function startHeartbeat(s: Session): void {
  s.beat = setInterval(async () => {
    if (s.closing || s.detaching) return
    const ok = await isLive({ port: s.port, wsPath: s.wsPath }, 2000)
    s.misses = ok ? 0 : s.misses + 1
    if (s.misses >= 2) {
      onGone(s)
      s.browser.close().catch(() => {})
    }
  }, HEARTBEAT_MS)
  s.beat.unref?.()
}

async function processPid(browser: Browser): Promise<number | null> {
  try {
    const cdp = await browser.newBrowserCDPSession()
    const info = (await cdp.send('SystemInfo.getProcessInfo')) as { processInfo: { type: string; id: number }[] }
    await cdp.detach().catch(() => {})
    return info.processInfo.find((p) => p.type === 'browser')?.id ?? null
  } catch {
    return null
  }
}

async function attach(brandId: string, dt: DevToolsPort, pid: number | null, launched: boolean): Promise<Session> {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${dt.port}`, { timeout: 15_000 })
  const context = browser.contexts()[0]
  if (!context) {
    await browser.close().catch(() => {})
    throw new UserError('Connected to Chrome but it has no browser context')
  }
  const s: Session = { brandId, port: dt.port, wsPath: dt.wsPath, browser, context, pid, openedAt: Date.now(), launched, active: null, cdp: null, beat: null, misses: 0, closing: false, detaching: false, background: false }
  if (!s.pid) s.pid = await processPid(browser)
  for (const p of context.pages()) watchPage(s, p)
  s.active = pickFallback(s)
  context.on('page', (p) => {
    watchPage(s, p)
    if (!s.active || s.active.isClosed()) s.active = p
  })
  browser.on('disconnected', () => onGone(s))
  sessions.set(brandId, s)
  startHeartbeat(s)
  return s
}

async function openTabs(s: Session, urls: string[]): Promise<void> {
  for (const u of safeUrls(urls)) {
    const p = await s.context.newPage()
    await p.goto(u, { waitUntil: 'commit', timeout: 30_000 }).catch(() => {})
  }
}

async function launch(brand: Brand, opts: OpenOptions): Promise<Session> {
  const exe = chromeFor(brand)
  mkdirSync(brand.profileDir, { recursive: true })
  if (profileLocked(brand.profileDir))
    throw new UserError(`${brand.name} is already open in a Chrome window Cubby didn't start. Close that Chrome window, then open the brand again.`)
  removeDevToolsActivePort(brand.profileDir)
  writeBrandPrefs(brand.profileDir, { name: brand.name, color: brand.color, downloadsDir: brand.downloadsDir })

  const urls = opts.urls?.length ? opts.urls : brand.startupUrls
  const started = Date.now()
  const proc = await spawnChrome(exe, chromeArgs(brand.profileDir, brand.window, urls), brand.profileDir)

  let dt: DevToolsPort | null = null
  while (Date.now() - started < LAUNCH_TIMEOUT_MS) {
    dt = readDevToolsActivePort(brand.profileDir)
    if (dt) break
    if (proc.exited()) {
      // Chrome handed the command line to an instance already running on this profile and quit
      if (profileLocked(brand.profileDir) || proc.exitCode() === 0)
        throw new UserError(`${brand.name} is already open in a Chrome window Cubby didn't start. Close that Chrome window, then open the brand again.`)
      throw new UserError(`Chrome exited while starting${proc.exitCode() != null ? ` (code ${proc.exitCode()})` : ''}`)
    }
    await sleep(100)
  }
  if (!dt) {
    if (proc.pid && pidAlive(proc.pid)) await killPid(proc.pid)
    throw new UserError(`Chrome did not report its debugging port within ${LAUNCH_TIMEOUT_MS / 1000} s`)
  }
  return attach(brand.id, dt, proc.pid, true)
}

interface Spawned {
  pid: number | null
  exited: () => boolean
  /** null when unknown (Windows launch goes through the shell) */
  exitCode: () => number | null
}

/** Windows command-line quoting (CommandLineToArgvW rules). */
export function winQuote(a: string): string {
  if (a && !/[\s"]/.test(a)) return a
  return '"' + a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
}

/**
 * Start Chrome detached. On Windows a direct spawn would let Chrome INHERIT Electron's open
 * handles — including listening sockets (Local API port, DevTools port) — so after Cubby quits
 * those ports stay taken until every brand Chrome closes. Launching through ShellExecute
 * (rundll32 shell32 ShellExec_RunDLL, ~150 ms; PowerShell Start-Process measured 0.6–2 s) gives
 * Chrome a clean handle table. The pid is read over CDP after connecting.
 */
async function spawnChrome(exe: string, args: string[], profileDir: string): Promise<Spawned> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) =>
      execFile('rundll32.exe', ['shell32.dll,ShellExec_RunDLL', winQuote(exe), ...args.map(winQuote)], { windowsHide: true, windowsVerbatimArguments: true, timeout: 15_000 }, (err) =>
        err ? reject(new UserError(`Could not start Chrome: ${err.message}`)) : resolve()
      )
    )
    const at = Date.now()
    // Chrome takes its profile lock within a second of starting; no lock after 4 s = it is gone
    return { pid: null, exited: () => Date.now() - at > 4000 && !profileLocked(profileDir), exitCode: () => null }
  }
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' })
  let code: number | null = null
  let done = false
  let error: Error | null = null
  child.on('exit', (c) => {
    done = true
    code = c
  })
  child.on('error', (e) => {
    done = true
    error = e
  })
  child.unref()
  await sleep(50)
  if (error) throw new UserError(`Could not start Chrome: ${(error as Error).message}`)
  return { pid: child.pid ?? null, exited: () => done, exitCode: () => code }
}

async function minimizeAll(s: Session): Promise<void> {
  for (const w of await windowIds(s)) {
    await (await browserCdp(s)).send('Browser.setWindowBounds', { windowId: w, bounds: { windowState: 'minimized' } }).catch(() => {})
  }
}

async function doOpen(brandId: string, opts: OpenOptions): Promise<OpenResult> {
  const brand = getBrand(brandId)
  if (brand.deletedAt) throw new UserError(`${brand.name} is in the recycle bin — restore it first`)
  mkdirSync(brand.profileDir, { recursive: true })
  const prev = readDevToolsActivePort(brand.profileDir)
  if (prev && (await isLive(prev))) {
    // still running from an earlier session: adopt it instead of starting a second Chrome
    const s = await attach(brandId, prev, null, false)
    status(brandId, 'open', { cdpPort: s.port, pid: s.pid, touch: !opts.background })
    if (opts.urls?.length) await openTabs(s, opts.urls)
    return result(s)
  }
  status(brandId, 'opening')
  try {
    const s = await launch(brand, opts)
    status(brandId, 'open', { cdpPort: s.port, pid: s.pid, touch: !opts.background })
    if (opts.background) {
      s.background = true
      await minimizeAll(s)
    }
    return result(s)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    status(brandId, 'error', { cdpPort: null, pid: null, error: msg })
    throw e instanceof UserError ? e : new UserError(`Could not open ${brand.name}: ${msg}`)
  }
}

/** Open (or reuse) a brand's Chrome. Concurrent calls for one brand share one launch. */
export async function openBrand(brandId: string, opts: OpenOptions = {}): Promise<OpenResult> {
  const s = sessions.get(brandId)
  if (s && s.browser.isConnected() && !s.closing) {
    if (opts.urls?.length) await openTabs(s, opts.urls)
    if (!opts.background) {
      s.background = false
      await frontBrand(brandId).catch(() => {})
    }
    return result(s)
  }
  const pending = opening.get(brandId)
  if (pending) return pending
  const p = doOpen(brandId, opts).finally(() => opening.delete(brandId))
  opening.set(brandId, p)
  return p
}

/** True while the brand is open only because a background job (health, cookies) opened it. */
export function isBackground(brandId: string): boolean {
  return !!sessions.get(brandId)?.background
}

export function isBrandOpen(brandId: string): boolean {
  const s = sessions.get(brandId)
  return !!s && s.browser.isConnected() && !s.closing
}

async function session(brandId: string, ensureOpen: boolean): Promise<Session> {
  const s = sessions.get(brandId)
  if (s && s.browser.isConnected() && !s.closing) return s
  if (!ensureOpen) throw new UserError(`${getBrand(brandId).name} is not open`)
  await openBrand(brandId, { background: false })
  const t = sessions.get(brandId)
  if (!t) throw new UserError('The brand closed while opening')
  return t
}

export async function getBrowser(brandId: string, ensureOpen = true): Promise<Browser> {
  return (await session(brandId, ensureOpen)).browser
}

export async function getContext(brandId: string, ensureOpen = true): Promise<BrowserContext> {
  return (await session(brandId, ensureOpen)).context
}

export async function activePage(brandId: string, ensureOpen = true): Promise<Page> {
  const s = await session(brandId, ensureOpen)
  if (s.active && !s.active.isClosed()) return s.active
  s.active = pickFallback(s) ?? (await s.context.newPage())
  return s.active
}

export function setActivePage(brandId: string, page: Page): void {
  const s = sessions.get(brandId)
  if (s) s.active = page
}

/** Open a URL in a new tab of the brand (opening the brand first). Does not move the active page. */
export async function openUrl(brandId: string, url: string): Promise<Page> {
  const [u] = safeUrls([url])
  if (!u) throw new UserError('That is not a web address')
  const s = await session(brandId, true)
  const p = await s.context.newPage()
  await p.goto(u, { waitUntil: 'commit', timeout: 30_000 }).catch(() => {})
  return p
}

// ── closing ──────────────────────────────────────────────────────────────────

/** Close a brand's Chrome: CDP Browser.close, wait for the process, kill it after 5 s. */
export async function closeBrand(brandId: string): Promise<void> {
  let s = sessions.get(brandId)
  if (!s) {
    const brand = getBrand(brandId)
    const dt = readDevToolsActivePort(brand.profileDir)
    if (dt && (await isLive(dt))) s = await attach(brandId, dt, null, false)
    else {
      if (brand.status !== 'closed') status(brandId, 'closed', { cdpPort: null, pid: null })
      return
    }
  }
  s.closing = true
  if (s.beat) clearInterval(s.beat)
  const started = Date.now()
  const pid = s.pid
  try {
    const cdp = await s.browser.newBrowserCDPSession()
    await cdp.send('Browser.close')
  } catch {
    /* the connection drops as Chrome exits */
  }
  while (Date.now() - started < CLOSE_GRACE_MS && (s.browser.isConnected() || pidAlive(pid))) await sleep(100)
  if (pid && pidAlive(pid)) {
    console.warn(`[browser] Chrome for ${brandId} still running ${Date.now() - started} ms after Browser.close (connected=${s.browser.isConnected()}) — killing pid ${pid}`)
    await killPid(pid)
    for (let i = 0; i < 30 && pidAlive(pid); i++) await sleep(100)
  }
  if (s.browser.isConnected()) await s.browser.close().catch(() => {})
  onGone(s)
}

export async function closeAllBrands(): Promise<void> {
  const ids = new Set<string>([...sessions.keys()])
  for (const b of listBrandsRaw(true)) if (b.status === 'open' || b.status === 'opening') ids.add(b.id)
  await Promise.allSettled([...ids].map((id) => closeBrand(id)))
}

/** Drop every Playwright connection without closing the Chromes (app quitting). */
export async function detachAll(): Promise<void> {
  const all = [...sessions.values()]
  for (const s of all) {
    s.detaching = true
    if (s.beat) clearInterval(s.beat)
  }
  await Promise.allSettled(all.map((s) => s.browser.close()))
  for (const s of all) sessions.delete(s.brandId)
}

/** Re-attach to brand Chromes still running from a previous app session; mark the rest closed. */
export async function adoptAll(): Promise<void> {
  const brands = listBrandsRaw(true)
  await Promise.allSettled(
    brands.map(async (b) => {
      if (sessions.has(b.id)) return
      const dt = existsSync(b.profileDir) ? readDevToolsActivePort(b.profileDir) : null
      if (dt && (await isLive(dt))) {
        try {
          const s = await attach(b.id, dt, null, false)
          status(b.id, 'open', { cdpPort: s.port, pid: s.pid, touch: false })
          return
        } catch (e) {
          console.warn('adopt failed', b.name, e)
        }
      }
      if (b.status !== 'closed') status(b.id, 'closed', { cdpPort: null, pid: null })
    })
  )
}

export const openBrandIds = (): string[] => [...sessions.keys()].filter(isBrandOpen)

// ── windows ──────────────────────────────────────────────────────────────────

async function browserCdp(s: Session): Promise<CDPSession> {
  if (!s.cdp) s.cdp = await s.browser.newBrowserCDPSession()
  return s.cdp
}

async function windowIds(s: Session): Promise<number[]> {
  const cdp = await browserCdp(s)
  const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: { targetId: string; type: string }[] }
  const out: number[] = []
  for (const t of targetInfos.filter((x) => x.type === 'page')) {
    try {
      const { windowId } = (await cdp.send('Browser.getWindowForTarget', { targetId: t.targetId })) as { windowId: number }
      if (!out.includes(windowId)) out.push(windowId)
    } catch {
      /* target went away */
    }
  }
  return out
}

async function windowOf(s: Session, page: Page): Promise<number> {
  const c = await s.context.newCDPSession(page)
  try {
    const { targetInfo } = (await c.send('Target.getTargetInfo')) as { targetInfo: { targetId: string } }
    const { windowId } = (await (await browserCdp(s)).send('Browser.getWindowForTarget', { targetId: targetInfo.targetId })) as { windowId: number }
    return windowId
  } finally {
    await c.detach().catch(() => {})
  }
}

async function primaryWindow(s: Session): Promise<number> {
  const page = s.active && !s.active.isClosed() ? s.active : (pickFallback(s) ?? (await s.context.newPage()))
  return windowOf(s, page)
}

async function applyBounds(s: Session, windowId: number, b: { left?: number; top?: number; width?: number; height?: number }): Promise<void> {
  const cdp = await browserCdp(s)
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: b })
}

export async function setWindowBounds(brandId: string, bounds: Partial<WindowBounds>): Promise<void> {
  const s = await session(brandId, false)
  await applyBounds(s, await primaryWindow(s), { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })
}

export async function getWindowBounds(brandId: string): Promise<{ left: number; top: number; width: number; height: number; windowState: string }> {
  const s = await session(brandId, false)
  const { bounds } = (await (await browserCdp(s)).send('Browser.getWindowBounds', { windowId: await primaryWindow(s) })) as { bounds: { left: number; top: number; width: number; height: number; windowState: string } }
  return bounds
}

/** Bring the brand's window to the front: minimize → normal makes the OS raise it. */
export async function frontBrand(brandId: string, page?: Page): Promise<void> {
  const s = await session(brandId, true)
  const p = page && !page.isClosed() ? page : await activePage(brandId)
  const cdp = await browserCdp(s)
  const windowId = await windowOf(s, p)
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }).catch(() => {})
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {})
  await p.bringToFront().catch(() => {})
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Window rectangles for tile (grid over the work area) or cascade (32 px steps at each size). Pure. */
export function layoutWindows(mode: 'tile' | 'cascade', sizes: { width: number; height: number }[], wa: WorkArea): Rect[] {
  const n = sizes.length
  if (!n) return []
  if (mode === 'tile') {
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const w = Math.floor(wa.width / cols)
    const h = Math.floor(wa.height / rows)
    return sizes.map((_, i) => ({ left: wa.x + (i % cols) * w, top: wa.y + Math.floor(i / cols) * h, width: w, height: h }))
  }
  const step = 32
  return sizes.map((sz, i) => {
    const off = (i * step) % Math.max(step, Math.min(wa.width, wa.height) / 2)
    const width = Math.min(sz.width, wa.width - off)
    const height = Math.min(sz.height, wa.height - off)
    return { left: wa.x + off, top: wa.y + off, width, height }
  })
}

/** Tile / cascade the given (default: all open) brands' windows within `wa`. */
export async function arrangeIn(mode: 'tile' | 'cascade', wa: WorkArea, brandIds?: string[]): Promise<number> {
  const order = listBrandsRaw(true)
  const wanted = brandIds?.length ? brandIds : order.map((b) => b.id)
  const ids = wanted.filter(isBrandOpen)
  const brands = ids.map((id) => order.find((b) => b.id === id) ?? getBrand(id))
  const rects = layoutWindows(mode, brands.map((b) => b.window), wa)
  for (const [i, id] of ids.entries()) {
    const s = sessions.get(id)
    if (!s) continue
    await applyBounds(s, await primaryWindow(s), rects[i]).catch((e) => console.warn('arrange failed', id, e))
  }
  return ids.length
}
