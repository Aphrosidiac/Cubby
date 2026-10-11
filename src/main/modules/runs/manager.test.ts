import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, db, openDb } from '../../core/db'
import { GuardrailError } from '../../core/errors'
import { onEvent } from '../../core/events'
import { initPaths, paths } from '../../core/paths'
import { runtime } from '../../core/runtime'
import { abortAll, abortRun, brandBusy, drain, enqueueRun, failStaleRuns, getRun, listRuns, liveRuns, setRunDeps, startRun } from './manager'

let dir = ''
let pageText = 'Home feed'
const notes: { title: string; body: string }[] = []
const fronted: string[] = []

const fakePage = {
  url: () => 'https://www.instagram.com/',
  frames: () => [],
  mainFrame: () => null,
  evaluate: async () => ({ title: 'Instagram', text: pageText, frames: [], dialogText: '' }),
  screenshot: async () => Buffer.from('89504e470d0a1a0a', 'hex')
} as unknown as Page

function addBrand(id: string, name: string): void {
  db.run("INSERT INTO brands (id, serial, name, slug, created_at) VALUES (?, ?, ?, ?, '2026-10-11T00:00:00Z')", id, Number(id.replace(/\D/g, '')) || Math.floor(Math.random() * 1e6), name, id)
}

beforeAll(() => {
  delete process.env.CUBBY_DATA_DIR
  dir = mkdtempSync(join(tmpdir(), 'cubby-runs-'))
  initPaths(dir)
  openDb(paths.db)
  addBrand('br_1', 'FF')
  addBrand('br_2', 'Ascend')
  setRunDeps({
    activePage: async () => fakePage,
    frontBrand: async (id) => void fronted.push(id),
    notify: (n) => void notes.push(n)
  })
})

afterAll(async () => {
  abortAll()
  await drain(2000)
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  pageText = 'Home feed'
  notes.length = 0
  fronted.length = 0
  runtime.killSwitch = false
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('run manager', () => {
  it('runs one at a time per brand (FIFO) and brands in parallel', async () => {
    const order: string[] = []
    const body = (tag: string, ms: number) => async (rt: { sleep(ms: number): Promise<void> }) => {
      order.push(`start ${tag}`)
      await rt.sleep(ms)
      order.push(`end ${tag}`)
      return tag
    }
    const a = enqueueRun({ brandId: 'br_1', actor: 'you', label: 'A' }, body('A', 120))
    const b = enqueueRun({ brandId: 'br_1', actor: 'you', label: 'B' }, body('B', 20))
    const c = enqueueRun({ brandId: 'br_2', actor: 'you', label: 'C' }, body('C', 40))
    expect(a.run.status).toBe('running')
    await sleep(10)
    expect(brandBusy('br_1')?.runId).toBe(a.run.id)
    expect(liveRuns().find((r) => r.runId === b.run.id)?.step).toBe('Waiting for the brand')
    const [ra, rb, rc] = await Promise.all([a.done, b.done, c.done])
    expect([ra.result, rb.result, rc.result]).toEqual(['A', 'B', 'C'])
    expect(ra.run.status).toBe('ok')
    // B started only after A ended; C ran alongside A
    expect(order.indexOf('start B')).toBeGreaterThan(order.indexOf('end A'))
    expect(order.indexOf('start C')).toBeLessThan(order.indexOf('end A'))
    expect(getRun(b.run.id).log.some((l) => /Waiting for "A"/.test(l.msg))).toBe(true)
    expect(brandBusy('br_1')).toBeNull()
  })

  it('abort stops the active run promptly and the queue moves on', async () => {
    const a = enqueueRun({ brandId: 'br_1', actor: 'flow', label: 'long' }, async (rt) => {
      await rt.step('wait a long time', () => rt.sleep(30_000))
      return 'never'
    })
    const b = enqueueRun({ brandId: 'br_1', actor: 'flow', label: 'next' }, async () => 'next ran')
    await sleep(30)
    const t0 = Date.now()
    expect(abortRun(a.run.id)).toBe(true)
    const ra = await a.done
    expect(Date.now() - t0).toBeLessThan(500)
    expect(ra.run.status).toBe('aborted')
    expect(ra.run.error).toBe('Stopped by you')
    expect((await b.done).result).toBe('next ran')
  })

  it('abort races a long non-cooperative wait (a hung Playwright call)', async () => {
    const r = enqueueRun({ brandId: 'br_1', actor: 'you', label: 'hung' }, async (rt) => {
      await rt.step('hung click', () => new Promise(() => {}))
    })
    await sleep(20)
    abortRun(r.run.id)
    const out = await r.done
    expect(out.run.status).toBe('aborted')
  })

  it('aborting a queued run never runs its body', async () => {
    let ran = false
    const a = enqueueRun({ brandId: 'br_2', actor: 'you', label: 'first' }, (rt) => rt.sleep(80))
    const b = enqueueRun({ brandId: 'br_2', actor: 'you', label: 'queued' }, async () => void (ran = true))
    abortRun(b.run.id)
    const rb = await b.done
    await a.done
    expect(ran).toBe(false)
    expect(rb.run.status).toBe('aborted')
  })

  it('abortAll (kill switch) stops everything; the kill switch blocks new agent runs', async () => {
    const a = enqueueRun({ brandId: 'br_1', actor: 'claude', label: 'x' }, (rt) => rt.sleep(10_000))
    const b = enqueueRun({ brandId: 'br_2', actor: 'scheduler', label: 'y' }, (rt) => rt.sleep(10_000))
    const c = enqueueRun({ brandId: 'br_2', actor: 'scheduler', label: 'z' }, (rt) => rt.sleep(10_000))
    await sleep(20)
    runtime.killSwitch = true
    abortAll()
    const res = await Promise.all([a.done, b.done, c.done])
    expect(res.map((r) => r.run.status)).toEqual(['aborted', 'aborted', 'aborted'])
    expect(res[0].run.error).toMatch(/kill switch/)
    expect(() => enqueueRun({ brandId: 'br_1', actor: 'claude', label: 'blocked' }, async () => {})).toThrow(GuardrailError)
    // the person can still run things
    const mine = await startRun({ brandId: 'br_1', actor: 'you', label: 'mine' }, async () => 1)
    expect(mine.run.status).toBe('ok')
  })

  it('external signal aborts the run', async () => {
    const ac = new AbortController()
    const r = enqueueRun({ brandId: 'br_1', actor: 'claude', label: 'mcp', signal: ac.signal }, (rt) => rt.sleep(10_000))
    await sleep(10)
    ac.abort()
    const out = await r.done
    expect(out.run.status).toBe('aborted')
    expect(out.run.error).toBe('Cancelled by the caller')
  })

  it('a failing step is logged with a screenshot and the run fails', async () => {
    const out = await startRun({ brandId: 'br_1', actor: 'you', label: 'breaks' }, async (rt) => {
      await rt.step('fine step', async () => 1)
      await rt.step('click Share', async () => {
        throw new Error('Share button not found')
      })
    })
    expect(out.run.status).toBe('failed')
    expect(out.run.error).toBe('Share button not found')
    const failed = out.run.log.find((l) => l.level === 'error' && l.step === 'click Share')
    expect(failed?.msg).toMatch(/✗ click Share .*Share button not found/)
    expect(failed?.screen && existsSync(failed.screen)).toBe(true)
    expect(out.run.screens).toContain(failed!.screen)
    expect(out.run.log.some((l) => /✓ fine step \(\d+ ms\)/.test(l.msg))).toBe(true)
    // persisted
    const stored = getRun(out.run.id)
    expect(stored.status).toBe('failed')
    expect(stored.log.length).toBe(out.run.log.length)
  })

  it('checkpoint → needs_human, fronts the window, notifies, logs activity', async () => {
    pageText = 'Try Again Later\nWe limit how often you can do certain things on Instagram to protect our community.'
    const out = await startRun({ brandId: 'br_2', actor: 'scheduler', label: 'post reel' }, async (rt) => {
      await rt.step('open composer', () => rt.checkpoint())
      return 'unreachable'
    })
    expect(out.run.status).toBe('needs_human')
    expect(out.error).toBeInstanceOf(GuardrailError)
    expect((out.error as GuardrailError).rule).toBe('checkpoint')
    expect(fronted).toEqual(['br_2'])
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('Cubby needs you')
    expect(notes[0].body).toMatch(/^Ascend: Instagram is showing/)
    const act = db.get<{ action: string; screen: string | null }>("SELECT action, screen FROM activity WHERE action = 'guardrail.checkpoint' ORDER BY id DESC")
    expect(act?.screen && existsSync(act.screen)).toBe(true)
  })

  it('guardUrl blocks off-limits pages for claude / flow but not for you', async () => {
    const bad = 'https://www.instagram.com/accounts/password/change/'
    const flow = await startRun({ brandId: 'br_1', actor: 'flow', label: 'g' }, async (rt) => rt.guardUrl(bad))
    expect(flow.run.status).toBe('failed')
    expect((flow.error as GuardrailError).rule).toBe('off_limits')
    const you = await startRun({ brandId: 'br_1', actor: 'you', label: 'g2' }, async (rt) => rt.guardUrl(bad))
    expect(you.run.status).toBe('ok')
  })

  it('handle-check guardrail ends as needs_human and notifies', async () => {
    const out = await startRun({ brandId: 'br_1', actor: 'scheduler', label: 'post' }, async () => {
      throw new GuardrailError('logged in as @someoneelse, expected @ffdevstudio', 'handle_check')
    })
    expect(out.run.status).toBe('needs_human')
    expect(notes[0]?.body).toMatch(/FF: logged in as @someoneelse/)
  })

  it('emits run.log and runs.changed; batches log writes', async () => {
    const events: string[] = []
    const off = onEvent((name) => void events.push(name))
    const spy = vi.spyOn(db, 'run')
    const out = await startRun({ brandId: 'br_1', actor: 'you', label: 'chatty' }, async (rt) => {
      for (let i = 0; i < 200; i++) rt.log(`line ${i}`)
    })
    off()
    const logWrites = spy.mock.calls.filter((c) => String(c[0]).startsWith('UPDATE runs SET log')).length
    spy.mockRestore()
    expect(out.run.log.filter((l) => l.msg.startsWith('line ')).length).toBe(200)
    expect(logWrites).toBeLessThanOrEqual(6) // 200 entries → a handful of batched writes, not 200
    expect(events.filter((e) => e === 'run.log').length).toBeGreaterThanOrEqual(200)
    expect(events.filter((e) => e === 'runs.changed').length).toBe(2)
  })

  it('lists runs with filters and marks stale running rows as failed', async () => {
    db.run("INSERT INTO runs (id, brand_id, actor, label, status, started_at) VALUES ('run_stale', 'br_2', 'flow', 'old', 'running', '2026-10-01T00:00:00Z')")
    expect(failStaleRuns()).toBe(1)
    const r = getRun('run_stale')
    expect(r.status).toBe('failed')
    expect(r.error).toBe('Cubby closed while this was running')
    expect(listRuns({ brandId: 'br_2', status: 'failed' }).some((x) => x.id === 'run_stale')).toBe(true)
    expect(listRuns({ limit: 3 })).toHaveLength(3)
  })
})
