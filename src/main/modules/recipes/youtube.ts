// YouTube Shorts / videos through YouTube Studio's upload dialog (youtube.com/upload redirects there).
// A vertical video ≤ 3 min becomes a Short automatically. Traps: the title is pre-filled with the
// file name; "Made for kids" must be answered before Next works. Note: YouTube saves the upload as a
// private draft the moment the file is attached — 'prepare' leaves that draft in Studio.
// NOT verified against the live site.
import type { Page } from 'playwright-core'
import type { RunContext } from '../runs/manager'
import { assertHandle, captionFor, clickFirst, finishPrepare, firstVisible, maybeClick, maybeVisible, mediaFiles, openPage, postingParams, readAll, replaceText, uploadFiles, waitEnabled, waitForOutcome, type RecipeResult } from './kit'

/** youtube.com account menu shows the active channel's @handle and name. */
export async function ytIdentity(rt: RunContext): Promise<string[]> {
  const page = await openPage(rt, 'https://www.youtube.com/')
  const avatar = await maybeVisible(rt, [page.locator('button#avatar-btn'), page.getByRole('button', { name: /account menu|avatar/i })], 15_000)
  if (!avatar) return []
  await rt.race(avatar.click())
  await maybeVisible(rt, [page.locator('#channel-handle'), page.locator('ytd-active-account-header-renderer')], 8000)
  const found = await readAll(page, () => {
    const out: string[] = []
    const hdr = document.querySelector('ytd-active-account-header-renderer')
    const handle = hdr?.querySelector('#channel-handle') ?? document.querySelector('#channel-handle')
    if (handle && (handle as HTMLElement).innerText.trim()) out.push((handle as HTMLElement).innerText.trim())
    const name = hdr?.querySelector('#account-name')
    if (name && (name as HTMLElement).innerText.trim()) out.push((name as HTMLElement).innerText.trim())
    return out
  })
  await rt.race(avatar.click().catch(() => {})) // close the menu again (no Escape needed)
  return found
}

const fileInput = (page: Page) => [page.locator('input[type="file"][name="Filedata"]'), page.locator('ytcp-uploads-file-picker input[type="file"]'), page.locator('input[type="file"]')]
const titleBox = (page: Page) => [page.locator('#title-textarea #textbox'), page.getByRole('textbox', { name: /add a title|title/i })]
const descBox = (page: Page) => [page.locator('#description-textarea #textbox'), page.getByRole('textbox', { name: /tell viewers|description/i })]

export async function youtubeUpload(rt: RunContext, params: Record<string, unknown>): Promise<RecipeResult> {
  const p = postingParams(params)
  const files = mediaFiles(p, { max: 1, kind: 'video', what: 'A YouTube upload' })
  const caption = captionFor(p, 'youtube')
  const opts = p.post.perPlatform?.youtube
  const title = (opts?.title || caption.split('\n').find((l) => l.trim()) || p.assets[0]?.filename.replace(/\.[a-z0-9]+$/i, '') || 'Short').trim().slice(0, 100)
  const filenames = p.assets.map((a) => a.filename.replace(/\.[a-z0-9]+$/i, ''))

  await rt.step('Check the active channel', async () => assertHandle(rt, p.account, await ytIdentity(rt), 'YouTube', true))
  const page = await rt.step('Open the Studio upload dialog', () => openPage(rt, 'https://www.youtube.com/upload'))

  await rt.step('Upload the video', async () => {
    await uploadFiles(rt, page, files, { inputs: fileInput(page), triggers: [page.locator('#select-files-button'), page.getByRole('button', { name: /select files/i })], timeout: 45_000 })
    await firstVisible(rt, titleBox(page), 'the Details form', 3 * 60_000)
    await rt.checkpoint()
  })

  await rt.step('Title', async () => {
    await replaceText(rt, page, await firstVisible(rt, titleBox(page), 'the title box'), title, { mustNotContain: filenames.filter((f) => !title.includes(f)) })
  })
  await rt.step('Description', async () => {
    if (!caption) return rt.log('No description')
    await replaceText(rt, page, await firstVisible(rt, descBox(page), 'the description box'), caption)
  })
  await rt.step('Made for kids: No', async () => {
    await clickFirst(rt, [page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]'), page.getByRole('radio', { name: /not made for kids/i })], 'the "not made for kids" option')
  })

  await rt.step('Go to Visibility', async () => {
    for (let i = 0; i < 3; i++) {
      if (await maybeVisible(rt, [page.locator('tp-yt-paper-radio-button[name="PUBLIC"]')], 1500)) return
      const next = await waitEnabled(rt, [page.locator('#next-button'), page.getByRole('button', { name: /^Next$/ })], 'The Next button', 60_000)
      await rt.race(next.click())
      await rt.sleep(1200)
    }
    await firstVisible(rt, [page.locator('tp-yt-paper-radio-button[name="PUBLIC"]'), page.getByRole('radio', { name: /^Public$/ })], 'the Visibility step')
  })
  await rt.step('Visibility: Public', async () => {
    await clickFirst(rt, [page.locator('tp-yt-paper-radio-button[name="PUBLIC"]'), page.getByRole('radio', { name: /^Public$/ })], 'the Public option')
  })

  const link = await readAll(page, () => Array.from(document.querySelectorAll('.video-url-fadeable a, ytcp-video-info a[href*="youtu"]')).map((a) => (a as HTMLAnchorElement).href).filter(Boolean))
  if (link[0]) rt.log(`Video link: ${link[0]}`)
  await rt.checkpoint()
  if (p.mode !== 'publish') return finishPrepare(rt, 'YouTube', 'YouTube already keeps the upload as a private draft in Studio.')

  return rt.step('Publish', async () => {
    const done = await waitEnabled(rt, [page.locator('#done-button'), page.getByRole('button', { name: /^(Publish|Save)$/ })], 'The Publish button', 20 * 60_000)
    await rt.race(done.click())
    await waitForOutcome(rt, page, { what: 'YouTube', success: [/video published/i, /short published/i], failure: [/(couldn['’]t|could not|unable to) (publish|save)[^\n]*/i], timeout: 10 * 60_000 })
    await maybeClick(rt, [page.locator('ytcp-video-share-dialog #close-button'), page.getByRole('button', { name: /^Close$/ })], 3000)
    return { url: link[0] ?? null, note: link[0] ? undefined : 'Published; YouTube did not show the link in the dialog.' }
  })
}
