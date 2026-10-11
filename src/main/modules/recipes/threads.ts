// Threads (threads.com) — text, images or a video through the Create dialog. The left rail's
// Profile link names the logged-in account; the "Posted" toast has a View link.
// NOT verified against the live site.
import type { Page } from 'playwright-core'
import type { PostKind } from '@shared/types'
import type { RunContext } from '../runs/manager'
import { assertHandle, captionFor, clickFirst, finishPrepare, firstVisible, mediaFiles, openPage, postingParams, readAll, replaceText, uploadFiles, waitEnabled, waitForOutcome, type RecipeResult } from './kit'

export async function threadsIdentity(page: Page): Promise<string[]> {
  return readAll(page, () => {
    const out: string[] = []
    for (const a of Array.from(document.querySelectorAll('a[href^="/@"], a[href*="threads.com/@"], a[href*="threads.net/@"]'))) {
      const r = (a as HTMLElement).getBoundingClientRect()
      const labelled = !!a.querySelector('svg[aria-label="Profile"]') || /^profile$/i.test(a.getAttribute('aria-label') || '')
      if (!labelled && !(r.left < 100 && r.width < 100)) continue // left rail only, never feed authors
      const m = (a.getAttribute('href') || '').match(/\/@([A-Za-z0-9._]+)/)
      if (m) out.push(m[1])
    }
    return out
  })
}

export async function threadsPost(rt: RunContext, params: Record<string, unknown>, kind: PostKind): Promise<RecipeResult> {
  const p = postingParams(params)
  const files = kind === 'text' ? [] : mediaFiles(p, kind === 'video' ? { max: 1, kind: 'video', what: 'A Threads video post' } : { min: kind === 'carousel' ? 2 : 1, max: 20, kind: kind === 'carousel' ? 'any' : 'image', what: 'A Threads post' })
  const caption = captionFor(p, 'threads')

  const page = await rt.step('Open Threads', () => openPage(rt, 'https://www.threads.com/'))
  await rt.step('Check the logged-in account', async () => assertHandle(rt, p.account, await threadsIdentity(page), 'Threads'))

  const dialog = page.getByRole('dialog').last()
  await rt.step('Open the composer', async () => {
    await clickFirst(rt, [page.getByRole('button', { name: /^Create$/ }), page.locator('[role="button"]:has(svg[aria-label="Create"])'), page.locator('a:has(svg[aria-label="Create"])'), page.getByText(/^What['’]s new\?$/)], 'the Create button')
    await firstVisible(rt, [dialog.locator('[contenteditable="true"]')], 'the new thread dialog')
  })
  await rt.step('Write the post', async () => {
    if (caption) await replaceText(rt, page, await firstVisible(rt, [dialog.getByRole('textbox'), dialog.locator('[contenteditable="true"]')], 'the post text box'), caption)
  })
  if (files.length) {
    await rt.step('Attach media', async () => {
      await uploadFiles(rt, page, files, { inputs: [dialog.locator('input[type="file"]'), page.locator('input[type="file"][accept*="image"]')] })
      await rt.checkpoint()
    })
  }
  const postBtn = [dialog.getByRole('button', { name: /^Post$/ }), dialog.locator('div[role="button"]:text-is("Post")')]
  await rt.step('Wait for the Post button', async () => {
    await waitEnabled(rt, postBtn, 'The Post button', 10 * 60_000)
  })
  await rt.checkpoint()
  if (p.mode !== 'publish') return finishPrepare(rt, 'Threads')

  return rt.step('Post', async () => {
    await clickFirst(rt, postBtn, 'the Post button')
    await waitForOutcome(rt, page, { what: 'Threads', success: [/^posted$/im, /your thread (was|has been) posted/i], failure: [/(couldn['’]t|could not) (post|upload)[^\n]*/i], timeout: 10 * 60_000 })
    const links = await readAll(page, () => Array.from(document.querySelectorAll('a[href*="/post/"]')).filter((a) => /view/i.test((a as HTMLElement).innerText)).map((a) => (a as HTMLAnchorElement).href))
    return { url: links[0] ?? null, note: links[0] ? undefined : 'Threads confirmed the post; no link was shown.' }
  })
}
