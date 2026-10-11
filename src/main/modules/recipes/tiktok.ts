// TikTok (desktop web, TikTok Studio uploader at /tiktokstudio/upload) — video, and photo posts when the
// web uploader accepts images. Traps: the description is pre-filled with the file name (select-all +
// replace, then verify the file name is gone); typing #tags opens a suggestion list that eats Enter.
// NOT verified against the live site.
import type { Page } from 'playwright-core'
import type { RunContext } from '../runs/manager'
import { assertHandle, captionFor, clickFirst, finishPrepare, firstVisible, maybeClick, maybeVisible, mediaFiles, openPage, postingParams, readAll, replaceText, uploadFiles, waitEnabled, waitForOutcome, type RecipeResult } from './kit'

const UPLOAD = 'https://www.tiktok.com/tiktokstudio/upload'

/** Profile links in TikTok's own chrome, then the web account-info endpoint the site itself uses. */
export async function ttIdentity(page: Page): Promise<string[]> {
  const dom = await readAll(page, () => {
    const out: string[] = []
    for (const a of Array.from(document.querySelectorAll('a[href*="/@"]'))) {
      const e2e = (a.getAttribute('data-e2e') || '') + ' ' + (a.closest('[data-e2e]')?.getAttribute('data-e2e') || '')
      const inChrome = /profile|nav|header|avatar/i.test(e2e) || !!a.closest('header, nav, [class*="Header"], [class*="SideNav"]')
      if (!inChrome) continue
      const m = (a.getAttribute('href') || '').match(/\/@([A-Za-z0-9._]+)/)
      if (m) out.push(m[1])
    }
    return out
  })
  if (dom.length) return dom
  const api = await page
    .evaluate(async () => {
      try {
        const r = await fetch('https://www.tiktok.com/passport/web/account/info/?aid=1459', { credentials: 'include' })
        const j = (await r.json()) as { data?: { username?: string; unique_id?: string } }
        return [j?.data?.username, j?.data?.unique_id].filter((x): x is string => !!x)
      } catch {
        return [] as string[]
      }
    })
    .catch(() => [] as string[])
  return api
}

const descField = (page: Page) => [
  page.locator('.public-DraftEditor-content[contenteditable="true"]'),
  page.locator('[data-e2e="caption"] [contenteditable="true"]'),
  page.getByRole('combobox').and(page.locator('[contenteditable="true"]')),
  page.locator('[contenteditable="true"]')
]

const postButton = (page: Page) => [page.locator('button[data-e2e="post_video_button"]'), page.getByRole('button', { name: /^Post$/ })]

const PRIVACY: Record<string, RegExp> = { public: /^Everyone$/i, friends: /^Friends$/i, private: /^Only you$/i }

async function setOptions(rt: RunContext, page: Page, o: { tiktokPrivacy?: string; allowComments?: boolean; allowDuet?: boolean; allowStitch?: boolean } | undefined): Promise<void> {
  if (!o) return
  if (o.tiktokPrivacy) {
    const opened = await maybeClick(rt, [page.locator('[data-e2e="video_visibility_container"] [role="combobox"]'), page.getByRole('combobox').filter({ hasText: /everyone|friends|only you/i })], 3000)
    const picked = opened && (await maybeClick(rt, [page.getByRole('option', { name: PRIVACY[o.tiktokPrivacy] }), page.getByText(PRIVACY[o.tiktokPrivacy])], 3000))
    rt.log(picked ? `Who can watch: ${o.tiktokPrivacy}` : 'Could not set "Who can watch" — check it in the window', picked ? 'info' : 'warn')
  }
  const toggles: [boolean | undefined, RegExp][] = [[o.allowComments, /^comment$/i], [o.allowDuet, /^duet$/i], [o.allowStitch, /^stitch$/i]]
  for (const [want, label] of toggles) {
    if (want === undefined) continue
    const box = await maybeVisible(rt, [page.getByRole('checkbox', { name: label }), page.getByLabel(label)], 1500)
    if (!box) {
      rt.log(`Could not find the "${label.source.replace(/[\^$]/g, '')}" setting — check it in the window`, 'warn')
      continue
    }
    if ((await box.isChecked().catch(() => want)) !== want) await rt.race(box.click())
  }
}

async function ttPost(rt: RunContext, params: Record<string, unknown>, photos: boolean): Promise<RecipeResult> {
  const p = postingParams(params)
  const files = photos ? mediaFiles(p, { min: 1, max: 35, kind: 'image', what: 'A TikTok photo post' }) : mediaFiles(p, { max: 1, kind: 'video', what: 'A TikTok video' })
  const caption = captionFor(p, 'tiktok')
  const filenames = p.assets.map((a) => a.filename.replace(/\.[a-z0-9]+$/i, ''))

  const page = await rt.step('Open the TikTok Studio uploader', () => openPage(rt, UPLOAD))
  await rt.step('Check the logged-in account', async () => assertHandle(rt, p.account, await ttIdentity(page), 'TikTok'))

  await rt.step(photos ? 'Upload the photos' : 'Upload the video', async () => {
    await uploadFiles(rt, page, files, {
      inputs: photos ? [page.locator('input[type="file"][accept*="image"]'), page.locator('input[type="file"]')] : [page.locator('input[type="file"][accept*="video"]'), page.locator('input[type="file"]')],
      triggers: [page.getByRole('button', { name: /select (video|file|photos?)/i })],
      timeout: 30_000
    })
    await firstVisible(rt, descField(page), 'the description editor', 5 * 60_000)
    await rt.checkpoint()
  })

  await rt.step('Write the description', async () => {
    const field = await firstVisible(rt, descField(page), 'the description editor')
    // TikTok pre-fills the file name; replace everything and make sure it is gone
    await replaceText(rt, page, field, caption, { closeSuggestions: true, mustNotContain: filenames })
  })

  await rt.step('Post settings', () => setOptions(rt, page, p.post.perPlatform?.tiktok))

  await rt.step('Wait for the upload to finish', async () => {
    await waitEnabled(rt, postButton(page), 'The Post button', 20 * 60_000)
  })

  await rt.checkpoint()
  if (p.mode !== 'publish') return finishPrepare(rt, 'TikTok')

  return rt.step('Post', async () => {
    await clickFirst(rt, postButton(page), 'the Post button')
    // "Continue to post?" (content check still running) → Post now
    await maybeClick(rt, [page.getByRole('button', { name: /^Post now$/i })], 4000)
    await waitForOutcome(rt, page, {
      what: 'TikTok',
      success: [/your (video|post) (has been|is being) (uploaded|posted|published)/i, /(video|post) (posted|published)/i],
      successUrl: /tiktokstudio\/content/i,
      failure: [/(couldn['’]t|could not|failed to) (post|upload|publish)[^\n]*/i],
      timeout: 15 * 60_000
    })
    return { url: null, note: 'TikTok confirmed the post; the link appears on the profile once processing ends.' }
  })
}

export const tiktokVideo = (rt: RunContext, params: Record<string, unknown>) => ttPost(rt, params, false)
export const tiktokPhotos = (rt: RunContext, params: Record<string, unknown>) => ttPost(rt, params, true)
