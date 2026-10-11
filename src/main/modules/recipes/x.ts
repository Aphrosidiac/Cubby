// X (x.com) — text, up to 4 images, or one video through the compose dialog. The success toast
// carries a "View" link to the new post. NOT verified against the live site.
import type { Page } from 'playwright-core'
import type { PostKind } from '@shared/types'
import type { RunContext } from '../runs/manager'
import { assertHandle, captionFor, clickFirst, finishPrepare, firstVisible, mediaFiles, openPage, postingParams, readAll, replaceText, uploadFiles, waitEnabled, waitForOutcome, type RecipeResult } from './kit'

/** Side-nav Profile link and the account switcher (both only show the logged-in account). */
export async function xIdentity(page: Page): Promise<string[]> {
  return readAll(page, () => {
    const out: string[] = []
    const prof = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')
    const m = prof?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})$/)
    if (m) out.push(m[1])
    const sw = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') as HTMLElement | null
    const h = sw?.innerText.match(/@([A-Za-z0-9_]{1,15})/)
    if (h) out.push(h[1])
    return out
  })
}

export async function xPost(rt: RunContext, params: Record<string, unknown>, kind: PostKind): Promise<RecipeResult> {
  const p = postingParams(params)
  const files = kind === 'text' ? [] : mediaFiles(p, kind === 'video' ? { max: 1, kind: 'video', what: 'An X video post' } : { min: kind === 'carousel' ? 2 : 1, max: 4, kind: 'image', what: 'An X image post' })
  const caption = captionFor(p, 'x')

  const home = await rt.step('Open X', () => openPage(rt, 'https://x.com/home'))
  await rt.step('Check the logged-in account', async () => assertHandle(rt, p.account, await xIdentity(home), 'X'))
  const page = await rt.step('Open the composer', () => openPage(rt, 'https://x.com/compose/post'))

  const box = () => [page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]'), page.locator('[data-testid="tweetTextarea_0"]')]
  await rt.step('Write the post', async () => {
    const field = await firstVisible(rt, box(), 'the post text box')
    if (caption) await replaceText(rt, page, field, caption)
  })
  if (files.length) {
    await rt.step('Attach media', async () => {
      await uploadFiles(rt, page, files, { inputs: [page.locator('[role="dialog"] input[data-testid="fileInput"]'), page.locator('input[data-testid="fileInput"]'), page.locator('input[type="file"]')] })
      await rt.checkpoint()
    })
  }
  const postBtn = [page.locator('[role="dialog"] [data-testid="tweetButton"]'), page.locator('[data-testid="tweetButton"]')]
  await rt.step('Wait for the media to process', async () => {
    await waitEnabled(rt, postBtn, 'The Post button', 10 * 60_000)
  })

  await rt.step('Check the account again', async () => assertHandle(rt, p.account, await xIdentity(page), 'X'))
  await rt.checkpoint()
  if (p.mode !== 'publish') return finishPrepare(rt, 'X')

  return rt.step('Post', async () => {
    await clickFirst(rt, postBtn, 'the Post button')
    await waitForOutcome(rt, page, { what: 'X', success: [/your post was sent/i], failure: [/(something went wrong|you are over the daily limit|already said that)[^\n]*/i], timeout: 5 * 60_000 })
    const links = await readAll(page, () => Array.from(document.querySelectorAll('[data-testid="toast"] a[href*="/status/"]')).map((a) => (a as HTMLAnchorElement).href))
    return { url: links[0] ?? null, note: links[0] ? undefined : 'X confirmed the post; the toast had no link.' }
  })
}
