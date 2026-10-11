// OWNER: automation module builder. PUBLIC signature — keep it; replace the body + add tests.
//
// Checkpoint stop (PLAN §8.4): decide from what a page shows whether a platform is challenging us.
// Pure function over URL, title, visible text and iframe URLs. Hits: challenge/checkpoint URLs,
// captcha frames (recaptcha, hcaptcha, arkose/funcaptcha, geetest, TikTok's verify), "Confirm you're
// human", "We limit how often", "Please wait a few minutes", "Try again later", "suspicious activity",
// "Your account has been locked/suspended", login walls when we expected to be logged in.
// Never solved by the app — the caller stops, fronts the window and notifies.
import type { Checkpoint } from './types'

export interface PageFacts {
  url: string
  title: string
  /** visible text, may be truncated */
  text: string
  frameUrls: string[]
}

export function detectCheckpoint(p: PageFacts): Checkpoint | null {
  void p
  return null
}
