// Built-in recipes (PLAN §6.8): TypeScript flows on the same RunContext. Posting recipes:
// instagram reel / image / carousel / story, facebook reel / post, tiktok video (+ photos), youtube
// short, x, linkedin, threads; plus "check_logins". Each posting recipe:
//  1. guards: page's active account must match account.handle (HANDLE CHECK — read the visible
//     account name/handle in the composer or profile switcher; mismatch → GuardrailError('handle_check'),
//     unreadable → GuardrailError('handle_check', could not confirm) rather than guessing)
//  2. opens the platform's create flow, uploads media via setInputFiles (never the OS file dialog),
//     fills caption + per-platform options, known traps: IG Escape = discard dialog (never press Escape
//     in IG composer), IG crop → "Original", TikTok fills description with the filename (clear it first),
//     FB cover frame
//  3. mode 'prepare' stops before the final Share/Post button and screenshots the filled composer;
//     mode 'publish' clicks it, waits for the success signal, and returns the post URL when visible
//  4. rt.checkpoint() after every navigation and before publishing
// Selectors prefer roles + accessible names + visible text (getByRole/getByText) over CSS classes.
// None of these has been run against the live platforms (we never post from tests) — they fail
// loudly (step error + screenshot) when the UI differs from what they expect.
import type { Platform, PostKind, RecipeInfo } from '@shared/types'
import { PLATFORM_SPECS } from '@shared/platforms'
import type { RunContext } from '../runs'
import { checkBrandHealth } from '../health'
import { facebookPost, facebookReel } from './facebook'
import { instagramPost, instagramStory } from './instagram'
import type { RecipeResult } from './kit'
import { linkedinPost } from './linkedin'
import { threadsPost } from './threads'
import { tiktokPhotos, tiktokVideo } from './tiktok'
import { xPost } from './x'
import { youtubeUpload } from './youtube'

export type { PostingParams, RecipeResult } from './kit'

export interface Recipe {
  info: RecipeInfo
  run(rt: RunContext, params: Record<string, unknown>): Promise<RecipeResult>
}

const kindOf = (params: Record<string, unknown>, fallback: PostKind): PostKind => {
  const k = (params.post as { kind?: PostKind } | undefined)?.kind
  return k ?? fallback
}

const UNVERIFIED = ' Built from the platform\'s web UI as of 2026 — not yet run against the live site.'

export const RECIPES: Recipe[] = [
  {
    info: { id: 'instagram_reel', name: 'Instagram reel', platform: 'instagram', kinds: ['reel'], description: 'Create → Post with one video (shared as a reel), crop Original, caption, Share.' + UNVERIFIED },
    run: (rt, p) => instagramPost(rt, p, 'reel')
  },
  {
    info: { id: 'instagram_image', name: 'Instagram post', platform: 'instagram', kinds: ['image'], description: 'Create → Post with one image, crop Original, caption, Share.' + UNVERIFIED },
    run: (rt, p) => instagramPost(rt, p, 'image')
  },
  {
    info: { id: 'instagram_carousel', name: 'Instagram carousel', platform: 'instagram', kinds: ['carousel'], description: 'Create → Post with 2–20 images/videos, crop Original, caption, Share.' + UNVERIFIED },
    run: (rt, p) => instagramPost(rt, p, 'carousel')
  },
  {
    info: { id: 'instagram_story', name: 'Instagram story', platform: 'instagram', kinds: ['story'], description: 'Not supported: instagram.com on desktop has no story composer. The run stops as "needs you" so the story is posted from the phone.' },
    run: (rt, p) => instagramStory(rt, p)
  },
  {
    info: { id: 'facebook_reel', name: 'Facebook reel', platform: 'facebook', kinds: ['reel'], description: 'facebook.com/reels/create: upload, Next, description, Publish. Facebook picks the cover frame.' + UNVERIFIED },
    run: (rt, p) => facebookReel(rt, p)
  },
  {
    info: { id: 'facebook_post', name: 'Facebook post', platform: 'facebook', kinds: ['text', 'image', 'video', 'carousel'], description: '"What\'s on your mind?" composer: text plus a photo, video or album (up to 10), Post. Acts as the profile/Page you are switched into.' + UNVERIFIED },
    run: (rt, p) => facebookPost(rt, p, kindOf(p, 'image'))
  },
  {
    info: { id: 'tiktok_video', name: 'TikTok video', platform: 'tiktok', kinds: ['video', 'reel'], description: 'TikTok Studio uploader: upload, replace the file-name description, privacy/duet/stitch, Post.' + UNVERIFIED },
    run: (rt, p) => tiktokVideo(rt, p)
  },
  {
    info: { id: 'tiktok_photos', name: 'TikTok photo post', platform: 'tiktok', kinds: ['carousel', 'image'], description: 'TikTok Studio uploader with images (photo mode). Only works where TikTok\'s web uploader accepts photos for the account.' + UNVERIFIED },
    run: (rt, p) => tiktokPhotos(rt, p)
  },
  {
    info: { id: 'youtube_short', name: 'YouTube Short / video', platform: 'youtube', kinds: ['reel', 'video'], description: 'YouTube Studio upload: title, description, not made for kids, Public, Publish. Vertical ≤ 3 min = Short. Prepare leaves a private draft in Studio.' + UNVERIFIED },
    run: (rt, p) => youtubeUpload(rt, p)
  },
  {
    info: { id: 'x_post', name: 'X post', platform: 'x', kinds: ['text', 'image', 'video', 'carousel'], description: 'x.com compose: text with up to 4 images or one video, Post; returns the post link from the toast.' + UNVERIFIED },
    run: (rt, p) => xPost(rt, p, kindOf(p, 'text'))
  },
  {
    info: { id: 'linkedin_post', name: 'LinkedIn post', platform: 'linkedin', kinds: ['text', 'image', 'video', 'carousel'], description: 'Start a post on the feed (personal) or the Page admin view (handle "company/<slug>"), media, Post.' + UNVERIFIED },
    run: (rt, p) => linkedinPost(rt, p, kindOf(p, 'text'))
  },
  {
    info: { id: 'threads_post', name: 'Threads post', platform: 'threads', kinds: ['text', 'image', 'video', 'carousel'], description: 'threads.com Create: text with images or a video, Post.' + UNVERIFIED },
    run: (rt, p) => threadsPost(rt, p, kindOf(p, 'text'))
  },
  {
    info: { id: 'check_logins', name: 'Check all logins', platform: null, kinds: [], description: 'Reads every account\'s session cookies in this brand (no page loads) and updates the login dots.' },
    run: async (rt) => {
      const accounts = await rt.step('Check session cookies', () => checkBrandHealth(rt.brandId, true))
      if (!accounts.length) rt.log('This brand has no accounts yet')
      for (const a of accounts) {
        rt.log(`${PLATFORM_SPECS[a.platform]?.name ?? a.platform} @${a.handle.replace(/^@/, '')}: ${a.loginState}${a.cookieExpiresAt ? ` (session until ${a.cookieExpiresAt.slice(0, 10)})` : ''}`, a.loginState === 'expired' ? 'warn' : 'info')
      }
      const bad = accounts.filter((a) => a.loginState === 'expired')
      return { note: bad.length ? `${bad.length} account${bad.length === 1 ? ' needs' : 's need'} logging in again` : 'All logins look fine' }
    }
  }
]

export function getRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.info.id === id)
}

/** The posting recipe for a platform + kind, if one exists. */
export function postingRecipeFor(platform: Platform, kind: PostKind): Recipe | undefined {
  return RECIPES.find((r) => r.info.platform === platform && r.info.kinds.includes(kind))
}

export function start(): void {}
export async function stop(): Promise<void> {}
