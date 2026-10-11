// Platform facts in one place: names, URLs, session cookies, media limits.
// Pure data + pure functions; used by main (health, recipes, fit checks) and renderer (composer).
import type { AgeTier, FitLevel, PacingRule, Platform, PostKind } from './types'

export interface PlatformSpec {
  id: Platform
  name: string
  color: string
  home: string
  loginUrl: string
  /** URL used to read cookies for login health */
  cookieUrl: string
  /** all of these must exist and be unexpired for the login to count as ok */
  sessionCookies: string[]
  profileUrl: (handle: string) => string
  kinds: PostKind[]
  captionMax: number
  hashtagMax: number
  /** URL fragments that mean "we are on a login / challenge page" */
  loginPathHints: string[]
}

const h = (s: string) => s.replace(/^@/, '')

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  instagram: {
    id: 'instagram', name: 'Instagram', color: '#d62976',
    home: 'https://www.instagram.com/', loginUrl: 'https://www.instagram.com/accounts/login/',
    cookieUrl: 'https://www.instagram.com', sessionCookies: ['sessionid', 'ds_user_id'],
    profileUrl: (x) => `https://www.instagram.com/${h(x)}/`,
    kinds: ['reel', 'image', 'carousel', 'story'], captionMax: 2200, hashtagMax: 30,
    loginPathHints: ['/accounts/login', '/challenge/', '/accounts/suspended']
  },
  facebook: {
    id: 'facebook', name: 'Facebook', color: '#1877f2',
    home: 'https://www.facebook.com/', loginUrl: 'https://www.facebook.com/login/',
    cookieUrl: 'https://www.facebook.com', sessionCookies: ['c_user', 'xs'],
    profileUrl: (x) => `https://www.facebook.com/${h(x)}`,
    kinds: ['reel', 'video', 'image', 'carousel', 'text', 'story'], captionMax: 63206, hashtagMax: 30,
    loginPathHints: ['/login', '/checkpoint/']
  },
  tiktok: {
    id: 'tiktok', name: 'TikTok', color: '#111111',
    home: 'https://www.tiktok.com/', loginUrl: 'https://www.tiktok.com/login',
    cookieUrl: 'https://www.tiktok.com', sessionCookies: ['sessionid'],
    profileUrl: (x) => `https://www.tiktok.com/@${h(x)}`,
    kinds: ['video', 'reel', 'carousel'], captionMax: 4000, hashtagMax: 30,
    loginPathHints: ['/login']
  },
  youtube: {
    id: 'youtube', name: 'YouTube', color: '#ff0000',
    home: 'https://www.youtube.com/', loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube',
    cookieUrl: 'https://www.youtube.com', sessionCookies: ['__Secure-3PSID'],
    profileUrl: (x) => `https://www.youtube.com/@${h(x)}`,
    kinds: ['video', 'reel'], captionMax: 5000, hashtagMax: 15,
    loginPathHints: ['accounts.google.com/', '/signin']
  },
  x: {
    id: 'x', name: 'X', color: '#000000',
    home: 'https://x.com/home', loginUrl: 'https://x.com/i/flow/login',
    cookieUrl: 'https://x.com', sessionCookies: ['auth_token'],
    profileUrl: (x) => `https://x.com/${h(x)}`,
    kinds: ['text', 'image', 'video', 'carousel'], captionMax: 280, hashtagMax: 5,
    loginPathHints: ['/i/flow/login', '/account/access']
  },
  linkedin: {
    id: 'linkedin', name: 'LinkedIn', color: '#0a66c2',
    home: 'https://www.linkedin.com/feed/', loginUrl: 'https://www.linkedin.com/login',
    cookieUrl: 'https://www.linkedin.com', sessionCookies: ['li_at'],
    profileUrl: (x) => (h(x).startsWith('company/') ? `https://www.linkedin.com/${h(x)}/` : `https://www.linkedin.com/in/${h(x)}/`),
    kinds: ['text', 'image', 'video', 'carousel'], captionMax: 3000, hashtagMax: 10,
    loginPathHints: ['/login', '/checkpoint/', '/authwall']
  },
  threads: {
    id: 'threads', name: 'Threads', color: '#000000',
    home: 'https://www.threads.com/', loginUrl: 'https://www.threads.com/login',
    cookieUrl: 'https://www.threads.com', sessionCookies: ['sessionid'],
    profileUrl: (x) => `https://www.threads.com/@${h(x)}`,
    kinds: ['text', 'image', 'video', 'carousel'], captionMax: 500, hashtagMax: 1,
    loginPathHints: ['/login']
  },
  custom: {
    id: 'custom', name: 'Custom', color: '#8b8981',
    home: 'about:blank', loginUrl: 'about:blank', cookieUrl: '', sessionCookies: [],
    profileUrl: (x) => x,
    kinds: [], captionMax: 100000, hashtagMax: 1000, loginPathHints: []
  }
}

export const platformName = (p: Platform) => PLATFORM_SPECS[p]?.name ?? p

/** Media fit targets — one per platform + kind combination the composer offers. */
export interface FitTarget {
  id: string
  platform: Platform
  kind: PostKind
  label: string
  /** acceptable aspect ratios (w/h) with tolerance; first is preferred */
  aspects: number[]
  minDurationMs?: number
  maxDurationMs?: number
  maxSizeBytes?: number
  codecs?: string[]
  needsVideo?: boolean
  needsImage?: boolean
  maxItems?: number
}

const MB = 1024 * 1024
export const FIT_TARGETS: FitTarget[] = [
  { id: 'instagram_reel', platform: 'instagram', kind: 'reel', label: 'IG Reel', aspects: [9 / 16, 4 / 5, 1], minDurationMs: 3000, maxDurationMs: 15 * 60_000, maxSizeBytes: 4096 * MB, codecs: ['h264', 'hevc'], needsVideo: true },
  { id: 'instagram_image', platform: 'instagram', kind: 'image', label: 'IG Post', aspects: [4 / 5, 1, 1.91], needsImage: true },
  { id: 'instagram_carousel', platform: 'instagram', kind: 'carousel', label: 'IG Carousel', aspects: [4 / 5, 1], maxItems: 20 },
  { id: 'instagram_story', platform: 'instagram', kind: 'story', label: 'IG Story', aspects: [9 / 16], maxDurationMs: 60_000 },
  { id: 'facebook_reel', platform: 'facebook', kind: 'reel', label: 'FB Reel', aspects: [9 / 16], minDurationMs: 3000, maxDurationMs: 90_000, codecs: ['h264', 'hevc'], needsVideo: true },
  { id: 'facebook_video', platform: 'facebook', kind: 'video', label: 'FB Video', aspects: [16 / 9, 9 / 16, 1, 4 / 5], maxDurationMs: 240 * 60_000, needsVideo: true },
  { id: 'facebook_image', platform: 'facebook', kind: 'image', label: 'FB Post', aspects: [1, 4 / 5, 1.91, 16 / 9], needsImage: true },
  { id: 'facebook_carousel', platform: 'facebook', kind: 'carousel', label: 'FB Album', aspects: [1, 4 / 5], maxItems: 10 },
  { id: 'facebook_story', platform: 'facebook', kind: 'story', label: 'FB Story', aspects: [9 / 16], maxDurationMs: 60_000 },
  { id: 'tiktok_video', platform: 'tiktok', kind: 'video', label: 'TikTok', aspects: [9 / 16], minDurationMs: 3000, maxDurationMs: 10 * 60_000, maxSizeBytes: 4096 * MB, codecs: ['h264', 'hevc'], needsVideo: true },
  { id: 'tiktok_reel', platform: 'tiktok', kind: 'reel', label: 'TikTok', aspects: [9 / 16], minDurationMs: 3000, maxDurationMs: 10 * 60_000, codecs: ['h264', 'hevc'], needsVideo: true },
  { id: 'tiktok_carousel', platform: 'tiktok', kind: 'carousel', label: 'TikTok Photos', aspects: [9 / 16, 1, 4 / 5], maxItems: 35 },
  { id: 'youtube_reel', platform: 'youtube', kind: 'reel', label: 'YT Short', aspects: [9 / 16, 1], maxDurationMs: 3 * 60_000, needsVideo: true },
  { id: 'youtube_video', platform: 'youtube', kind: 'video', label: 'YouTube', aspects: [16 / 9], needsVideo: true },
  { id: 'x_video', platform: 'x', kind: 'video', label: 'X Video', aspects: [16 / 9, 1, 9 / 16], maxDurationMs: 140_000, maxSizeBytes: 512 * MB, needsVideo: true },
  { id: 'x_image', platform: 'x', kind: 'image', label: 'X Image', aspects: [16 / 9, 1, 4 / 5], needsImage: true },
  { id: 'x_carousel', platform: 'x', kind: 'carousel', label: 'X Images', aspects: [16 / 9, 1], maxItems: 4 },
  { id: 'linkedin_video', platform: 'linkedin', kind: 'video', label: 'LinkedIn Video', aspects: [16 / 9, 1, 4 / 5, 9 / 16], maxDurationMs: 15 * 60_000, needsVideo: true },
  { id: 'linkedin_image', platform: 'linkedin', kind: 'image', label: 'LinkedIn Image', aspects: [1.91, 1, 4 / 5], needsImage: true },
  { id: 'linkedin_carousel', platform: 'linkedin', kind: 'carousel', label: 'LinkedIn Images', aspects: [1, 4 / 5], maxItems: 20 },
  { id: 'threads_video', platform: 'threads', kind: 'video', label: 'Threads Video', aspects: [9 / 16, 1, 4 / 5, 16 / 9], maxDurationMs: 5 * 60_000, needsVideo: true },
  { id: 'threads_image', platform: 'threads', kind: 'image', label: 'Threads Image', aspects: [4 / 5, 1, 9 / 16], needsImage: true },
  { id: 'threads_carousel', platform: 'threads', kind: 'carousel', label: 'Threads Carousel', aspects: [4 / 5, 1], maxItems: 20 }
]

export function fitTarget(platform: Platform, kind: PostKind): FitTarget | undefined {
  return FIT_TARGETS.find((t) => t.platform === platform && t.kind === kind)
}

export interface MediaFacts {
  kind: 'video' | 'image'
  width: number | null
  height: number | null
  durationMs: number | null
  codec: string | null
  sizeBytes: number
}

/** Grade one media file against one target. Pure. */
export function gradeMedia(m: MediaFacts, t: FitTarget): { level: FitLevel; notes: string[] } {
  const notes: string[] = []
  let level: FitLevel = 'ok'
  const worse = (l: FitLevel) => {
    if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l
  }
  if (t.needsVideo && m.kind !== 'video') { worse('bad'); notes.push('needs a video') }
  if (t.needsImage && m.kind !== 'image') { worse('bad'); notes.push('needs an image') }
  if (m.width && m.height) {
    const r = m.width / m.height
    const best = t.aspects.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), t.aspects[0])
    const off = Math.abs(best - r) / best
    if (off > 0.12) { worse('bad'); notes.push(`aspect ${m.width}×${m.height} doesn't fit (${t.aspects.map(fmtRatio).join(', ')})`) }
    else if (off > 0.03) { worse('warn'); notes.push(`aspect ${fmtRatio(r)} will be cropped to ${fmtRatio(best)}`) }
    else if (best !== t.aspects[0]) { notes.push(`${fmtRatio(best)} works; ${fmtRatio(t.aspects[0])} is preferred`) }
  }
  if (m.kind === 'video' && m.durationMs != null) {
    if (t.minDurationMs && m.durationMs < t.minDurationMs) { worse('bad'); notes.push(`shorter than ${t.minDurationMs / 1000}s`) }
    if (t.maxDurationMs && m.durationMs > t.maxDurationMs) { worse('bad'); notes.push(`longer than ${fmtDur(t.maxDurationMs)}`) }
  }
  if (t.maxSizeBytes && m.sizeBytes > t.maxSizeBytes) { worse('bad'); notes.push(`larger than ${Math.round(t.maxSizeBytes / MB)} MB`) }
  if (m.kind === 'video' && t.codecs && m.codec && !t.codecs.includes(m.codec)) { worse('warn'); notes.push(`codec ${m.codec} — ${t.codecs.join('/')} is safest`) }
  return { level, notes }
}

export function fmtRatio(r: number): string {
  const known: [number, string][] = [[9 / 16, '9:16'], [4 / 5, '4:5'], [1, '1:1'], [16 / 9, '16:9'], [1.91, '1.91:1'], [3 / 4, '3:4'], [4 / 3, '4:3']]
  const k = known.find(([v]) => Math.abs(v - r) / v < 0.02)
  return k ? k[1] : r.toFixed(2)
}

function fmtDur(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)}s`
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length
}

/** Pacing defaults from the 29 Sep 2026 flags (new accounts got human-checked). */
export const DEFAULT_PACING: Record<AgeTier, { minGapMin: number; dailyMax: number; jitterMin: number }> = {
  new: { minGapMin: 60, dailyMax: 3, jitterMin: 10 },
  warm: { minGapMin: 40, dailyMax: 6, jitterMin: 10 },
  established: { minGapMin: 20, dailyMax: 10, jitterMin: 10 }
}

export function defaultPacingRules(): PacingRule[] {
  const out: PacingRule[] = []
  for (const p of Object.keys(PLATFORM_SPECS) as Platform[]) {
    if (p === 'custom') continue
    for (const tier of Object.keys(DEFAULT_PACING) as AgeTier[]) out.push({ platform: p, ageTier: tier, ...DEFAULT_PACING[tier] })
  }
  return out
}

/** Pages Claude may never open or act on (account security, billing, deactivation). */
export const OFF_LIMITS_PATTERNS: RegExp[] = [
  /instagram\.com\/accounts\/(password|two_factor|login_activity|edit|privacy_and_security|remove|access_tool|emailsignup|security)/i,
  /accountscenter\.(instagram|facebook)\.com/i,
  /facebook\.com\/(settings|security|privacy|deactivate|billing|ads\/manager\/billing|business\/settings)/i,
  /tiktok\.com\/setting/i,
  /myaccount\.google\.com/i,
  /accounts\.google\.com\/(signin\/v2\/challenge|b\/\d+\/signoutoptions)/i,
  /youtube\.com\/account/i,
  /(x|twitter)\.com\/settings/i,
  /linkedin\.com\/(mypreferences|psettings|settings)/i,
  /threads\.(net|com)\/settings/i,
  /(billing|payment[s]?-?method|deactivat|delete[-_]?account|close[-_]?account|password[-_]?reset|two[-_]?factor|2fa)/i
]

export function isOffLimits(url: string): boolean {
  return OFF_LIMITS_PATTERNS.some((r) => r.test(url))
}

export function platformOfUrl(url: string): Platform | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host.endsWith('instagram.com')) return 'instagram'
    if (host.endsWith('facebook.com') || host.endsWith('fb.com')) return 'facebook'
    if (host.endsWith('tiktok.com')) return 'tiktok'
    if (host.endsWith('youtube.com') || host === 'studio.youtube.com') return 'youtube'
    if (host === 'x.com' || host.endsWith('twitter.com')) return 'x'
    if (host.endsWith('linkedin.com')) return 'linkedin'
    if (host.endsWith('threads.net') || host.endsWith('threads.com')) return 'threads'
  } catch {
    /* not a URL */
  }
  return null
}
