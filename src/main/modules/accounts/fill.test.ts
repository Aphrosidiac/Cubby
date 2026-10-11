// Fill login against LOCAL pages that mimic each platform's form (never a real platform).
// Real Chrome (headless) via playwright-core; skipped when Chrome is not installed.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findChrome } from '../browser/chrome'
import { fillLoginOnPage, isOnLoginPage, loginUrlFor } from './fill'

const PAGES: Record<string, string> = {
  ig: `<form onsubmit="window.submitted=true;return false"><input name="username"><input name="password" type="password"><button type="submit">Log in</button></form>`,
  fb: `<form onsubmit="window.submitted=true;return false"><input id="email"><input id="pass" type="password"><button>Log in</button></form>`,
  x: `<div><input autocomplete="username" name="text"><button id="n" onclick="document.getElementById('s2').style.display='block'">Next</button></div>
      <div id="s2" style="display:none"><input name="password" type="password"><button onclick="window.submitted=true">Log in</button></div>`,
  google: `<input type="email" id="identifierId"><div id="identifierNext"><button onclick="setTimeout(()=>{document.getElementById('pw').style.display='block'},300)">Next</button></div>
      <div id="pw" style="display:none"><input type="password" name="Passwd"></div>`,
  generic: `<form onsubmit="window.submitted=true;return false"><input type="hidden" name="csrf"><input type="email" style="display:none"><input type="text" name="login"><input type="password"></form>`,
  none: `<p>nothing here</p>`
}

const chrome = findChrome()
let server: Server
let base = ''
let browser: Browser

describe('login page detection', () => {
  it('knows the platform login pages', () => {
    expect(isOnLoginPage('https://www.instagram.com/accounts/login/?next=/', 'instagram')).toBe(true)
    expect(isOnLoginPage('https://www.instagram.com/ffdev/', 'instagram')).toBe(false)
    expect(isOnLoginPage('https://www.facebook.com/login/', 'facebook')).toBe(true)
    expect(isOnLoginPage('https://x.com/i/flow/login', 'x')).toBe(true)
    expect(isOnLoginPage('https://accounts.google.com/v3/signin/identifier', 'youtube')).toBe(true)
    expect(isOnLoginPage('https://evil.com/accounts/login', 'instagram')).toBe(false)
    expect(loginUrlFor('tiktok')).toBe('https://www.tiktok.com/login/phone-or-email/email')
    expect(loginUrlFor('linkedin')).toBe('https://www.linkedin.com/login')
  })
})

describe.skipIf(!chrome)('fillLoginOnPage on local pages', () => {
  beforeAll(async () => {
    server = createServer((req, res) => {
      const key = (req.url ?? '/').slice(1)
      res.writeHead(PAGES[key] ? 200 : 404, { 'content-type': 'text/html' })
      res.end(`<!doctype html><html><body>${PAGES[key] ?? 'not found'}</body></html>`)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    browser = await chromium.launch({ executablePath: chrome!.path, headless: true })
  })
  afterAll(async () => {
    await browser?.close()
    server?.close()
  })

  const fast = { delayMs: [1, 5] as [number, number], timeoutMs: 3000 }
  const value = (page: import('playwright-core').Page, sel: string) => page.locator(sel).inputValue()

  it('Instagram-style form: fills both fields and does not submit', async () => {
    const page = await browser.newPage()
    await fillLoginOnPage(page, 'instagram', { username: 'ff.dev', password: 'p@ss w0rd!' }, { ...fast, loginUrl: `${base}/ig` })
    expect(await value(page, 'input[name=username]')).toBe('ff.dev')
    expect(await value(page, 'input[name=password]')).toBe('p@ss w0rd!')
    expect(await page.evaluate(() => (window as unknown as { submitted?: boolean }).submitted ?? false)).toBe(false)
    await page.close()
  })

  it('Facebook-style ids', async () => {
    const page = await browser.newPage()
    await fillLoginOnPage(page, 'facebook', { username: 'me@ff.dev', password: 'secret' }, { ...fast, loginUrl: `${base}/fb` })
    expect(await value(page, '#email')).toBe('me@ff.dev')
    expect(await value(page, '#pass')).toBe('secret')
    expect(await page.evaluate(() => (window as unknown as { submitted?: boolean }).submitted ?? false)).toBe(false)
    await page.close()
  })

  it('X multi-step: username → Next → password, never Log in', async () => {
    const page = await browser.newPage()
    await fillLoginOnPage(page, 'x', { username: 'ffdev', password: 'pw' }, { ...fast, loginUrl: `${base}/x` })
    expect(await value(page, 'input[autocomplete=username]')).toBe('ffdev')
    expect(await value(page, 'input[name=password]')).toBe('pw')
    expect(await page.evaluate(() => (window as unknown as { submitted?: boolean }).submitted ?? false)).toBe(false)
    await page.close()
  })

  it('Google (YouTube) two-step with a delayed password field', async () => {
    const page = await browser.newPage()
    await fillLoginOnPage(page, 'youtube', { username: 'me@gmail.com', password: 'pw2' }, { ...fast, loginUrl: `${base}/google` })
    expect(await value(page, 'input[type=email]')).toBe('me@gmail.com')
    expect(await value(page, 'input[name=Passwd]')).toBe('pw2')
    await page.close()
  })

  it('generic form: first visible text input + password', async () => {
    const page = await browser.newPage()
    await fillLoginOnPage(page, 'threads', { username: 'u1', password: 'p1' }, { ...fast, loginUrl: `${base}/generic` })
    expect(await value(page, 'input[name=login]')).toBe('u1')
    expect(await value(page, 'input[type=password]')).toBe('p1')
    await page.close()
  })

  it('clear error when the form is not there, and when nothing is saved', async () => {
    const page = await browser.newPage()
    await expect(fillLoginOnPage(page, 'linkedin', { username: 'a', password: 'b' }, { ...fast, timeoutMs: 800, loginUrl: `${base}/none` })).rejects.toThrow(/Couldn't find the login form on LinkedIn/)
    await expect(fillLoginOnPage(page, 'linkedin', { username: null, password: null }, fast)).rejects.toThrow(/No saved login/)
    await page.close()
  })
})
