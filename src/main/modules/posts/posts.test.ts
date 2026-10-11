import { describe, expect, it } from 'vitest'
import type { MediaAsset, PostStatus } from '@shared/types'
import { captionFor, captionProblems, fitPost } from './fit'
import { afterPrepare, canDo, initialStatus, nextStatus, runOutcome, TERMINAL, TRANSITIONS, timeChangeEvent, transitionError } from './state'

describe('post state machine', () => {
  it('prepare → ready_for_approval → approve → run → posted', () => {
    let s: PostStatus = 'draft'
    s = nextStatus(s, 'prepare')!
    expect(s).toBe('running')
    s = nextStatus(s, afterPrepare('draft', true))!
    expect(s).toBe('ready_for_approval')
    s = nextStatus(s, 'approve')!
    expect(s).toBe('approved')
    s = nextStatus(s, 'run')!
    expect(s).toBe('running')
    expect(nextStatus(s, 'posted')).toBe('posted')
  })
  it('a new time reschedules waiting posts and starts failed / stuck ones over as a draft', () => {
    for (const s of ['draft', 'ready_for_approval', 'approved', 'queued'] as PostStatus[]) expect(timeChangeEvent(s)).toBe('reschedule')
    for (const s of ['failed', 'needs_human'] as PostStatus[]) {
      expect(timeChangeEvent(s)).toBe('edit')
      expect(nextStatus(s, 'edit')).toBe('draft')
    }
    for (const s of ['running', 'posted', 'cancelled'] as PostStatus[]) expect(timeChangeEvent(s)).toBeNull()
  })
  it('reject goes back to draft', () => {
    expect(nextStatus('ready_for_approval', 'reject')).toBe('draft')
  })
  it('cannot approve unless ready', () => {
    for (const s of ['draft', 'approved', 'queued', 'running', 'failed', 'posted'] as PostStatus[]) expect(canDo(s, 'approve')).toBe(false)
  })
  it('editing drops approval but keeps queued posts queued', () => {
    expect(nextStatus('approved', 'edit')).toBe('draft')
    expect(nextStatus('ready_for_approval', 'edit')).toBe('draft')
    expect(nextStatus('queued', 'edit')).toBe('queued')
    expect(nextStatus('failed', 'edit')).toBe('draft')
    expect(canDo('running', 'edit')).toBe(false)
  })
  it('terminal statuses accept nothing', () => {
    for (const s of TERMINAL) expect(Object.keys(TRANSITIONS[s])).toHaveLength(0)
  })
  it('every non-terminal status can be cancelled', () => {
    for (const s of Object.keys(TRANSITIONS) as PostStatus[]) if (!TERMINAL.includes(s)) expect(nextStatus(s, 'cancel')).toBe('cancelled')
  })
  it('the scheduler only runs approved or queued posts; failures can be retried by hand', () => {
    expect(canDo('approved', 'run')).toBe(true)
    expect(canDo('queued', 'run')).toBe(true)
    expect(canDo('failed', 'run')).toBe(true)
    expect(canDo('ready_for_approval', 'run')).toBe(false)
    expect(canDo('posted', 'run')).toBe(false)
  })
  it('re-pacing returns a running post to its waiting status', () => {
    expect(nextStatus('running', 'wait_approved')).toBe('approved')
    expect(nextStatus('running', 'wait_queued')).toBe('queued')
  })
  it('prepare without approval returns to where the post came from', () => {
    expect(afterPrepare('draft', false)).toBe('preview_draft')
    expect(afterPrepare('queued', false)).toBe('preview_queued')
    expect(afterPrepare('queued', true)).toBe('prepared')
    expect(nextStatus('running', 'preview_draft')).toBe('draft')
  })
  it('initial status by mode and approval', () => {
    expect(initialStatus('draft', true)).toEqual({ status: 'draft', prepare: false })
    expect(initialStatus('schedule', true)).toEqual({ status: 'draft', prepare: true })
    expect(initialStatus('now', false)).toEqual({ status: 'queued', prepare: false })
    expect(initialStatus('queue', false)).toEqual({ status: 'queued', prepare: false })
  })
  it('a queued post without approval goes back to draft when the brand starts requiring it', () => {
    expect(nextStatus('queued', 'unapprove')).toBe('draft')
  })
  it('explains refused transitions', () => {
    expect(transitionError('posted', 'edit')).toBe("This post is already posted and can't be edited now.")
  })
})

describe('run outcome', () => {
  const t = (x: Partial<Parameters<typeof runOutcome>[0]>) => ({ targets: 2, posted: 0, failed: 0, needsHuman: 0, repaced: 0, alreadyPosted: 0, ...x })
  it('all posted', () => expect(runOutcome(t({ posted: 2 }), true)).toBe('posted'))
  it('nothing left to do counts as posted', () => expect(runOutcome(t({ targets: 0, alreadyPosted: 2 }), true)).toBe('posted'))
  it('partial failure = failed', () => expect(runOutcome(t({ posted: 1, failed: 1 }), true)).toBe('fail'))
  it('needs_human wins', () => expect(runOutcome(t({ failed: 1, needsHuman: 1 }), false)).toBe('needs_human'))
  it('re-paced accounts keep the post waiting', () => {
    expect(runOutcome(t({ posted: 1, repaced: 1 }), true)).toBe('wait_approved')
    expect(runOutcome(t({ repaced: 2 }), false)).toBe('wait_queued')
  })
  it('a failure is not hidden by re-pacing', () => expect(runOutcome(t({ failed: 1, repaced: 1 }), true)).toBe('fail'))
  it('stopped early (kill switch) waits', () => expect(runOutcome(t({ posted: 1 }), false)).toBe('wait_queued'))
})

const asset = (x: Partial<MediaAsset> & { id: string }): MediaAsset => ({
  path: `C:/m/${x.id}.mp4`,
  filename: `${x.id}.mp4`,
  kind: 'video',
  hash: '',
  durationMs: 20_000,
  width: 1080,
  height: 1920,
  fps: 30,
  codec: 'h264',
  sizeBytes: 10_000_000,
  thumb: null,
  tags: [],
  platformFit: {},
  fitNotes: {},
  addedAt: '',
  missing: false,
  ...x
})
const all = () => true

describe('fit grading', () => {
  const base = { kind: 'reel' as const, caption: 'hello #a', perPlatform: {}, hasRecipe: all }
  it('a 9:16 h264 reel fits IG and TikTok', () => {
    const r = fitPost({ ...base, accounts: [{ id: 'a1', platform: 'instagram' }, { id: 'a2', platform: 'tiktok' }], assetIds: ['v'], assets: [asset({ id: 'v' })] })
    expect(r.map((x) => x.level)).toEqual(['ok', 'ok'])
  })
  it('landscape video is bad for a reel', () => {
    const [r] = fitPost({ ...base, accounts: [{ id: 'a1', platform: 'instagram' }], assetIds: ['v'], assets: [asset({ id: 'v', width: 1920, height: 1080 })] })
    expect(r.level).toBe('bad')
    expect(r.notes.join(' ')).toMatch(/aspect/)
  })
  it('missing recipe is bad', () => {
    const [r] = fitPost({ ...base, hasRecipe: () => false, accounts: [{ id: 'a1', platform: 'instagram' }], assetIds: ['v'], assets: [asset({ id: 'v' })] })
    expect(r.level).toBe('bad')
    expect(r.notes[0]).toMatch(/no recipe for Instagram reels yet/)
  })
  it('unsupported kind is bad', () => {
    const [r] = fitPost({ ...base, kind: 'text', accounts: [{ id: 'a1', platform: 'instagram' }], assetIds: [], assets: [] })
    expect(r.level).toBe('bad')
    expect(r.notes[0]).toMatch(/doesn't support text posts/)
  })
  it('text post on X is fine; too long caption is bad; override wins', () => {
    const acc = [{ id: 'a1', platform: 'x' as const }]
    expect(fitPost({ ...base, kind: 'text', caption: 'hi', accounts: acc, assetIds: [], assets: [] })[0].level).toBe('ok')
    const long = 'x'.repeat(300)
    const r = fitPost({ ...base, kind: 'text', caption: long, accounts: acc, assetIds: [], assets: [] })[0]
    expect(r.level).toBe('bad')
    expect(r.notes.join()).toMatch(/300 characters — X allows 280/)
    expect(fitPost({ ...base, kind: 'text', caption: long, perPlatform: { x: { caption: 'short' } }, accounts: acc, assetIds: [], assets: [] })[0].level).toBe('ok')
  })
  it('too many hashtags is bad', () => {
    const r = fitPost({ ...base, kind: 'text', caption: '#a #b #c #d #e #f', accounts: [{ id: 'a1', platform: 'x' }], assetIds: [], assets: [] })[0]
    expect(r.notes.join()).toMatch(/6 hashtags — X allows 5/)
  })
  it('carousel item count and minimum', () => {
    const imgs = Array.from({ length: 5 }, (_, i) => asset({ id: `i${i}`, kind: 'image', width: 1080, height: 1080, durationMs: null, codec: null }))
    const r = fitPost({ ...base, kind: 'carousel', accounts: [{ id: 'a1', platform: 'x' }], assetIds: imgs.map((a) => a.id), assets: imgs })[0]
    expect(r.level).toBe('bad')
    expect(r.notes.join()).toMatch(/5 files — X Images allows 4/)
    const one = fitPost({ ...base, kind: 'carousel', accounts: [{ id: 'a1', platform: 'instagram' }], assetIds: ['i0'], assets: imgs })[0]
    expect(one.notes.join()).toMatch(/at least 2/)
  })
  it('missing files are bad', () => {
    const r = fitPost({ ...base, accounts: [{ id: 'a1', platform: 'instagram' }], assetIds: ['v', 'gone'], assets: [asset({ id: 'v', missing: true })] })[0]
    expect(r.level).toBe('bad')
    expect(r.notes.join()).toMatch(/not in the media library/)
    expect(r.notes.join()).toMatch(/missing on disk/)
  })
  it('warn level for a slightly-off aspect and a second file', () => {
    const r = fitPost({ ...base, accounts: [{ id: 'a1', platform: 'instagram' }], assetIds: ['v', 'w'], assets: [asset({ id: 'v', width: 1080, height: 1800 }), asset({ id: 'w' })] })[0]
    expect(r.level).toBe('warn')
  })
  it('no media for a reel is bad', () => {
    expect(fitPost({ ...base, accounts: [{ id: 'a1', platform: 'instagram' }], assetIds: [], assets: [] })[0].notes).toContain('attach a video')
  })
  it('caption helpers', () => {
    expect(captionFor('main', { instagram: { caption: '' } }, 'instagram')).toBe('main')
    expect(captionFor('main', { instagram: { caption: 'ig' } }, 'instagram')).toBe('ig')
    expect(captionProblems('threads', '#one #two')).toEqual(['2 hashtags — Threads allows 1'])
  })
})

describe('pickSlot', () => {
  const d = (s: string) => new Date(`2026-10-12T${s}:00.000Z`)
  it('skips slots taken within ±30 min', async () => {
    const { pickSlot } = await import('./slots')
    expect(pickSlot([d('12:00'), d('13:00')], [d('12:25')], () => true)?.toISOString()).toBe(d('13:00').toISOString())
    expect(pickSlot([d('12:00')], [d('12:31')], () => true)?.toISOString()).toBe(d('12:00').toISOString())
    expect(pickSlot([d('12:00')], [d('11:30')], () => true)).toBeNull()
  })
  it('skips slots pacing refuses', async () => {
    const { pickSlot } = await import('./slots')
    expect(pickSlot([d('12:00'), d('13:00')], [], (t) => t.getUTCHours() >= 13)?.toISOString()).toBe(d('13:00').toISOString())
    expect(pickSlot([d('12:00')], [], () => false)).toBeNull()
    expect(pickSlot([], [], () => true)).toBeNull()
  })
})
