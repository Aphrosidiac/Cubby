// The browser module's PUBLIC interface: brand Chromes (launch / adopt / close), the active page per
// brand, window tools, Chrome detection, profile import and extensions (PLAN §5, §6.1–6.3).
// The work lives in electron-free files (launcher, chrome, prefs, devtools, importProfile) so it is
// tested against real Chromes; this file adds the commands and the Electron screen for tiling.
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { Actor, ChromeProfileInfo, WindowBounds } from '@shared/types'
import { implement } from '../../core/registry'
import { getBrand } from '../brands/repo'
import { listOwnChromeProfiles, readExtensions } from './chrome'
import * as L from './launcher'

export type { OpenResult } from './launcher'
export { importChromeProfile } from './importProfile'
export { isBackground } from './launcher'

/** Open (or reuse) a brand's Chrome. Resolves when CDP is connected. */
export async function openBrand(brandId: string, opts: { urls?: string[]; actor?: Actor; background?: boolean } = {}): Promise<L.OpenResult> {
  return L.openBrand(brandId, { urls: opts.urls, background: opts.background })
}

/** Close a brand's Chrome gracefully (Browser.close over CDP, then kill after 5 s). */
export async function closeBrand(brandId: string): Promise<void> {
  return L.closeBrand(brandId)
}

export async function closeAllBrands(): Promise<void> {
  return L.closeAllBrands()
}

export function isBrandOpen(brandId: string): boolean {
  return L.isBrandOpen(brandId)
}

/** Connected Playwright Browser; opens the brand first when ensureOpen (default true). */
export async function getBrowser(brandId: string, ensureOpen = true): Promise<Browser> {
  return L.getBrowser(brandId, ensureOpen)
}

/** The brand's (single, persistent) browser context — cookies live here. */
export async function getContext(brandId: string, ensureOpen = true): Promise<BrowserContext> {
  return L.getContext(brandId, ensureOpen)
}

/** The tab Claude / recipes act on. Creates one if the brand has no pages. */
export async function activePage(brandId: string, ensureOpen = true): Promise<Page> {
  return L.activePage(brandId, ensureOpen)
}

export function setActivePage(brandId: string, page: Page): void {
  L.setActivePage(brandId, page)
}

/** Bring the brand's window to the front (and focus `page` if given). */
export async function frontBrand(brandId: string, page?: Page): Promise<void> {
  return L.frontBrand(brandId, page)
}

/** Work area of the primary display (Electron loaded lazily so the rest stays testable). */
async function workArea(): Promise<L.WorkArea> {
  try {
    const { screen } = await import('electron')
    return screen.getPrimaryDisplay().workArea
  } catch {
    return { x: 0, y: 0, width: 1920, height: 1040 }
  }
}

export async function arrangeWindows(mode: 'tile' | 'cascade', brandIds?: string[]): Promise<void> {
  await L.arrangeIn(mode, await workArea(), brandIds)
}

export async function setWindowBounds(brandId: string, bounds: Partial<WindowBounds>): Promise<void> {
  return L.setWindowBounds(brandId, bounds)
}

/** Installed Google Chrome, or null when not found. Cached; refresh=true re-detects. */
export function chromeInfo(refresh = false): { path: string; version: string } | null {
  return L.chromeInfo(refresh)
}

export function listChromeProfiles(): ChromeProfileInfo[] {
  return listOwnChromeProfiles()
}

/** Re-attach to brand Chromes still running from a previous app session. */
export async function adoptAll(): Promise<void> {
  return L.adoptAll()
}

/** Open a URL in a new tab of the brand (opens the brand first). */
export async function openUrlInBrand(brandId: string, url: string): Promise<Page> {
  return L.openUrl(brandId, url)
}

implement({
  'brands.open': ({ id, urls }, ctx) => openBrand(id, { urls, actor: ctx.actor }),
  'brands.close': ({ id }) => closeBrand(id),
  'brands.closeAll': () => closeAllBrands(),
  'brands.front': ({ id }) => frontBrand(id),
  'brands.arrange': ({ mode, ids }) => arrangeWindows(mode, ids),
  'brands.openUrl': async ({ id, url }) => {
    const p = await openUrlInBrand(id, url)
    await frontBrand(id, p)
  },
  'brands.chromeProfiles': () => listChromeProfiles(),
  'brands.extensions': ({ id }) => readExtensions(getBrand(id).profileDir)
})

export function start(): void {
  L.adoptAll().catch((e) => console.warn('adopting brand Chromes failed', e))
}

/** Drop Playwright connections; brand Chromes keep running and are re-adopted next start. */
export async function stop(): Promise<void> {
  await L.detachAll()
}
