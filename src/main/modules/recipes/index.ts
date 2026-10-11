// OWNER: automation module builder. PUBLIC interface — keep exports; replace stubs.
//
// Built-in recipes (PLAN §6.8): TypeScript flows on the same RunContext. Posting recipes:
// instagram reel / image / carousel / story, facebook reel / video / image / carousel, tiktok video
// (+ photo carousel), youtube short, x, linkedin, threads; plus "check_logins". Each posting recipe:
//  1. guards: page's active account must match account.handle (HANDLE CHECK — read the visible
//     account name/handle in the composer or profile switcher; mismatch → GuardrailError('handle_check'))
//  2. opens the platform's create flow, uploads media via setInputFiles (never the OS file dialog),
//     fills caption + per-platform options, known traps: IG Escape = discard dialog (never press Escape
//     in IG composer), IG crop → "Original", TikTok fills description with the filename (clear it first),
//     FB cover frame
//  3. mode 'prepare' stops before the final Share/Post button and screenshots the filled composer;
//     mode 'publish' clicks it, waits for the success signal, and returns the post URL when visible
//  4. rt.checkpoint() after every navigation and before publishing
// Selectors prefer roles + accessible names + visible text (getByRole/getByText) over CSS classes.
import type { Account, MediaAsset, Post, RecipeInfo, Platform, PostKind } from '@shared/types'
import type { RunContext } from '../runs'

export interface PostingParams {
  post: Post
  account: Account
  assets: MediaAsset[]
  mode: 'prepare' | 'publish'
}

export interface RecipeResult {
  url?: string | null
  screen?: string | null
  note?: string
}

export interface Recipe {
  info: RecipeInfo
  run(rt: RunContext, params: Record<string, unknown>): Promise<RecipeResult>
}

export const RECIPES: Recipe[] = []

export function getRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.info.id === id)
}

/** The posting recipe for a platform + kind, if one exists. */
export function postingRecipeFor(platform: Platform, kind: PostKind): Recipe | undefined {
  return RECIPES.find((r) => r.info.platform === platform && r.info.kinds.includes(kind))
}

export function start(): void {}
export async function stop(): Promise<void> {}
