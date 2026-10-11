// Instagram (desktop web) — reel / image / carousel through the "Create → Post" composer; stories are
// not offered by instagram.com on desktop, so that recipe stops for a person.
// Traps: never press Escape inside the composer (it opens "Discard post?"); pick crop "Original";
// video posts show a "now shared as reels" notice. NOT verified against the live site — selectors
// follow the 2025–26 web UI (English) and fail loudly when it differs.
import type { Page } from 'playwright-core'
import type { PostKind } from '@shared/types'
import { GuardrailError } from '../../core/errors'
import type { RunContext } from '../runs/manager'
import { assertHandle, captionFor, clickFirst, finishPrepare, firstVisible, maybeClick, maybeVisible, mediaFiles, openPage, postingParams, readAll, replaceText, uploadFiles, waitForOutcome, type RecipeResult } from './kit'

const HOME = 'https://www.instagram.com/'

/** The logged-in account from the left rail's "Profile" item (never feed avatars). */
export async function igIdentity(page: Page): Promise<string[]> {
  return readAll(page, () => {
    const out: string[] = []
    const fromHref = (a: Element) => {
      const m = (a.getAttribute('href') || '').match(/^(?:https:\/\/www\.instagram\.com)?\/([A-Za-z0-9._]{1,30})\/?$/)
      if (m && !/^(explore|reels|direct|accounts|p|reel|stories)$/i.test(m[1])) out.push(m[1])
    }
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const text = ((a as HTMLElement).innerText || '').trim()
      const img = a.querySelector('img[alt]')
      const alt = img?.getAttribute('alt') || ''
      const left = (a as HTMLElement).getBoundingClientRect().left
      const isProfileItem = /^profile$/i.test(text) || (left < 260 && /'s profile picture$/i.test(alt))
      if (!isProfileItem) continue
      fromHref(a)
      const m = alt.match(/^(.+?)'s profile picture$/i)
      if (m) out.push(m[1])
    }
    return out
  })
}

/** Inside the composer the header shows only the posting account. */
async function igComposerIdentity(page: Page): Promise<string[]> {
  return readAll(page, () => {
    const out: string[] = []
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    const d = dialogs[dialogs.length - 1]
    if (!d) return out
    for (const img of Array.from(d.querySelectorAll('img[alt]'))) {
      const m = (img.getAttribute('alt') || '').match(/^(.+?)'s profile picture$/i)
      if (m) out.push(m[1])
    }
    return out
  })
}

const captionField = (page: Page) => [
  page.getByRole('textbox', { name: /write a caption/i }),
  page.locator('[aria-label^="Write a caption"]'),
  page.locator('[role="dialog"] [contenteditable="true"]'),
  page.locator('[role="dialog"] textarea')
]

const nextButton = (page: Page) => [page.getByRole('dialog').getByRole('button', { name: /^Next$/ }), page.getByRole('button', { name: /^Next$/ }), page.locator('[role="dialog"] div[role="button"]:text-is("Next")')]

export async function instagramPost(rt: RunContext, params: Record<string, unknown>, kind: PostKind): Promise<RecipeResult> {
  const p = postingParams(params)
  const files = mediaFiles(p, kind === 'carousel' ? { min: 2, max: 20, what: 'An Instagram carousel' } : kind === 'reel' ? { max: 1, kind: 'video', what: 'An Instagram reel' } : { max: 1, kind: 'image', what: 'An Instagram post' })
  const caption = captionFor(p, 'instagram')

  const page = await rt.step('Open Instagram', () => openPage(rt, HOME))
  await rt.step('Check the logged-in account', async () => {
    assertHandle(rt, p.account, await igIdentity(page), 'Instagram')
  })

  await rt.step('Open the composer', async () => {
    await clickFirst(
      rt,
      [page.getByRole('link', { name: /^(New post|Create)$/ }), page.getByRole('button', { name: /^(New post|Create)$/ }), page.locator('a:has(svg[aria-label="New post"])'), page.locator('svg[aria-label="New post"]')],
      'the Create button'
    )
    // newer UI: "Create" opens a small menu (Post / Live video / Ad)
    await maybeClick(rt, [page.getByRole('link', { name: /^Post$/ }), page.getByRole('menuitem', { name: /^Post$/ }), page.locator('a:has(svg[aria-label="Post"])')], 2500)
    await firstVisible(rt, [page.getByRole('dialog').filter({ hasText: /Create new post|Drag photos and videos here|Select from computer/i })], 'the "Create new post" dialog')
  })

  await rt.step('Upload media', async () => {
    const dialog = page.getByRole('dialog').last()
    await uploadFiles(rt, page, files, {
      inputs: [dialog.locator('input[type="file"]'), page.locator('form[enctype="multipart/form-data"] input[type="file"]'), page.locator('input[type="file"][accept*="image"], input[type="file"][accept*="video"]')],
      triggers: [page.getByRole('button', { name: /select from computer/i })]
    })
    // "Video posts are now shared as reels" notice
    await maybeClick(rt, [page.getByRole('dialog').getByRole('button', { name: /^OK$/ })], 5000)
    await firstVisible(rt, nextButton(page), 'the crop step (Next)', 3 * 60_000)
    await rt.checkpoint()
  })

  await rt.step('Crop: Original', async () => {
    const opened = await maybeClick(rt, [page.getByRole('button', { name: /select crop/i }), page.locator('[role="button"]:has(svg[aria-label="Select crop"])'), page.locator('svg[aria-label="Select crop"]')], 4000)
    if (!opened) {
      rt.log('No crop selector on this step (Instagram skips it for some reels)')
      return
    }
    const picked = await maybeClick(rt, [page.getByRole('button', { name: /^Original/ }), page.locator('[role="button"]:has-text("Original")'), page.getByText('Original', { exact: true })], 3000)
    if (!picked) rt.log('Could not find the "Original" crop option — Instagram may crop the media', 'warn')
    else rt.log('Crop set to Original')
  })

  await rt.step('Go to the caption step', async () => {
    for (let i = 0; i < 4; i++) {
      if (await maybeVisible(rt, captionField(page), 1500)) return
      await clickFirst(rt, nextButton(page), 'the Next button')
      await rt.sleep(1200)
    }
    await firstVisible(rt, captionField(page), 'the caption field', 15_000)
  })

  await rt.step('Write the caption', async () => {
    if (!caption) return rt.log('No caption')
    const field = await firstVisible(rt, captionField(page), 'the caption field')
    await replaceText(rt, page, field, caption)
  })

  const opts = p.post.perPlatform?.instagram
  if (opts?.firstComment) rt.log('First comment is not automated on Instagram yet — add it after posting', 'warn')

  await rt.step('Check the account in the composer', async () => {
    const found = await igComposerIdentity(page)
    if (found.length) assertHandle(rt, p.account, found, 'Instagram')
    else rt.log('The composer does not show the account name; relying on the earlier check')
    await rt.checkpoint()
  })

  if (p.mode !== 'publish') return finishPrepare(rt, 'Instagram')

  return rt.step('Share', async () => {
    await clickFirst(rt, [page.getByRole('dialog').getByRole('button', { name: /^Share$/ }), page.getByRole('button', { name: /^Share$/ }), page.locator('[role="dialog"] div[role="button"]:text-is("Share")')], 'the Share button')
    await waitForOutcome(rt, page, {
      what: 'Instagram',
      success: [/your (post|reel) (has been|was) shared/i, /(post|reel) shared/i],
      failure: [/(post|reel) couldn['’]t be shared[^\n]*/i, /something went wrong[^\n]*/i],
      timeout: 10 * 60_000
    })
    rt.log('Instagram says it was shared')
    return { url: null, note: 'Instagram does not show the post link after sharing — it is on the profile.' }
  })
}

export async function instagramStory(rt: RunContext, params: Record<string, unknown>): Promise<RecipeResult> {
  postingParams(params)
  throw new GuardrailError('Instagram does not offer story posting on desktop web — post this story from the phone, then mark it done', 'unsupported')
}
