// Checkpoint stop (PLAN §8.4): decide from what a page shows whether a platform is challenging us.
// Pure function over URL, title, visible text and iframe URLs. Hits: challenge/checkpoint URLs,
// captcha frames (recaptcha, hcaptcha, arkose/funcaptcha, geetest, TikTok's verify), "Confirm you're
// human", "We limit how often", "Please wait a few minutes", "Try again later", "suspicious activity",
// "Your account has been locked/suspended", login walls when we expected to be logged in.
// Never solved by the app — the caller stops, fronts the window and notifies.
//
// False positives stop a run for nothing, false negatives keep clicking on a challenge page — so the
// rules are layered by confidence:
//   1. captcha frames (visible iframes only — callers should drop hidden ones; invisible reCAPTCHA
//      anchors are ignored here too)
//   2. platform URLs (challenge / checkpoint / login paths), only on that platform's host
//   3. STRONG phrases — wording only a challenge page uses; matched anywhere in the visible text
//   4. weak phrases ("try again later", "unusual activity") — matched only in the title, an open
//      dialog, or a page whose whole text is short (a feed caption saying "try again later" must not
//      stop a run)
import { platformOfUrl, PLATFORM_SPECS } from './platforms'
import type { Checkpoint, Platform } from './types'

export interface PageFacts {
  url: string
  title: string
  /** visible text, may be truncated */
  text: string
  frameUrls: string[]
  /** visible text of open dialogs ([role=dialog], [role=alertdialog], dialog[open]) — optional */
  dialogText?: string
}

type Kind = Checkpoint['kind']

/** A page shorter than this is "mostly the message" — weak phrases count there. */
const SHORT_PAGE = 1500

const CAPTCHA_FRAMES: [RegExp, string][] = [
  [/(google\.com|recaptcha\.net|gstatic\.com)\/recaptcha\//i, 'a reCAPTCHA'],
  [/hcaptcha\.com/i, 'an hCaptcha'],
  [/(arkoselabs\.com|funcaptcha\.com|arkose)/i, 'an Arkose (FunCaptcha) puzzle'],
  [/geetest\.com/i, 'a GeeTest puzzle'],
  [/challenges\.cloudflare\.com/i, 'a Cloudflare check'],
  [/(verify-?center|verification\.tiktok\.com|tiktok\.com\/.*captcha|captcha.*tiktok|bytedance\.com\/.*(captcha|verify)|byteoversea\.com\/.*captcha)/i, "TikTok's verification puzzle"]
]

interface UrlRule {
  platforms: Platform[] | 'any'
  re: RegExp
  kind: Kind
  what: string
}

const URL_RULES: UrlRule[] = [
  { platforms: 'any', re: /google\.[a-z.]+\/sorry\//i, kind: 'captcha', what: 'Google is showing an "unusual traffic" check' },
  { platforms: ['instagram', 'threads'], re: /\/challenge\//i, kind: 'checkpoint', what: 'a security challenge' },
  { platforms: ['instagram'], re: /\/accounts\/(suspended|disabled)/i, kind: 'checkpoint', what: 'an account suspended / disabled page' },
  { platforms: ['instagram'], re: /\/accounts\/login/i, kind: 'login_wall', what: 'the login page — the brand is logged out' },
  { platforms: ['facebook'], re: /\/checkpoint\//i, kind: 'checkpoint', what: 'a checkpoint' },
  { platforms: ['facebook'], re: /\/(two_step_verification|two_factor)\//i, kind: 'checkpoint', what: 'a login verification step' },
  { platforms: ['facebook'], re: /facebook\.com\/(login(\.php)?|login\/)(\?|$|\/)/i, kind: 'login_wall', what: 'the login page — the brand is logged out' },
  { platforms: ['x'], re: /\/account\/access/i, kind: 'checkpoint', what: 'an account access check' },
  { platforms: ['x'], re: /\/i\/flow\/login|x\.com\/login/i, kind: 'login_wall', what: 'the login page — the brand is logged out' },
  { platforms: ['linkedin'], re: /\/checkpoint\/(challenge|lg|rp)/i, kind: 'checkpoint', what: 'a security check' },
  { platforms: ['linkedin'], re: /\/(authwall|uas\/login|login)(\?|$|\/)/i, kind: 'login_wall', what: 'the sign-in wall — the brand is logged out' },
  { platforms: ['tiktok'], re: /\/captcha/i, kind: 'captcha', what: 'a captcha page' },
  { platforms: ['tiktok'], re: /tiktok\.com\/login/i, kind: 'login_wall', what: 'the login page — the brand is logged out' },
  { platforms: ['threads'], re: /threads\.(net|com)\/login/i, kind: 'login_wall', what: 'the login page — the brand is logged out' }
]

// Google accounts live on accounts.google.com (platformOfUrl says null for it); YouTube posting
// lands there when logged out or challenged.
const GOOGLE_RULES: [RegExp, Kind, string][] = [
  [/accounts\.google\.com\/.*(challenge|speedbump|signin\/rejected|deniedsigninrejected)/i, 'checkpoint', 'Google is asking to verify it is you'],
  [/accounts\.google\.com\/.*(signin|servicelogin|identifier)/i, 'login_wall', 'the Google sign-in page — the brand is logged out of YouTube']
]

interface Phrase {
  re: RegExp
  kind: Kind
  what: string
}

// Wording only challenge / limit pages use. Apostrophes are normalised to ' before matching.
const STRONG: Phrase[] = [
  { re: /we limit how often you can do certain things/, kind: 'rate_limit', what: '"We limit how often you can do certain things"' },
  { re: /please wait a few minutes before you try again/, kind: 'rate_limit', what: '"Please wait a few minutes before you try again"' },
  { re: /we restrict certain (activity|content and actions) to protect our community/, kind: 'rate_limit', what: 'an action-blocked notice' },
  { re: /this action was blocked/, kind: 'rate_limit', what: '"This action was blocked"' },
  { re: /you're temporarily blocked/, kind: 'rate_limit', what: '"You\'re temporarily blocked"' },
  { re: /misusing this feature by going too fast/, kind: 'rate_limit', what: 'a "going too fast" block' },
  { re: /maximum number of attempts reached/, kind: 'rate_limit', what: '"Maximum number of attempts reached"' },
  { re: /you are over the daily limit for/, kind: 'rate_limit', what: 'a daily limit notice' },
  { re: /daily upload limit reached/, kind: 'rate_limit', what: '"Daily upload limit reached"' },
  { re: /you've reached the (daily |hourly )?limit/, kind: 'rate_limit', what: 'a limit notice' },
  { re: /rate limit exceeded/, kind: 'rate_limit', what: '"Rate limit exceeded"' },

  { re: /confirm (that )?you're (a )?human/, kind: 'captcha', what: '"Confirm you\'re human"' },
  { re: /verify (that )?you('re| are) (a )?human/, kind: 'captcha', what: '"Verify you are human"' },
  { re: /drag the (slider|puzzle piece) to fit the puzzle|drag the puzzle piece into place/, kind: 'captcha', what: 'a slider puzzle' },
  { re: /select 2 objects that are the same shape/, kind: 'captcha', what: 'a shape puzzle' },
  { re: /our systems have detected unusual traffic/, kind: 'captcha', what: 'an unusual-traffic check' },
  { re: /(please )?complete the security check to (access|continue)/, kind: 'captcha', what: 'a security check' },

  { re: /help us confirm it's you/, kind: 'checkpoint', what: '"Help us confirm it\'s you"' },
  { re: /let's do a quick security check/, kind: 'checkpoint', what: '"Let\'s do a quick security check"' },
  { re: /we suspect automated behavio(u)?r on your account/, kind: 'checkpoint', what: 'an automated-behaviour warning' },
  { re: /we (noticed|detected) (some )?(unusual|suspicious) (activity|login attempt)/, kind: 'checkpoint', what: 'a suspicious-activity notice' },
  { re: /suspicious login attempt/, kind: 'checkpoint', what: 'a suspicious-login notice' },
  { re: /your account (has been|was|is) (temporarily )?(locked|suspended|disabled|restricted)/, kind: 'checkpoint', what: 'an account locked / suspended notice' },
  { re: /we('ve)? (suspended|disabled|locked) your account/, kind: 'checkpoint', what: 'an account suspended notice' },
  { re: /we've temporarily limited some of your account features/, kind: 'checkpoint', what: 'an account-limited notice' },
  { re: /your account is temporarily locked/, kind: 'checkpoint', what: 'an account locked notice' },
  { re: /enter the (6|six)-digit code|enter the code we sent (to|you)|enter (the )?confirmation code/, kind: 'checkpoint', what: 'a login code prompt' },
  { re: /check your notifications on another device/, kind: 'checkpoint', what: 'a login approval prompt' }
]

// Only in the title, a dialog, or a short page.
const WEAK: Phrase[] = [
  { re: /\btry again later\b/, kind: 'rate_limit', what: '"Try again later"' },
  { re: /\btoo many (requests|attempts)\b/, kind: 'rate_limit', what: '"Too many requests"' },
  { re: /\baction blocked\b/, kind: 'rate_limit', what: '"Action blocked"' },
  { re: /\b(suspicious|unusual) activity\b/, kind: 'checkpoint', what: 'a suspicious-activity notice' },
  { re: /\b(verify|confirm) it's you\b/, kind: 'checkpoint', what: '"Verify it\'s you"' },
  { re: /\bconfirm your identity\b/, kind: 'checkpoint', what: '"Confirm your identity"' },
  { re: /\bsecurity check\b/, kind: 'checkpoint', what: 'a security check' },
  { re: /\bi'm not a robot\b/, kind: 'captcha', what: 'a captcha' },
  { re: /\bverify to continue\b/, kind: 'captcha', what: 'a verification puzzle' }
]

// Logged-out landing pages: only on that platform's host and only when the page is short or the
// phrase is in the title (a logged-in feed never shows these as its main content).
const LOGIN_TEXT: [Platform, RegExp][] = [
  ['instagram', /(log in to instagram|don't have an account\? sign up|phone number, username,? or email)/],
  ['facebook', /(log in(to| to) facebook|forgotten password\?.*create new account|create new account.*log in)/],
  ['tiktok', /(log in to tiktok|use phone \/ email \/ username)/],
  ['x', /(sign in to x|happening now.*join today)/],
  ['linkedin', /(sign in to (view|see) more|join now to see|welcome to your professional community)/],
  ['threads', /(log in with (your )?instagram|continue with instagram)/],
  ['youtube', /(sign in to (continue to )?youtube|to continue to youtube)/]
]

const norm = (s: string): string =>
  (s || '')
    .replace(/[‘’ʼ′`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

function platformLabel(url: string): string {
  const p = platformOfUrl(url)
  if (p) return PLATFORM_SPECS[p].name
  if (/accounts\.google\.com/i.test(url)) return 'Google'
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'The page'
  } catch {
    return 'The page'
  }
}

function hit(kind: Kind, who: string, what: string): Checkpoint {
  return { kind, reason: `${who} is showing ${what}` }
}

export function detectCheckpoint(p: PageFacts): Checkpoint | null {
  const url = p.url || ''
  const who = platformLabel(url)
  const platform = platformOfUrl(url)

  // 1 · captcha frames (and a captcha page opened directly)
  for (const f of [...(p.frameUrls ?? []), url]) {
    if (!f || /[?&]size=invisible/i.test(f)) continue
    for (const [re, what] of CAPTCHA_FRAMES) if (re.test(f)) return hit('captcha', who, what)
  }

  // 2 · URLs
  for (const r of URL_RULES) {
    if (r.platforms !== 'any' && (!platform || !r.platforms.includes(platform))) continue
    if (r.re.test(url)) return hit(r.kind, who, r.what)
  }
  for (const [re, kind, what] of GOOGLE_RULES) if (re.test(url)) return { kind, reason: what }

  const title = norm(p.title)
  const dialog = norm(p.dialogText ?? '')
  const text = norm(p.text)

  // 3 · strong phrases anywhere
  for (const ph of STRONG) if (ph.re.test(title) || ph.re.test(dialog) || ph.re.test(text)) return hit(ph.kind, who, ph.what)

  // 4 · weak phrases where they are the main message
  const short = text.length > 0 && text.length < SHORT_PAGE
  for (const ph of WEAK) if (ph.re.test(title) || ph.re.test(dialog) || (short && ph.re.test(text))) return hit(ph.kind, who, ph.what)

  // 5 · logged-out landing pages on a platform host
  if (platform) {
    for (const [pl, re] of LOGIN_TEXT) {
      if (pl !== platform) continue
      if (re.test(title) || re.test(dialog) || (short && re.test(text))) return hit('login_wall', who, 'its logged-out page — the brand needs to log in again')
    }
  }
  return null
}
