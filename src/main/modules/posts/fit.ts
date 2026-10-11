// Platform-fit grading and content validation for posts (composer live checks + create/update
// validation). Pure: the caller passes the accounts, the found media and a "has recipe" probe.
import { countHashtags, fitTarget, gradeMedia, PLATFORM_SPECS, platformName } from '@shared/platforms'
import type { FitLevel, MediaAsset, PerPlatformOptions, Platform, PostKind } from '@shared/types'

export interface FitAccount {
  id: string
  platform: Platform
  handle?: string
}

export interface FitInput {
  kind: PostKind
  accounts: FitAccount[]
  /** ids the post asks for */
  assetIds: string[]
  /** the media rows that exist (any order) */
  assets: MediaAsset[]
  caption: string
  perPlatform: Partial<Record<Platform, PerPlatformOptions>>
  hasRecipe: (platform: Platform, kind: PostKind) => boolean
}

export interface FitResult {
  accountId: string
  platform: Platform
  level: FitLevel
  notes: string[]
}

const KIND_NAME: Record<PostKind, string> = { reel: 'reels', video: 'videos', image: 'image posts', carousel: 'carousels', text: 'text posts', story: 'stories' }

/** The caption a platform will get: its override wins over the shared caption. */
export function captionFor(caption: string, perPlatform: Partial<Record<Platform, PerPlatformOptions>>, platform: Platform): string {
  const o = perPlatform[platform]?.caption
  return o != null && o !== '' ? o : caption
}

/** Caption problems for one platform (empty = fine). */
export function captionProblems(platform: Platform, text: string): string[] {
  const spec = PLATFORM_SPECS[platform]
  const out: string[] = []
  const len = [...text].length
  if (len > spec.captionMax) out.push(`caption is ${len} characters — ${spec.name} allows ${spec.captionMax}`)
  const tags = countHashtags(text)
  if (tags > spec.hashtagMax) out.push(`${tags} hashtags — ${spec.name} allows ${spec.hashtagMax}`)
  return out
}

/** Grade a post for every account: worst level + notes a person can act on. */
export function fitPost(i: FitInput): FitResult[] {
  const byId = new Map(i.assets.map((a) => [a.id, a]))
  const found = i.assetIds.map((id) => byId.get(id)).filter((a): a is MediaAsset => !!a)
  const missingIds = i.assetIds.length - found.length

  return i.accounts.map((acc) => {
    const notes: string[] = []
    let level: FitLevel = 'ok'
    const worse = (l: FitLevel, note: string) => {
      if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l
      notes.push(note)
    }
    const spec = PLATFORM_SPECS[acc.platform]
    const name = platformName(acc.platform)

    if (!spec.kinds.includes(i.kind)) worse('bad', `${name} doesn't support ${KIND_NAME[i.kind]}`)
    else if (!i.hasRecipe(acc.platform, i.kind)) worse('bad', `no recipe for ${name} ${KIND_NAME[i.kind]} yet — post it by hand`)

    if (missingIds > 0) worse('bad', `${missingIds} file${missingIds === 1 ? ' is' : 's are'} not in the media library`)
    for (const a of found) if (a.missing) worse('bad', `${a.filename} is missing on disk`)

    if (i.kind === 'text') {
      if (found.length) worse('warn', 'text posts ignore attached media')
    } else if (i.kind === 'carousel') {
      if (found.length < 2) worse('bad', 'a carousel needs at least 2 files')
    } else if (found.length === 0) {
      worse('bad', i.kind === 'image' ? 'attach an image' : 'attach a video')
    } else if (found.length > 1) {
      worse('warn', `${name} ${KIND_NAME[i.kind]} use one file — only the first is posted`)
    }

    const target = fitTarget(acc.platform, i.kind)
    if (target && i.kind !== 'text') {
      if (target.maxItems && found.length > target.maxItems) worse('bad', `${found.length} files — ${target.label} allows ${target.maxItems}`)
      const graded = i.kind === 'carousel' ? found : found.slice(0, 1)
      for (const a of graded) {
        const g = gradeMedia(a, target)
        for (const n of g.notes) worse(g.level === 'ok' ? 'ok' : g.level, graded.length > 1 ? `${a.filename}: ${n}` : n)
      }
    }

    for (const p of captionProblems(acc.platform, captionFor(i.caption, i.perPlatform, acc.platform))) worse('bad', p)

    return { accountId: acc.id, platform: acc.platform, level, notes }
  })
}
