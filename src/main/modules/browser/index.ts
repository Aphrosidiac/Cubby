// OWNER: browser module builder. This file is the module's PUBLIC interface — keep every export
// (names + signatures); replace the stub bodies with the real implementation (split into files
// under modules/browser/ as you like and re-export from here).
//
// Responsibilities (PLAN §5, §6.1 window tools, §6.2 import, §6.3 extensions):
//  - find Google Chrome (Settings.chromePath override → Windows/Mac standard paths), read its version
//  - launch a brand: write Preferences (theme colour from brand.color, session restore on, downloads
//    dir, Chrome password manager off, profile name = brand name) then spawn Chrome DETACHED with
//    --user-data-dir=<profileDir> --remote-debugging-port=0 + the flags in PLAN §5, window size/pos,
//    startup URLs; read the port from <profileDir>/DevToolsActivePort; connect playwright-core
//    chromium.connectOverCDP; setBrandStatus(open, {cdpPort, pid})
//  - one Playwright Browser per open brand, cached; detect disconnect/crash → status closed/error
//    (+ 5 s heartbeat on /json/version); "Reopen" is just openBrand again
//  - adoptAll() on app start: for brands whose DevToolsActivePort answers, reconnect; others → closed
//  - track the "active page" per brand (the tab Claude / recipes act on); new tabs the person opens
//    do not steal it unless the active one closed
//  - window tools through CDP Browser.getWindowForTarget / Browser.setWindowBounds: tile, cascade,
//    bring to front (minimize→normal trick so the OS raises it)
//  - list Chrome profiles of the person's own Chrome ("Local State" profile.info_cache) and import
//    one into a new brand by copying its profile folder files (Cookies, Login Data, Local Storage,
//    IndexedDB, Preferences, Web Data, Extensions…) into <profileDir>/Default + copying "Local State"
//    (holds the os_crypt key) — same machine + same OS user only
//  - list extensions from <profileDir>/Default/Preferences (extensions.settings)
//  - implement commands: brands.open, brands.close, brands.closeAll, brands.front, brands.arrange,
//    brands.openUrl, brands.chromeProfiles, brands.extensions
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { Actor, ChromeProfileInfo, WindowBounds } from '@shared/types'
import { UserError } from '../../core/errors'

const todo = (what: string): never => {
  throw new UserError(`${what} is not built yet`, 'not_implemented')
}

export interface OpenResult {
  cdpUrl: string
  wsEndpoint: string
}

/** Open (or reuse) a brand's Chrome. Resolves when CDP is connected. */
export async function openBrand(brandId: string, opts: { urls?: string[]; actor?: Actor; background?: boolean } = {}): Promise<OpenResult> {
  return todo(`openBrand(${brandId}, ${JSON.stringify(opts)})`)
}

/** Close a brand's Chrome gracefully (Browser.close over CDP, then kill after 5 s). */
export async function closeBrand(brandId: string): Promise<void> {
  return todo(`closeBrand(${brandId})`)
}

export async function closeAllBrands(): Promise<void> {
  return todo('closeAllBrands')
}

export function isBrandOpen(brandId: string): boolean {
  void brandId
  return false
}

/** Connected Playwright Browser; opens the brand first when ensureOpen (default true). */
export async function getBrowser(brandId: string, ensureOpen = true): Promise<Browser> {
  return todo(`getBrowser(${brandId}, ${ensureOpen})`)
}

/** The brand's (single, persistent) browser context — cookies live here. */
export async function getContext(brandId: string, ensureOpen = true): Promise<BrowserContext> {
  return todo(`getContext(${brandId}, ${ensureOpen})`)
}

/** The tab Claude / recipes act on. Creates one if the brand has no pages. */
export async function activePage(brandId: string, ensureOpen = true): Promise<Page> {
  return todo(`activePage(${brandId}, ${ensureOpen})`)
}

export function setActivePage(brandId: string, page: Page): void {
  void brandId
  void page
}

/** Bring the brand's window to the front (and focus `page` if given). */
export async function frontBrand(brandId: string, page?: Page): Promise<void> {
  void page
  return todo(`frontBrand(${brandId})`)
}

export async function arrangeWindows(mode: 'tile' | 'cascade', brandIds?: string[]): Promise<void> {
  return todo(`arrangeWindows(${mode}, ${brandIds})`)
}

export async function setWindowBounds(brandId: string, bounds: Partial<WindowBounds>): Promise<void> {
  return todo(`setWindowBounds(${brandId}, ${JSON.stringify(bounds)})`)
}

/** Installed Google Chrome, or null when not found. Cached; refresh=true re-detects. */
export function chromeInfo(refresh = false): { path: string; version: string } | null {
  void refresh
  return null
}

export function listChromeProfiles(): ChromeProfileInfo[] {
  return []
}

/** Copy an existing Chrome profile (path from listChromeProfiles) into a brand's profile folder. */
export async function importChromeProfile(sourceProfilePath: string, targetProfileDir: string): Promise<void> {
  return todo(`importChromeProfile(${sourceProfilePath}, ${targetProfileDir})`)
}

/** Re-attach to brand Chromes still running from a previous app session. */
export async function adoptAll(): Promise<void> {}

export function start(): void {}
export async function stop(): Promise<void> {}
