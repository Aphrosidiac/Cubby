// LinkedIn — personal posts from the feed ("Start a post"), Company Page posts from the Page's admin
// view (handle "company/<slug>"). Personal identity = the /in/<slug> link in the feed's own profile
// card; Page identity = the admin view opening for that slug (only admins get it) plus the composer's
// actor name. NOT verified against the live site.
import type { Page } from 'playwright-core'
import type { PostKind } from '@shared/types'
import { GuardrailError } from '../../core/errors'
import type { RunContext } from '../runs/manager'
import { assertHandle, captionFor, clickFirst, finishPrepare, firstVisible, maybeClick, maybeVisible, mediaFiles, normHandle, openPage, postingParams, readAll, replaceText, uploadFiles, waitEnabled, waitForOutcome, type RecipeResult } from './kit'

export async function liPersonalIdentity(page: Page): Promise<string[]> {
  return readAll(page, () => {
    const out: string[] = []
    const scopes = Array.from(document.querySelectorAll('.feed-identity-module, [data-view-name*="identity"], aside .profile-card, .global-nav__me'))
    for (const s of scopes) {
      for (const a of Array.from(s.querySelectorAll('a[href*="/in/"]'))) {
        const m = (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/)
        if (m) out.push('in/' + decodeURIComponent(m[1]))
      }
    }
    return out
  })
}

export async function linkedinPost(rt: RunContext, params: Record<string, unknown>, kind: PostKind): Promise<RecipeResult> {
  const p = postingParams(params)
  const files = kind === 'text' ? [] : mediaFiles(p, kind === 'carousel' ? { min: 2, max: 20, kind: 'image', what: 'A LinkedIn multi-image post' } : { max: 1, kind: kind === 'video' ? 'video' : 'image', what: 'A LinkedIn post' })
  const caption = captionFor(p, 'linkedin')
  const handle = normHandle(p.account.handle)
  const company = handle.startsWith('company/') ? handle.slice('company/'.length) : null

  let page: Page
  if (company) {
    page = await rt.step('Open the Page admin view', () => openPage(rt, `https://www.linkedin.com/company/${encodeURIComponent(company)}/admin/page-posts/published/`))
    await rt.step('Check Page access', async () => {
      if (!/\/admin\//.test(page.url()) || !page.url().toLowerCase().includes(`/company/${company.toLowerCase()}`))
        throw new GuardrailError(`LinkedIn did not open the admin view of company/${company} — this login is not an admin of that Page`, 'handle_check')
      rt.log(`Admin view of company/${company} ✓`)
    })
    await rt.step('Open the composer', async () => {
      if (!(await maybeClick(rt, [page.getByRole('button', { name: /^Start a post$/i })], 3000))) {
        await clickFirst(rt, [page.getByRole('button', { name: /^Create$/ })], 'the Create button')
        await clickFirst(rt, [page.getByRole('menuitem', { name: /start a post/i }), page.getByText(/^Start a post$/i)], 'Start a post')
      }
    })
  } else {
    page = await rt.step('Open LinkedIn', () => openPage(rt, 'https://www.linkedin.com/feed/'))
    await rt.step('Check the logged-in account', async () => assertHandle(rt, p.account, await liPersonalIdentity(page), 'LinkedIn'))
    await rt.step('Open the composer', async () => {
      await clickFirst(rt, [page.getByRole('button', { name: /^Start a post/i }), page.getByText(/^Start a post$/i)], 'Start a post')
    })
  }

  const dialog = page.getByRole('dialog').last()
  const editor = () => [dialog.getByRole('textbox', { name: /text editor|what do you want to talk about/i }), dialog.locator('.ql-editor[contenteditable="true"]'), dialog.locator('[contenteditable="true"]')]
  await rt.step('Write the post', async () => {
    const field = await firstVisible(rt, editor(), 'the post editor')
    if (caption) await replaceText(rt, page, field, caption)
  })

  if (company) {
    await rt.step('Check the posting identity', async () => {
      const names = await readAll(page, () => {
        const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop()
        const el = d?.querySelector('.share-unified-settings-entry-button, [class*="actor-name"], [class*="share-box"] button span') as HTMLElement | null
        return el ? [el.innerText.split('\n')[0].trim()] : []
      })
      if (names.length) assertHandle(rt, p.account, [...names, `company/${company}`], 'LinkedIn', true)
    })
  }

  if (files.length) {
    await rt.step('Add media', async () => {
      await maybeClick(rt, [dialog.getByRole('button', { name: /add (media|a photo|a video)/i }), dialog.locator('[aria-label="Add media"]')], 4000)
      await uploadFiles(rt, page, files, { inputs: [page.locator('#media-editor-file-selector__file-input'), page.locator('[role="dialog"] input[type="file"]'), page.locator('input[type="file"]')] })
      await rt.sleep(1500)
      // the media editor needs Next / Done to return to the post
      for (let i = 0; i < 2; i++) {
        if (await maybeVisible(rt, editor(), 1500)) break
        await maybeClick(rt, [page.getByRole('button', { name: /^(Next|Done)$/ })], 5 * 60_000)
      }
      await rt.checkpoint()
    })
  }

  const postBtn = [page.getByRole('dialog').getByRole('button', { name: /^Post$/ }), page.locator('.share-actions__primary-action')]
  await rt.step('Wait for the Post button', async () => {
    await waitEnabled(rt, postBtn, 'The Post button', 10 * 60_000)
  })
  await rt.checkpoint()
  if (p.mode !== 'publish') return finishPrepare(rt, 'LinkedIn')

  return rt.step('Post', async () => {
    await clickFirst(rt, postBtn, 'the Post button')
    await waitForOutcome(rt, page, { what: 'LinkedIn', success: [/post successful/i, /your post (is|was) (live|shared|published)/i], failure: [/(something went wrong|couldn['’]t (post|share))[^\n]*/i], timeout: 10 * 60_000 })
    const links = await readAll(page, () => Array.from(document.querySelectorAll('.artdeco-toast-item a[href*="/feed/update/"], [role="alert"] a[href*="/feed/update/"]')).map((a) => (a as HTMLAnchorElement).href))
    return { url: links[0] ?? null, note: links[0] ? undefined : 'LinkedIn confirmed the post; no link was shown.' }
  })
}
