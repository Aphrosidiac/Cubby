// Recorder, the Playwright half: inject RECORDER_SCRIPT into the brand's Chrome, collect raw events
// through an exposed binding plus top-frame navigations, and turn them into FlowSteps on stop.
// exposeBinding / addInitScript cannot be undone on a context, so each context is prepared once
// and the page-side flag `__cubbyRecOn` (plus the binding's state answer) turns recording on/off.
import type { BrowserContext, Frame, Page } from 'playwright-core'
import type { FlowStep } from '@shared/types'
import { UserError } from '../../core/errors'
import { newId } from '../../core/ids'
import { activePage, getContext, openBrand } from '../browser'
import { eventsToSteps, RECORDER_SCRIPT, type RawEvent } from './recorder-logic'

interface Recording {
  id: string
  brandId: string
  context: BrowserContext
  events: RawEvent[]
  startUrl: string | null
  detach: (() => void)[]
}

const recordings = new Map<string, Recording>()
const byBrand = new Map<string, string>()
const prepared = new WeakSet<BrowserContext>()

const MAX_EVENTS = 5000

function recordingFor(brandId: string): Recording | null {
  const id = byBrand.get(brandId)
  return id ? (recordings.get(id) ?? null) : null
}

async function prepare(context: BrowserContext, brandId: string): Promise<void> {
  if (prepared.has(context)) return
  await context.exposeBinding('__cubbyRecord', (source: { page: Page; frame: Frame }, e: RawEvent | { kind: 'state' }) => {
    const rec = recordingFor(brandId)
    if (e && e.kind === 'state') return !!rec
    if (!rec || !e || source.frame !== source.page.mainFrame()) return false
    if (rec.events.length < MAX_EVENTS) rec.events.push(e as RawEvent)
    return true
  })
  await context.addInitScript(RECORDER_SCRIPT)
  prepared.add(context)
}

async function setFlag(page: Page, on: boolean): Promise<void> {
  await page.evaluate(`${RECORDER_SCRIPT}; window.__cubbyRecOn = ${on ? 'true' : 'false'};`).catch(() => {})
}

function watchPage(rec: Recording, page: Page): void {
  const onNav = (frame: Frame) => {
    if (frame === page.mainFrame()) rec.events.push({ kind: 'nav', url: frame.url(), ts: Date.now() })
  }
  page.on('framenavigated', onNav)
  rec.detach.push(() => page.off('framenavigated', onNav))
}

export async function recordStart(brandId: string): Promise<string> {
  const existing = recordingFor(brandId)
  if (existing) return existing.id
  await openBrand(brandId, { actor: 'you' })
  const context = await getContext(brandId)
  await prepare(context, brandId)
  const page = await activePage(brandId)
  const rec: Recording = { id: newId('rec_'), brandId, context, events: [], startUrl: page.url() || null, detach: [] }
  recordings.set(rec.id, rec)
  byBrand.set(brandId, rec.id)
  for (const p of context.pages()) {
    watchPage(rec, p)
    await setFlag(p, true)
  }
  const onPage = (p: Page) => watchPage(rec, p)
  context.on('page', onPage)
  rec.detach.push(() => context.off('page', onPage))
  await page.bringToFront().catch(() => {})
  return rec.id
}

export async function recordStop(recordingId: string): Promise<FlowStep[]> {
  const rec = recordings.get(recordingId)
  if (!rec) throw new UserError('That recording is not running (it may have been stopped already)', 'not_found')
  recordings.delete(recordingId)
  byBrand.delete(rec.brandId)
  for (const d of rec.detach) d()
  for (const p of rec.context.pages()) {
    await setFlag(p, false)
  }
  return eventsToSteps(rec.events, () => newId('st_'), rec.startUrl)
}

export function isRecording(brandId: string): boolean {
  return byBrand.has(brandId)
}

/** Drop recordings (app quit). Pages go quiet on their own once the binding answers "off". */
export async function stopAllRecordings(): Promise<void> {
  for (const id of [...recordings.keys()]) {
    await recordStop(id).catch(() => {})
  }
}
