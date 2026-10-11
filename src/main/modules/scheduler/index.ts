// Scheduler (PLAN §10): a 30 s tick (+ one on wake from sleep) that publishes due posts through
// invoke('posts.run', …, { actor: 'scheduler' }) so Activity and guardrails apply exactly as for any
// other door; starts due flows; and fires the daily backup on Settings.backup.cron.
//  - due = approved/queued with scheduledAt <= now (null = as soon as possible)
//  - quiet hours (Settings.quietHours, timezone-aware, may cross midnight) hold every post until the
//    window ends; flows and backups are not held
//  - missed = due more than 10 min ago with no tick since it came due (machine asleep / app closed):
//    Settings.catchUp 'skip' → failed, 'run' → run (pacing re-paces naturally)
//  - brands run in parallel, one post per brand at a time; a post is never run by two ticks
//  - the kill switch stops all of it
// Implements commands: none
import { Cron } from 'croner'
import { db } from '../../core/db'
import { on } from '../../core/events'
import { invoke } from '../../core/registry'
import { runtime } from '../../core/runtime'
import { getSettings } from '../../core/settings'
import { runDueFlows } from '../flows'
import { isPostBusy, markMissed } from '../posts'
import { quietHoursState, safeTz } from './time'

const TICK_MS = 30_000
const MISSED_MS = 10 * 60_000

let timer: NodeJS.Timeout | null = null
let firstTick: NodeJS.Timeout | null = null
let backupJob: Cron | null = null
let offSettings: (() => void) | null = null
let offResume: (() => void) | null = null
let ticking = false
let flowsRunning = false
/** time of the previous tick; null until the first one (so anything >10 min overdue at launch is "missed") */
let lastTickAt: number | null = null
/** posts this scheduler has started and not seen finish */
const inFlight = new Set<string>()
/** brands with a scheduler-started post in flight */
const brandsBusy = new Set<string>()

interface DueRow {
  id: string
  brand_id: string
  scheduled_at: string | null
}

/** One scheduler pass. Exported for tests / a manual "check now". */
export async function tick(now: Date = new Date()): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    if (runtime.killSwitch) return
    const s = getSettings()
    const tz = safeTz(s.timezone)

    if (!flowsRunning) {
      flowsRunning = true
      runDueFlows(now)
        .catch((e) => console.error('[scheduler] flows failed', e))
        .finally(() => (flowsRunning = false))
    }

    if (quietHoursState(now, s.quietHours, tz).quiet) return

    const nowIso = now.toISOString()
    const due = db.all<DueRow>(
      `SELECT p.id, p.brand_id, p.scheduled_at FROM posts p JOIN brands b ON b.id = p.brand_id
       WHERE p.status IN ('approved','queued') AND (p.scheduled_at IS NULL OR p.scheduled_at <= ?) AND b.deleted_at IS NULL
       ORDER BY COALESCE(p.scheduled_at, p.updated_at), p.created_at`,
      nowIso
    )
    if (!due.length) return
    // brands already busy with a post (a run started by you, a prepare, or an earlier tick)
    const running = new Set(db.all<{ brand_id: string }>("SELECT DISTINCT brand_id FROM posts WHERE status = 'running'").map((r) => r.brand_id))

    for (const p of due) {
      if (inFlight.has(p.id) || isPostBusy(p.id)) continue
      const sched = p.scheduled_at ? new Date(p.scheduled_at).getTime() : null
      const missed = sched != null && sched < now.getTime() - MISSED_MS && (lastTickAt == null || sched > lastTickAt)
      if (missed && s.catchUp === 'skip') {
        markMissed(p.id)
        continue
      }
      if (brandsBusy.has(p.brand_id) || running.has(p.brand_id)) continue
      brandsBusy.add(p.brand_id)
      running.add(p.brand_id)
      inFlight.add(p.id)
      invoke('posts.run', { id: p.id }, { actor: 'scheduler' })
        .catch((e) => console.warn('[scheduler] post', p.id, 'did not run:', e instanceof Error ? e.message : e))
        .finally(() => {
          inFlight.delete(p.id)
          brandsBusy.delete(p.brand_id)
        })
    }
  } catch (e) {
    console.error('[scheduler] tick failed', e)
  } finally {
    lastTickAt = now.getTime()
    ticking = false
  }
}

/** (Re)create the daily backup job from Settings.backup. */
function scheduleBackup(): void {
  backupJob?.stop()
  backupJob = null
  const s = getSettings()
  if (!s.backup.enabled) return
  try {
    backupJob = new Cron(s.backup.cron, { timezone: safeTz(s.timezone), unref: true, protect: true, catch: (e) => console.error('[scheduler] backup job failed', e) }, async () => {
      if (runtime.killSwitch) return
      await invoke('backup.run', {}, { actor: 'scheduler' }).catch((e) => console.warn('[scheduler] backup failed:', e instanceof Error ? e.message : e))
    })
  } catch (e) {
    console.warn(`[scheduler] backup schedule "${s.backup.cron}" is not a valid cron expression`, e)
  }
}

export function start(): void {
  timer = setInterval(() => void tick(), TICK_MS)
  timer.unref()
  firstTick = setTimeout(() => void tick(), 5_000)
  firstTick.unref()
  scheduleBackup()
  let lastBackupKey = JSON.stringify([getSettings().backup, getSettings().timezone])
  offSettings = on('settings.changed', (s) => {
    const key = JSON.stringify([s.backup, s.timezone])
    if (key !== lastBackupKey) {
      lastBackupKey = key
      scheduleBackup()
    }
  })
  // wake from sleep: tick right away (electron imported lazily so this module stays light)
  import('electron')
    .then(({ powerMonitor }) => {
      const onResume = () => void tick()
      powerMonitor.on('resume', onResume)
      offResume = () => powerMonitor.removeListener('resume', onResume)
    })
    .catch(() => {})
}

export async function stop(): Promise<void> {
  if (timer) clearInterval(timer)
  if (firstTick) clearTimeout(firstTick)
  timer = firstTick = null
  backupJob?.stop()
  backupJob = null
  offSettings?.()
  offResume?.()
  offSettings = offResume = null
}
