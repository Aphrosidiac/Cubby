// The post status machine (PLAN §6.4–6.6) as one table, so every command asks the same question
// ("may this post go from X on event E, and to what?") and the rules are unit-tested in one place.
// Pure — no db, no electron.
//
//   draft ──prepare──▶ running ──prepared──▶ ready_for_approval ──approve──▶ approved ─┐
//     ▲                   │                        │                                    │ due + paced
//     └────── reject ─────┼────────────────────────┘                                    ▼
//   (no approval) queue ──┼──────────────────────────────▶ queued ──────run─────▶ running ──▶ posted
//                         └─▶ failed | needs_human                                  │      failed | needs_human
//   any non-terminal ──cancel──▶ cancelled        edit: approved/ready/failed ─▶ draft  └─▶ re-paced: back to approved/queued
import type { PostStatus } from '@shared/types'

export type PostEvent =
  | 'prepare' // start the prepare recipe (status shows running while it works)
  | 'prepared' // every account prepared, brand requires approval
  | 'preview_draft' // prepared, no approval needed, post came from draft → back to draft
  | 'preview_queued' // prepared, no approval needed, post was queued → back to queued
  | 'approve'
  | 'reject'
  | 'queue' // no approval needed: draft → queued (create with schedule/queue/now)
  | 'run' // publish
  | 'posted' // every target account published
  | 'fail'
  | 'needs_human' // checkpoint / handle check / anything a person must look at
  | 'wait_approved' // run re-paced (or partly done): back to waiting, approval kept
  | 'wait_queued'
  | 'unapprove' // brand now requires approval but this queued post has none
  | 'miss' // due while the computer slept and Settings.catchUp = skip
  | 'cancel'
  | 'edit'
  | 'reschedule'

export const TRANSITIONS: Record<PostStatus, Partial<Record<PostEvent, PostStatus>>> = {
  draft: { prepare: 'running', queue: 'queued', run: 'running', edit: 'draft', reschedule: 'draft', cancel: 'cancelled' },
  ready_for_approval: { approve: 'approved', reject: 'draft', prepare: 'running', edit: 'draft', reschedule: 'ready_for_approval', cancel: 'cancelled' },
  approved: { run: 'running', edit: 'draft', reschedule: 'approved', miss: 'failed', cancel: 'cancelled' },
  queued: { run: 'running', prepare: 'running', edit: 'queued', reschedule: 'queued', unapprove: 'draft', miss: 'failed', cancel: 'cancelled' },
  running: {
    prepared: 'ready_for_approval',
    preview_draft: 'draft',
    preview_queued: 'queued',
    posted: 'posted',
    fail: 'failed',
    needs_human: 'needs_human',
    wait_approved: 'approved',
    wait_queued: 'queued',
    cancel: 'cancelled'
  },
  needs_human: { prepare: 'running', run: 'running', edit: 'draft', cancel: 'cancelled' },
  failed: { prepare: 'running', run: 'running', edit: 'draft', cancel: 'cancelled' },
  posted: {},
  cancelled: {}
}

export const TERMINAL: readonly PostStatus[] = ['posted', 'cancelled']
/** statuses that hold a place in the calendar (used for slot collisions) */
export const ACTIVE: readonly PostStatus[] = ['ready_for_approval', 'approved', 'queued', 'running']
/** statuses the scheduler picks up when due */
export const DUE: readonly PostStatus[] = ['approved', 'queued']

export function nextStatus(from: PostStatus, ev: PostEvent): PostStatus | null {
  return TRANSITIONS[from]?.[ev] ?? null
}

export const canDo = (from: PostStatus, ev: PostEvent): boolean => nextStatus(from, ev) !== null

const LABEL: Record<PostStatus, string> = {
  draft: 'a draft',
  ready_for_approval: 'waiting for approval',
  approved: 'approved',
  queued: 'queued',
  running: 'running',
  needs_human: 'waiting for you',
  failed: 'failed',
  posted: 'already posted',
  cancelled: 'cancelled'
}
const VERB: Record<PostEvent, string> = {
  prepare: 'prepared',
  prepared: 'marked prepared',
  preview_draft: 'marked prepared',
  preview_queued: 'marked prepared',
  approve: 'approved',
  reject: 'rejected',
  queue: 'queued',
  run: 'published',
  posted: 'marked posted',
  fail: 'marked failed',
  needs_human: 'handed to you',
  wait_approved: 're-paced',
  wait_queued: 're-paced',
  unapprove: 'sent back for approval',
  miss: 'marked missed',
  cancel: 'cancelled',
  edit: 'edited',
  reschedule: 'rescheduled'
}

/** A sentence for the person when a transition is not allowed. */
export function transitionError(from: PostStatus, ev: PostEvent): string {
  return `This post is ${LABEL[from]} and can't be ${VERB[ev]} now.`
}

/**
 * Saving a post whose content didn't change: a new time is a reschedule where the table allows it;
 * a failed or stuck post (no reschedule) starts over like an edit (back to draft, approval and
 * error dropped) so it can be sent again.
 */
export function timeChangeEvent(from: PostStatus): 'reschedule' | 'edit' | null {
  if (canDo(from, 'reschedule')) return 'reschedule'
  if (canDo(from, 'edit')) return 'edit'
  return null
}

/** Where a finished prepare lands. */
export function afterPrepare(origin: PostStatus, approvalRequired: boolean): PostEvent {
  if (approvalRequired) return 'prepared'
  return origin === 'queued' ? 'preview_queued' : 'preview_draft'
}

/** Status after create: drafts stay drafts; with approval the post is prepared (from draft) first. */
export function initialStatus(mode: 'draft' | 'schedule' | 'queue' | 'now', approvalRequired: boolean): { status: PostStatus; prepare: boolean } {
  if (mode === 'draft') return { status: 'draft', prepare: false }
  return approvalRequired ? { status: 'draft', prepare: true } : { status: 'queued', prepare: false }
}

export interface RunTally {
  /** accounts this run was meant to publish to (after skipping ones already posted) */
  targets: number
  posted: number
  failed: number
  needsHuman: number
  repaced: number
  /** accounts that had already been posted before this run */
  alreadyPosted: number
}

/**
 * Final event of a publish run. needs_human beats failed beats waiting (re-paced accounts still
 * to go) beats posted — a failure is never auto-retried by the scheduler, because a publish that
 * failed after the click might already be live.
 */
export function runOutcome(t: RunTally, approvalRequired: boolean): PostEvent {
  if (t.needsHuman > 0) return 'needs_human'
  if (t.failed > 0) return 'fail'
  // re-paced, or stopped early (kill switch) with accounts still to go
  if (t.repaced > 0 || t.posted < t.targets) return approvalRequired ? 'wait_approved' : 'wait_queued'
  return 'posted'
}
