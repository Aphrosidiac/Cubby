import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { checkUploadPaths, checkUrl, cleanRef, describeField, isSecretField, isTypingKey, normPath, truncate } from './guards'

describe('checkUrl (navigation guard)', () => {
  it('normalises bare hosts and allows http(s)', () => {
    expect(checkUrl('instagram.com')).toEqual({ url: 'https://instagram.com/' })
    expect(checkUrl('localhost:5173/x')).toEqual({ url: 'http://localhost:5173/x' })
    expect(checkUrl('https://www.tiktok.com/upload')).toEqual({ url: 'https://www.tiktok.com/upload' })
    expect(checkUrl('about:blank')).toEqual({ url: 'about:blank' })
  })
  it('refuses non-web schemes (local files, chrome settings, scripts)', () => {
    for (const u of ['file:///C:/Users/me/secrets.txt', 'chrome://settings/passwords', 'javascript:alert(1)', 'data:text/html,hi', 'view-source:https://x.com'])
      expect('refused' in checkUrl(u), u).toBe(true)
  })
  it('refuses off-limits pages', () => {
    for (const u of ['https://www.instagram.com/accounts/password/change/', 'https://accountscenter.instagram.com/', 'https://www.facebook.com/settings', 'https://x.com/settings/password', 'https://myaccount.google.com/', 'https://www.tiktok.com/setting'])
      expect(checkUrl(u), u).toMatchObject({ refused: expect.stringMatching(/off-limits/) })
  })
})

describe('upload path allow-list', () => {
  const root = mkdtempSync(join(tmpdir(), 'cubby-up-'))
  const lib = join(root, 'library')
  const watch = join(root, 'watch')
  const outside = join(root, 'outside')
  for (const d of [lib, watch, outside]) mkdirSync(d, { recursive: true })
  const indexed = join(lib, 'reel.mp4')
  const watched = join(watch, 'sub', 'b.png')
  const secret = join(outside, 'id_rsa')
  mkdirSync(join(watch, 'sub'))
  for (const f of [indexed, watched, secret, join(lib, 'other.mp4')]) writeFileSync(f, 'x')
  const allow = { mediaPaths: new Set([normPath(indexed)]), folders: [normPath(watch)] }

  it('allows indexed media and files inside watch folders', () => {
    expect(checkUploadPaths([indexed, watched], allow)).toEqual({ ok: [indexed, watched], bad: [] })
  })
  it('refuses everything else, relative paths and traversal', () => {
    const r = checkUploadPaths([secret, join(lib, 'other.mp4'), 'reel.mp4', join(watch, '..', 'outside', 'id_rsa')], allow)
    expect(r.ok).toEqual([])
    expect(r.bad.length).toBe(4)
  })
  it('refuses a watch-folder path whose real target is elsewhere', () => {
    const link = join(watch, 'sneaky.png')
    try {
      symlinkSync(secret, link, 'file')
    } catch {
      return // symlinks need privileges on Windows; the realpath callback is tested below instead
    }
    expect(checkUploadPaths([link], allow, (p) => require('node:fs').realpathSync.native(p)).bad).toEqual([link])
  })
  it('uses the real path callback', () => {
    expect(checkUploadPaths([watched], allow, () => secret).bad).toEqual([watched])
  })
  it('is case-insensitive on Windows only', () => {
    const a = { mediaPaths: new Set([normPath('C:\\Media\\A.mp4', true)]), folders: [] }
    expect(checkUploadPaths(['C:\\media\\a.MP4'], a, (p) => p, true).ok.length).toBe(1)
  })
})

describe('secret field + key helpers', () => {
  it('detects password / otp fields', () => {
    expect(isSecretField({ tag: 'INPUT', type: 'password' })).toBe(true)
    expect(isSecretField({ tag: 'INPUT', type: 'text', autocomplete: 'one-time-code' })).toBe(true)
    expect(isSecretField({ tag: 'INPUT', type: 'tel', autocomplete: 'username current-password' })).toBe(true)
    expect(isSecretField({ tag: 'INPUT', type: 'text', name: 'otp' })).toBe(true)
    expect(isSecretField({ tag: 'INPUT', type: 'text', name: 'caption' })).toBe(false)
    expect(isSecretField({ tag: 'TEXTAREA' })).toBe(false)
    expect(isSecretField({ tag: 'DIV', type: 'password' })).toBe(false)
    expect(isSecretField(null)).toBe(false)
  })
  it('tells typing keys from navigation keys', () => {
    expect(isTypingKey('a')).toBe(true)
    expect(isTypingKey('Shift+A')).toBe(true)
    expect(isTypingKey('Digit4')).toBe(true)
    expect(isTypingKey('Control+V')).toBe(true)
    expect(isTypingKey('Enter')).toBe(false)
    expect(isTypingKey('Tab')).toBe(false)
    expect(isTypingKey('Control+A')).toBe(false)
  })
  it('cleans refs and truncates at a line boundary', () => {
    expect(cleanRef('[ref=e12]')).toBe('e12')
    expect(cleanRef('aria-ref=f1e3')).toBe('f1e3')
    const s = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    const t = truncate(s, 500, 'snapshot')
    expect(t.length).toBeLessThan(600)
    expect(t).toMatch(/snapshot truncated/)
  })
})

// Real Chrome: describeField runs inside the page; the snapshot refs resolve with getByRef.
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
describe.skipIf(!existsSync(CHROME))('in a real Chrome page', () => {
  let browser: Browser
  let page: Page
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROME, headless: true })
    page = await browser.newPage()
    await page.setContent(`<form>
      <label>User <input id="u" name="username" autocomplete="username"></label>
      <label>Pass <input id="p" type="password"></label>
      <label>Code <input id="c" inputmode="numeric" autocomplete="one-time-code"></label>
      <label>Caption <textarea id="cap"></textarea></label>
      <button type="button" onclick="document.title='clicked'">Share</button>
    </form>`)
  }, 30_000)
  afterAll(async () => {
    await browser?.close()
  })

  it('flags the password and one-time-code fields only', async () => {
    const field = (sel: string) => page.locator(sel).evaluate(describeField)
    expect(isSecretField(await field('#u'))).toBe(false)
    expect(isSecretField(await field('#p'))).toBe(true)
    expect(isSecretField(await field('#c'))).toBe(true)
    expect(isSecretField(await field('#cap'))).toBe(false)
  })

  it('AI snapshot refs resolve with getByRef', async () => {
    const snap = await page.ariaSnapshot({ mode: 'ai' })
    const m = /button "Share" \[ref=(e\d+)\]/.exec(snap)
    expect(m, snap).toBeTruthy()
    await page.getByRef(m![1]).click()
    expect(await page.title()).toBe('clicked')
  })
})
