// Recipe mechanics against LOCAL fixture pages in headless Google Chrome. Every request is routed:
// platform URLs are answered with fixtures that mimic the flow structure each recipe expects, and
// anything else is aborted — nothing ever reaches a real platform. This proves the shared mechanics
// and the recipes' own logic; it does NOT prove the selectors match the live sites.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Account, MediaAsset, Post } from '@shared/types'
import { closeDb, db, openDb } from '../../core/db'
import { GuardrailError } from '../../core/errors'
import { initPaths, paths } from '../../core/paths'
import { drain, setRunDeps, startRun, type RunContext } from '../runs/manager'
import { instagramPost, instagramStory } from './instagram'
import { assertHandle, identityMatches, normHandle, replaceText, uploadFiles, waitEnabled, waitForOutcome } from './kit'
import { tiktokVideo } from './tiktok'
import { xPost } from './x'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const FIX = join(__dirname, 'fixtures')
const fixture = (name: string, handle: string) => readFileSync(join(FIX, name), 'utf8').replaceAll('__HANDLE__', handle)

let dir = ''
let browser: Browser
let context: BrowserContext
let page: Page
let handle = 'ffdevstudio'
const notes: string[] = []
const blocked: string[] = []
let media: MediaAsset[] = []

function asset(id: string, file: string, kind: 'video' | 'image'): MediaAsset {
  const p = join(dir, file)
  writeFileSync(p, kind === 'video' ? Buffer.alloc(2048, 1) : Buffer.from('89504e470d0a1a0a', 'hex'))
  return { id, path: p, filename: file, kind, hash: '', durationMs: null, width: 1080, height: 1920, fps: null, codec: null, sizeBytes: 2048, thumb: null, tags: [], platformFit: {}, fitNotes: {}, addedAt: '', missing: false }
}

function post(kind: Post['kind'], assetIds: string[], caption: string, perPlatform: Post['perPlatform'] = {}): Post {
  return { id: 'post_1', brandId: 'br_1', accountIds: ['acc_1'], kind, assetIds, caption, perPlatform, scheduledAt: null, status: 'approved', approval: null, screens: [], results: [], error: null, createdAt: '', updatedAt: '' }
}

const account = (platform: Account['platform'], h: string): Account => ({
  id: 'acc_1', brandId: 'br_1', platform, handle: h, displayName: 'FF Dev Studio', profileUrl: '', ageTier: 'new', loginState: 'ok', cookieExpiresAt: null, lastCheckedAt: null, hasUsername: false, hasPassword: false, hasTotp: false, notes: '', createdAt: ''
})

const run = <T>(body: (rt: RunContext) => Promise<T>) => startRun({ brandId: 'br_1', actor: 'scheduler', label: 'test' }, body)

describe.skipIf(!existsSync(CHROME))('recipes on fixtures (headless Chrome, all network routed)', () => {
  beforeAll(async () => {
    delete process.env.CUBBY_DATA_DIR
    dir = mkdtempSync(join(tmpdir(), 'cubby-recipes-'))
    initPaths(dir)
    openDb(paths.db)
    db.run("INSERT INTO brands (id, serial, name, slug, created_at) VALUES ('br_1', 1, 'FF', 'ff', '2026-10-11')")
    media = [asset('m_vid', 'sunset-drive-final_v3.mp4', 'video'), asset('m_img1', 'b.jpg', 'image'), asset('m_img2', 'c.jpg', 'image')]
    browser = await chromium.launch({ executablePath: CHROME, headless: true })
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.route('**/*', async (route) => {
      const u = new URL(route.request().url())
      if (u.protocol === 'file:') return route.continue()
      const key = u.host + u.pathname
      const html = (body: string) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      if (key === 'www.instagram.com/') return html(fixture('instagram.html', handle))
      if (key === 'www.tiktok.com/tiktokstudio/upload') return html(fixture('tiktok.html', handle))
      if (key === 'www.tiktok.com/passport/web/account/info/') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { username: handle } }) })
      if (key === 'x.com/home') return html(fixture('x-home.html', handle))
      if (key === 'x.com/compose/post') return html(fixture('x-compose.html', handle))
      blocked.push(u.href)
      return route.abort()
    })
    page = await context.newPage()
    setRunDeps({ activePage: async () => page, frontBrand: async () => {}, notify: (n) => void notes.push(n.body) })
  }, 30_000)

  afterAll(async () => {
    await drain(2000)
    await browser?.close()
    closeDb()
    rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    handle = 'ffdevstudio'
    notes.length = 0
  })

  describe('kit', () => {
    it('normalises handles and matches identities', () => {
      expect(normHandle('@FF.Dev')).toBe('ff.dev')
      expect(normHandle('https://x.com/FFdev/')).toBe('ffdev')
      expect(normHandle('/ffdevstudio/')).toBe('ffdevstudio')
      expect(identityMatches('@FFDevStudio', { handle: 'ffdevstudio', displayName: '' })).toBe(true)
      expect(identityMatches('FF Dev Studio', { handle: 'ffdevstudio', displayName: '' })).toBe(false)
      expect(identityMatches('FF Dev Studio', { handle: 'ffdevstudio', displayName: '' }, true)).toBe(true)
      expect(identityMatches('in/fakhrul', { handle: 'fakhrul', displayName: '' })).toBe(true)
    })

    it('handle check: match, mismatch, unknown', async () => {
      const out = await run(async (rt) => {
        expect(assertHandle(rt, { handle: '@ffdev', displayName: '' }, ['FFDEV'], 'X')).toBe('FFDEV')
        expect(() => assertHandle(rt, { handle: 'ffdev', displayName: '' }, ['other'], 'X')).toThrow(/logged in as @other, but this post is for @ffdev/)
        try {
          assertHandle(rt, { handle: 'ffdev', displayName: '' }, [], 'X')
        } catch (e) {
          expect(e).toBeInstanceOf(GuardrailError)
          expect((e as GuardrailError).rule).toBe('handle_check')
          expect((e as Error).message).toMatch(/^X: no logged-in account is showing/)
        }
      })
      expect(out.run.status).toBe('ok')
    })

    it('uploads through a hidden input and through an intercepted file chooser; replaces prefilled text; waits for late buttons', async () => {
      const out = await run(async (rt) => {
        await page.goto('file:///' + join(FIX, 'kit.html').replace(/\\/g, '/'))
        await uploadFiles(rt, page, [media[1].path], { inputs: [page.locator('#hidden1')] })
        expect(await page.locator('#chosen').innerText()).toBe('input:1')
        await uploadFiles(rt, page, [media[1].path, media[2].path], { inputs: [page.locator('#nope')], triggers: [page.locator('#chooserBtn')], timeout: 2000 })
        expect(await page.locator('#chosen').innerText()).toBe('chooser:2')
        await replaceText(rt, page, page.locator('#ta'), 'new\ntext')
        expect(await page.locator('#ta').inputValue()).toBe('new\ntext')
        const got = await replaceText(rt, page, page.locator('#ce'), 'Line one #tag\nLine two', { closeSuggestions: true, mustNotContain: ['my-video-final_v3'] })
        expect(got.replace(/\s+/g, ' ').trim()).toBe('Line one #tag Line two')
        const btn = await waitEnabled(rt, [page.locator('#late')], 'Publish', 5000)
        await btn.click()
        expect(await waitForOutcome(rt, page, { what: 'kit', success: [/your post was published/i], timeout: 5000 })).toBe('text')
      })
      if (out.error) throw out.error
      expect(out.run.status).toBe('ok')
    })
  })

  describe('instagram', () => {
    const caption = 'Sunset over KL 🌇\nShot on the FF rig\n#kl #sunset'

    it('prepare: fills the composer, crop Original, never presses Escape, leaves it open with a screenshot', async () => {
      const out = await run((rt) => instagramPost(rt, { post: post('image', ['m_img1'], caption), account: account('instagram', '@FFDevStudio'), assets: media, mode: 'prepare' }, 'image'))
      if (out.error) throw out.error
      expect(out.run.status).toBe('ok')
      expect(out.result?.screen && existsSync(out.result.screen)).toBe(true)
      expect(out.result?.note).toMatch(/left open/)
      expect(await page.evaluate(() => (window as unknown as { __escapePressed: boolean }).__escapePressed)).toBe(false)
      expect(await page.evaluate(() => (window as unknown as { __crop: string }).__crop)).toBe('original')
      expect(await page.evaluate(() => (window as unknown as { __files: string[] }).__files)).toEqual(['b.jpg'])
      expect((await page.locator('#caption').innerText()).replace(/\s+/g, ' ').trim()).toBe(caption.replace(/\s+/g, ' '))
      expect(await page.locator('#share').isVisible()).toBe(true)
      expect(out.run.log.some((l) => /Logged in as ffdevstudio ✓/.test(l.msg))).toBe(true)
    }, 60_000)

    it('publish: clicks Share and waits for "Your post has been shared"', async () => {
      const out = await run((rt) => instagramPost(rt, { post: post('carousel', ['m_img1', 'm_img2'], caption), account: account('instagram', 'ffdevstudio'), assets: media, mode: 'publish' }, 'carousel'))
      if (out.error) throw out.error
      expect(out.run.status).toBe('ok')
      expect(out.result?.url).toBeNull()
      expect(await page.evaluate(() => (window as unknown as { __files: string[] }).__files)).toEqual(['b.jpg', 'c.jpg'])
      expect((await page.evaluate(() => (window as unknown as { __caption: string }).__caption)).replace(/\s+/g, ' ').trim()).toBe(caption.replace(/\s+/g, ' '))
    }, 60_000)

    it('a different logged-in account stops the run as needs_human (handle check), feed avatars are ignored', async () => {
      handle = 'someoneelse_brand'
      const out = await run((rt) => instagramPost(rt, { post: post('image', ['m_img1'], 'x'), account: account('instagram', 'ffdevstudio'), assets: media, mode: 'publish' }, 'image'))
      expect(out.run.status).toBe('needs_human')
      expect((out.error as GuardrailError).rule).toBe('handle_check')
      expect(out.run.error).toMatch(/logged in as @someoneelse_brand, but this post is for @ffdevstudio/)
      expect(notes[0]).toMatch(/^FF: Instagram is logged in as/)
    }, 60_000)

    it('stories stop as needs_human (unsupported on desktop web)', async () => {
      const out = await run((rt) => instagramStory(rt, { post: post('story', ['m_vid'], ''), account: account('instagram', 'ffdevstudio'), assets: media, mode: 'publish' }))
      expect(out.run.status).toBe('needs_human')
      expect((out.error as GuardrailError).rule).toBe('unsupported')
    })

    it('refuses to run without a post', async () => {
      const out = await run((rt) => instagramPost(rt, {}, 'image'))
      expect(out.run.status).toBe('failed')
      expect(out.run.error).toMatch(/needs a post/)
    })
  })

  describe('tiktok', () => {
    it('replaces the file-name description, survives hashtag suggestions, sets privacy, waits for upload, posts', async () => {
      const caption = 'Night drive 🌙 #kl\nFull video on the profile\n#ffdev'
      const out = await run((rt) =>
        tiktokVideo(rt, { post: post('video', ['m_vid'], caption, { tiktok: { tiktokPrivacy: 'private', allowComments: false } }), account: account('tiktok', '@ffdevstudio'), assets: media, mode: 'publish' })
      )
      if (out.error) throw out.error
      expect(out.run.status).toBe('ok')
      const w = await page.evaluate(() => {
        const x = window as unknown as { __desc: string; __vis: string; __comment: boolean; __suggestionAteEnter: boolean }
        return { __desc: x.__desc, __vis: x.__vis, __comment: x.__comment, __suggestionAteEnter: x.__suggestionAteEnter }
      })
      expect(w.__desc).not.toContain('sunset-drive-final_v3')
      expect(w.__desc.split('\n').map((l) => l.trim())).toEqual(caption.split('\n'))
      expect(w.__suggestionAteEnter).toBe(false)
      expect(w.__vis).toBe('Only you')
      expect(w.__comment).toBe(false)
      expect(out.run.log.some((l) => /Logged in as ffdevstudio ✓/.test(l.msg))).toBe(true) // from the account-info endpoint
    }, 60_000)
  })

  describe('x', () => {
    it('attaches images, waits for processing, posts and returns the status link', async () => {
      const out = await run((rt) => xPost(rt, { post: post('carousel', ['m_img1', 'm_img2'], 'Two shots from today'), account: account('x', 'ffdevstudio'), assets: media, mode: 'publish' }, 'carousel'))
      if (out.error) throw out.error
      expect(out.result?.url).toBe('https://x.com/ffdevstudio/status/1234567890')
      expect(await page.evaluate(() => (window as unknown as { __att: string }).__att)).toBe('b.jpg,c.jpg')
      expect(await page.evaluate(() => (window as unknown as { __text: string }).__text)).toBe('Two shots from today')
    }, 60_000)
  })

  it('no request ever left for a real site', () => {
    // only the routed fixture URLs were served; anything else was aborted (none expected)
    expect(blocked.filter((u) => !u.startsWith('data:'))).toEqual([])
  })
})
