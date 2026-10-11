// Facebook (desktop web) — reels via facebook.com/reels/create, posts (text / image / video / album)
// via the "What's on your mind?" composer. Facebook acts as whichever profile or Page the person has
// switched into, so the handle check opens facebook.com/me (redirects to the acting profile) and
// compares its username / name with the account's handle or display name.
// Cover frame: Facebook picks one automatically; choosing a frame by time is not automated.
// NOT verified against the live site.
import type { Page } from 'playwright-core'
import type { PostKind } from '@shared/types'
import type { RunContext } from '../runs/manager'
import { assertHandle, captionFor, clickFirst, finishPrepare, firstVisible, maybeClick, maybeVisible, mediaFiles, openPage, postingParams, readAll, replaceText, uploadFiles, waitEnabled, waitForOutcome, type RecipeResult } from './kit'

/** Username from facebook.com/me's redirect + the profile's name heading. */
export async function fbIdentity(rt: RunContext): Promise<string[]> {
  const page = await openPage(rt, 'https://www.facebook.com/me')
  const out: string[] = []
  try {
    const u = new URL(page.url())
    const id = u.searchParams.get('id')
    if (u.pathname === '/profile.php' && id) out.push(id)
    else {
      const seg = u.pathname.split('/').filter(Boolean)[0]
      if (seg && !/^(me|login|checkpoint|home\.php)$/i.test(seg)) out.push(seg)
    }
  } catch {
    /* ignore */
  }
  const h1 = await readAll(page, () => Array.from(document.querySelectorAll('h1')).map((h) => ((h as HTMLElement).innerText || '').split('\n')[0].trim()).filter(Boolean).slice(0, 2))
  return [...out, ...h1]
}

function checkFb(rt: RunContext, account: { handle: string; displayName: string }, found: string[]): void {
  // a numeric profile id only matches when the handle stored is that id
  assertHandle(rt, account, found, 'Facebook', true)
}

const describeField = (page: Page) => [
  page.getByRole('textbox', { name: /describe your reel|description/i }),
  page.locator('[contenteditable="true"][aria-label*="escribe"]'),
  page.locator('[role="dialog"] [contenteditable="true"]'),
  page.locator('[contenteditable="true"][role="textbox"]')
]

export async function facebookReel(rt: RunContext, params: Record<string, unknown>): Promise<RecipeResult> {
  const p = postingParams(params)
  const files = mediaFiles(p, { max: 1, kind: 'video', what: 'A Facebook reel' })
  const caption = captionFor(p, 'facebook')

  await rt.step('Check the acting profile', async () => checkFb(rt, p.account, await fbIdentity(rt)))
  const page = await rt.step('Open the reel composer', () => openPage(rt, 'https://www.facebook.com/reels/create/'))

  await rt.step('Upload the video', async () => {
    await uploadFiles(rt, page, files, {
      inputs: [page.locator('input[type="file"][accept*="video"]'), page.locator('input[type="file"]')],
      triggers: [page.getByRole('button', { name: /add video|upload/i }), page.getByText(/add video/i)]
    })
    await rt.checkpoint()
  })

  await rt.step('Go to the reel settings', async () => {
    for (let i = 0; i < 4; i++) {
      if (await maybeVisible(rt, describeField(page), 2000)) break
      const next = await waitEnabled(rt, [page.getByRole('button', { name: /^Next$/ }), page.locator('[role="button"][aria-label="Next"]')], 'The Next button', 5 * 60_000)
      await rt.race(next.click())
      await rt.sleep(1500)
    }
    await firstVisible(rt, describeField(page), 'the reel description field', 20_000)
  })

  await rt.step('Write the description', async () => {
    if (!caption) return rt.log('No caption')
    await replaceText(rt, page, await firstVisible(rt, describeField(page), 'the reel description field'), caption)
  })

  if (p.post.perPlatform?.facebook?.coverMs !== undefined) rt.log('A cover frame was set, but picking a frame by time is not automated on Facebook — Facebook uses its own pick; change it in the window if it matters', 'warn')
  await rt.checkpoint()
  if (p.mode !== 'publish') return finishPrepare(rt, 'Facebook', 'Check the cover frame before approving.')

  return rt.step('Publish', async () => {
    const btn = await waitEnabled(rt, [page.getByRole('button', { name: /^(Publish|Share|Post)$/ }), page.locator('[role="button"][aria-label="Publish"]')], 'The Publish button', 10 * 60_000)
    await rt.race(btn.click())
    const how = await waitForOutcome(rt, page, {
      what: 'Facebook',
      success: [/your reel (is (now )?(live|published)|has been (published|shared))/i, /reel (published|shared)/i],
      successUrl: /facebook\.com\/(reel|reels)\/\d+/i,
      failure: [/(couldn['’]t|could not|unable to) (publish|upload|post)[^\n]*/i],
      timeout: 15 * 60_000
    })
    const url = how === 'url' ? page.url() : null
    return { url, note: url ? undefined : 'Facebook confirmed the reel; the link is on the Page/profile.' }
  })
}

export async function facebookPost(rt: RunContext, params: Record<string, unknown>, kind: PostKind): Promise<RecipeResult> {
  const p = postingParams(params)
  const files = kind === 'text' ? [] : mediaFiles(p, kind === 'carousel' ? { min: 2, max: 10, what: 'A Facebook album' } : { max: 1, kind: kind === 'video' ? 'video' : 'image', what: 'A Facebook post' })
  const caption = captionFor(p, 'facebook')

  await rt.step('Check the acting profile', async () => checkFb(rt, p.account, await fbIdentity(rt)))
  const page = await rt.step('Open Facebook', () => openPage(rt, 'https://www.facebook.com/'))

  const dialog = page.getByRole('dialog').filter({ hasText: /create post/i }).last()
  await rt.step('Open the post composer', async () => {
    await clickFirst(rt, [page.getByRole('button', { name: /what['’]s on your mind/i }), page.getByText(/what['’]s on your mind/i)], 'the "What\'s on your mind?" box')
    await firstVisible(rt, [dialog], 'the Create post dialog')
  })

  await rt.step('Write the text', async () => {
    if (!caption) return rt.log('No caption')
    const field = await firstVisible(rt, [dialog.getByRole('textbox'), dialog.locator('[contenteditable="true"]')], 'the post text field')
    await replaceText(rt, page, field, caption)
  })

  if (files.length) {
    await rt.step('Add media', async () => {
      await maybeClick(rt, [dialog.getByRole('button', { name: /^photo\/video$/i }), dialog.locator('[aria-label="Photo/video"]')], 4000)
      await uploadFiles(rt, page, files, {
        inputs: [dialog.locator('input[type="file"][multiple]'), dialog.locator('input[type="file"]'), page.locator('input[type="file"][accept*="image"]')],
        triggers: [dialog.getByText(/add photos\/videos/i)]
      })
      await rt.sleep(2000)
      await rt.checkpoint()
    })
  }

  // newer composers have Next → (audience / options) → Post
  await rt.step('Go to the Post button', async () => {
    if (await maybeVisible(rt, [dialog.getByRole('button', { name: /^Post$/ })], 2000)) return
    await maybeClick(rt, [dialog.getByRole('button', { name: /^Next$/ })], 4000)
    await firstVisible(rt, [page.getByRole('button', { name: /^Post$/ })], 'the Post button', 20_000)
  })

  await rt.checkpoint()
  if (p.mode !== 'publish') return finishPrepare(rt, 'Facebook')

  return rt.step('Post', async () => {
    const btn = await waitEnabled(rt, [page.getByRole('dialog').getByRole('button', { name: /^Post$/ }), page.getByRole('button', { name: /^Post$/ })], 'The Post button', 10 * 60_000)
    await rt.race(btn.click())
    await waitForOutcome(rt, page, {
      what: 'Facebook',
      success: [/your post is (now )?(live|published)/i, /post (published|shared)/i],
      // the composer (whatever its title by now) disappears once the post is accepted
      gone: page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^Post$/ }) }),
      failure: [/(couldn['’]t|could not|unable to) (post|publish|share)[^\n]*/i],
      timeout: 10 * 60_000
    })
    return { url: null, note: 'Facebook does not show the post link in the composer — it is on the profile/Page.' }
  })
}
