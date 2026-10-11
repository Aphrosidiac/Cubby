// Drives REAL Google Chrome through the launcher: two brands on temp profiles, CDP endpoints,
// Preferences, close, adopt after dropping the Playwright connection, the "already open without
// debugging" case, window tools, and a profile import that carries a cookie across.
// Skipped when Chrome is not installed. Never touches the person's own Chrome profile.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, db, j, openDb } from '../../core/db'
import { initPaths } from '../../core/paths'
import { getBrand } from '../brands/repo'
import { findChrome } from './chrome'
import { probeVersion, readDevToolsActivePort } from './devtools'
import { importChromeProfile } from './importProfile'
import * as L from './launcher'

const chrome = findChrome()
const root = join(process.env.TEMP ?? tmpdir(), 'cubby-b-browser', `vitest-${Date.now()}`)

function addBrand(id: string, name: string, color: string, win = { width: 700, height: 500 }): void {
  const serial = (db.get<{ m: number | null }>('SELECT max(serial) m FROM brands')?.m ?? 0) + 1
  db.run('INSERT INTO brands (id, serial, name, slug, color, window, startup_urls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, serial, name, id, color, j(win), j(['about:blank']), new Date().toISOString())
}

describe('pure launcher helpers', () => {
  it('only passes URLs to Chrome, never switches', () => {
    expect(L.safeUrls(['https://a.com', 'b.com', '--disable-web-security', ' about:blank ', 'javascript:alert(1)', ''])).toEqual(['https://a.com', 'https://b.com', 'about:blank'])
    const args = L.chromeArgs('C:\\p', { width: 800, height: 600, x: 10, y: 20 }, ['x.com'])
    expect(args).toContain('--remote-debugging-port=0')
    expect(args).toContain('--user-data-dir=C:\\p')
    expect(args).toContain('--window-position=10,20')
    expect(args).toContain('--disable-background-timer-throttling')
    expect(args[args.length - 1]).toBe('https://x.com')
  })

  it('quotes Windows command-line arguments', () => {
    expect(L.winQuote('--no-first-run')).toBe('--no-first-run')
    expect(L.winQuote('--user-data-dir=C:\\Users\\John Smith\\Cubby\\profiles\\ff')).toBe('"--user-data-dir=C:\\Users\\John Smith\\Cubby\\profiles\\ff"')
    expect(L.winQuote('C:\\a b\\')).toBe('"C:\\a b\\\\"')
    expect(L.winQuote('say "hi"')).toBe('"say \\"hi\\""')
    expect(L.winQuote('')).toBe('""')
  })

  it('tiles a grid over the work area and cascades in 32 px steps', () => {
    const wa = { x: 0, y: 40, width: 1920, height: 1000 }
    expect(L.layoutWindows('tile', [1, 2, 3].map(() => ({ width: 1280, height: 900 })), wa)).toEqual([
      { left: 0, top: 40, width: 960, height: 500 },
      { left: 960, top: 40, width: 960, height: 500 },
      { left: 0, top: 540, width: 960, height: 500 }
    ])
    const c = L.layoutWindows('cascade', [{ width: 1280, height: 900 }, { width: 1280, height: 900 }], wa)
    expect(c[1]).toEqual({ left: 32, top: 72, width: 1280, height: 900 })
    expect(L.layoutWindows('tile', [], wa)).toEqual([])
  })
})

describe.skipIf(!chrome)('launcher with real Chrome', () => {
  beforeAll(() => {
    delete process.env.CUBBY_DATA_DIR
    mkdirSync(root, { recursive: true })
    initPaths(root)
    openDb(join(root, 'app.sqlite'))
    addBrand('br_a', 'Alpha', '#2c4f9c')
    addBrand('br_b', 'Bravo', '#a3261d')
  })

  afterAll(async () => {
    await L.closeAllBrands().catch(() => {})
    closeDb()
    // Chrome may hold files for a moment after exit
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(root, { recursive: true, force: true })
        break
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  })

  it('opens two brands with their own CDP endpoints and Preferences', async () => {
    const t0 = Date.now()
    const [a, b] = await Promise.all([L.openBrand('br_a', { urls: ['about:blank'] }), L.openBrand('br_b')])
    console.log(`two brands up in ${Date.now() - t0} ms`, a.cdpUrl, b.cdpUrl)
    expect(a.cdpUrl).not.toBe(b.cdpUrl)
    expect(a.wsEndpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//)
    for (const r of [a, b]) {
      expect(await probeVersion(Number(new URL(r.cdpUrl).port))).not.toBeNull()
    }
    const A = getBrand('br_a')
    expect(A.status).toBe('open')
    expect(A.cdpPort).toBe(Number(new URL(a.cdpUrl).port))
    expect(A.pid).toBeGreaterThan(0)
    expect(L.pidAlive(A.pid)).toBe(true)
    expect(L.isBrandOpen('br_a')).toBe(true)
    const prefs = JSON.parse(readFileSync(join(A.profileDir, 'Default', 'Preferences'), 'utf8'))
    expect(prefs.profile.name).toBe('Alpha')
    expect(prefs.browser.theme.user_color2).toBe(0xff2c4f9c | 0)
    expect(JSON.parse(readFileSync(join(A.profileDir, 'Local State'), 'utf8')).profile.info_cache.Default.name).toBe('Alpha')
    // concurrent open of an open brand reuses it
    expect((await L.openBrand('br_a', { background: true })).cdpUrl).toBe(a.cdpUrl)
  }, 60_000)

  it('tracks the active page and moves windows over CDP', async () => {
    const p1 = await L.activePage('br_a')
    const p2 = await L.openUrl('br_a', 'about:blank#second')
    // a new tab does not steal the active page
    expect(await L.activePage('br_a')).toBe(p1)
    L.setActivePage('br_a', p2)
    expect(await L.activePage('br_a')).toBe(p2)
    await p2.close()
    expect(await L.activePage('br_a')).not.toBe(p2)

    await L.setWindowBounds('br_a', { x: 50, y: 60, width: 640, height: 480 })
    const wb = await L.getWindowBounds('br_a')
    expect(wb).toMatchObject({ left: 50, top: 60, width: 640, height: 480, windowState: 'normal' })
    const n = await L.arrangeIn('tile', { x: 0, y: 0, width: 1400, height: 800 })
    expect(n).toBe(2)
    expect(await L.getWindowBounds('br_b')).toMatchObject({ left: 700, top: 0, width: 700, height: 800 })
    await L.frontBrand('br_b')
    expect((await L.getWindowBounds('br_b')).windowState).toBe('normal')
  }, 60_000)

  it('closes one brand and kills nothing else', async () => {
    const pid = getBrand('br_a').pid
    const port = getBrand('br_a').cdpPort!
    await L.closeBrand('br_a')
    expect(getBrand('br_a').status).toBe('closed')
    expect(getBrand('br_a').cdpPort).toBeNull()
    expect(L.pidAlive(pid)).toBe(false)
    expect(await probeVersion(port)).toBeNull()
    expect(L.isBrandOpen('br_b')).toBe(true)
    // Chrome rewrote Preferences on exit and kept what we set
    const prefs = JSON.parse(readFileSync(join(getBrand('br_a').profileDir, 'Default', 'Preferences'), 'utf8'))
    expect(prefs.profile.name).toBe('Alpha')
    expect(prefs.browser.theme.user_color2).toBe(0xff2c4f9c | 0)
    expect(prefs.session.restore_on_startup).toBe(1)
    expect(prefs.credentials_enable_service).toBe(false)
  }, 30_000)

  it('adopts a brand Chrome after the Playwright connection is dropped', async () => {
    const pid = getBrand('br_b').pid
    await L.detachAll()
    expect(L.isBrandOpen('br_b')).toBe(false)
    expect(L.pidAlive(pid)).toBe(true)
    const dt = readDevToolsActivePort(getBrand('br_b').profileDir)!
    expect(await probeVersion(dt.port)).not.toBeNull()
    // status stays open while the app is away
    expect(getBrand('br_b').status).toBe('open')
    db.run("UPDATE brands SET status = 'closed', pid = NULL WHERE id = 'br_b'")
    await L.adoptAll()
    expect(L.isBrandOpen('br_b')).toBe(true)
    expect(getBrand('br_b').status).toBe('open')
    expect(getBrand('br_b').pid).toBe(pid)
    await L.closeBrand('br_b')
    expect(getBrand('br_b').status).toBe('closed')
    expect(L.pidAlive(pid)).toBe(false)
  }, 60_000)

  it('refuses to open a profile a non-debugging Chrome already owns', async () => {
    addBrand('br_c', 'Charlie', '#1d6b45')
    const dir = getBrand('br_c').profileDir
    mkdirSync(dir, { recursive: true })
    const own = spawn(chrome!.path, [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--window-size=500,400', 'about:blank'], { detached: true, stdio: 'ignore' })
    own.unref()
    for (let i = 0; i < 50 && !existsSync(join(dir, 'lockfile')) && !existsSync(join(dir, 'SingletonLock')); i++) await new Promise((r) => setTimeout(r, 200))
    try {
      await expect(L.openBrand('br_c')).rejects.toThrow(/already open in a Chrome window/)
      expect(getBrand('br_c').status).toBe('error')
    } finally {
      if (own.pid) process.kill(own.pid)
      for (let i = 0; i < 30 && L.pidAlive(own.pid); i++) await new Promise((r) => setTimeout(r, 200))
    }
  }, 30_000)

  it('imports a (synthetic) Chrome profile with its cookies', async () => {
    addBrand('br_src', 'Source', '#475569')
    addBrand('br_dst', 'Imported', '#0f766e')
    await L.openBrand('br_src', { background: true })
    expect(L.isBackground('br_src')).toBe(true)
    const ctx = await L.getContext('br_src')
    const expires = Math.floor(Date.now() / 1000) + 30 * 86400
    await ctx.addCookies([{ name: 'cubby_import', value: 'carried-over', domain: '.example.com', path: '/', expires, httpOnly: true, secure: true, sameSite: 'Lax' }])
    await L.closeBrand('br_src')
    await importChromeProfile(join(getBrand('br_src').profileDir, 'Default'), getBrand('br_dst').profileDir)
    const ls = JSON.parse(readFileSync(join(getBrand('br_dst').profileDir, 'Local State'), 'utf8'))
    expect(ls.os_crypt).toBeTruthy()
    // a second import into a brand that already has data is refused
    await expect(importChromeProfile(join(getBrand('br_src').profileDir, 'Default'), getBrand('br_dst').profileDir)).rejects.toThrow(/already has its own browser data/)
    await L.openBrand('br_dst', { background: true })
    const got = (await (await L.getContext('br_dst')).cookies('https://example.com')).find((c) => c.name === 'cubby_import')
    expect(got?.value).toBe('carried-over')
    expect(Math.abs((got?.expires ?? 0) - expires)).toBeLessThan(2)
    await L.closeBrand('br_dst')
  }, 90_000)
})
