// Flow engine + recorder script against local fixture pages in headless Google Chrome (no network).
// The recorder wiring here mirrors recorder.ts (exposeBinding + addInitScript + framenavigated);
// recorder.ts itself needs the browser module and is exercised in the app e2e.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FlowStep } from '@shared/types'
import { closeDb, db, openDb } from '../../core/db'
import { GuardrailError } from '../../core/errors'
import { initPaths, paths } from '../../core/paths'
import { abortRun, drain, enqueueRun, setRunDeps, startRun } from '../runs/manager'
import { runSteps, type EngineDeps } from './engine'
import { eventsToSteps, RECORDER_SCRIPT, type RawEvent } from './recorder-logic'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const FIX = join(__dirname, 'fixtures')
const url = (f: string) => 'file:///' + join(FIX, f).replace(/\\/g, '/')

let dir = ''
let browser: Browser
let context: BrowserContext
let page: Page
const notified: string[] = []
let files: { id: string; path: string; filename: string }[] = []

const deps: EngineDeps = {
  openBrand: async () => {},
  closeBrand: async () => {},
  notify: (n) => void notified.push(n.body),
  runRecipe: async () => ({ note: 'recipe ran' }),
  media: (sel) => (sel.tag === 'pics' ? files : []),
  askClaude: async (prompt) => `answer to: ${prompt.slice(0, 20)}`
}
const scope = () => ({ vars: { 'brand.name': 'FF' }, flowName: 'Test flow', brandName: 'FF' })

describe.skipIf(!existsSync(CHROME))('flows on fixtures (headless Chrome)', () => {
  beforeAll(async () => {
    delete process.env.CUBBY_DATA_DIR
    dir = mkdtempSync(join(tmpdir(), 'cubby-flows-'))
    initPaths(dir)
    openDb(paths.db)
    db.run("INSERT INTO brands (id, serial, name, slug, created_at) VALUES ('br_1', 1, 'FF', 'ff', '2026-10-11')")
    files = ['one.jpg', 'two.jpg'].map((f, i) => {
      const p = join(dir, f)
      writeFileSync(p, 'x')
      return { id: `m${i}`, path: p, filename: f }
    })
    browser = await chromium.launch({ executablePath: CHROME, headless: true })
    context = await browser.newContext()
    page = await context.newPage()
    setRunDeps({ activePage: async () => page, frontBrand: async () => {}, notify: () => {} })
  }, 30_000)

  afterAll(async () => {
    await drain(2000)
    await browser?.close()
    closeDb()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs a flow: open_url, type with placeholders, click by text, wait_for, if_exists, loop_media upload, role click, screenshot, ask_claude', async () => {
    const steps: FlowStep[] = [
      { id: '1', type: 'open_url', url: url('form.html') },
      { id: '2', type: 'type', selector: '#name', text: '{{brand.name}} team' },
      { id: '3', type: 'click', text: 'Save' },
      { id: '4', type: 'wait_for', text: 'Saved for', timeoutMs: 5000 },
      { id: '5', type: 'if_exists', selector: '#result', then: [{ id: '5a', type: 'screenshot', label: 'saved' }], else: [{ id: '5b', type: 'notify', message: 'not saved' }] },
      { id: '6', type: 'if_exists', text: 'This text is not on the page', then: [{ id: '6a', type: 'notify', message: 'wrong branch' }] },
      { id: '7', type: 'loop_media', tag: 'pics', steps: [{ id: '7a', type: 'upload', selector: '#file', files: ['{{media.path}}'] }, { id: '7b', type: 'wait_for', text: '{{media.filename}}' }] },
      { id: '8', type: 'click', selector: 'role=button[name="Continue" s]' },
      { id: '9', type: 'ask_claude', prompt: 'Write a caption for {{brand.name}}' },
      { id: '10', type: 'type', selector: '#cap', text: '{{claude}}' },
      { id: '11', type: 'notify', message: 'done for {{brand.name}}' }
    ]
    const out = await startRun({ brandId: 'br_1', actor: 'flow', label: 'flow' }, (rt) => runSteps(rt, steps, scope(), deps))
    if (out.error) throw out.error
    expect(out.run.status).toBe('ok')
    expect(await page.locator('#who').innerText()).toBe('FF team')
    expect(await page.locator('#files').innerText()).toBe('two.jpg') // last loop pass
    expect(await page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks)).toEqual(['go'])
    expect(await page.locator('#cap').inputValue()).toBe('answer to: Write a caption for ')
    expect(notified).toEqual(['done for FF'])
    const shot = out.run.log.find((l) => l.screen)
    expect(shot?.screen && existsSync(shot.screen)).toBe(true)
    const msgs = out.run.log.map((l) => l.msg)
    expect(msgs).toContain('→ not found, skipping')
    expect(msgs.some((m) => /^✓ 7\.2\.1 · Upload 1 file to "#file"/.test(m))).toBe(true)
    expect(msgs.some((m) => /^✓ 3 · Click text "Save" \(\d+/.test(m))).toBe(true)
  }, 60_000)

  it('a failing step fails the run with a screenshot attached', async () => {
    const steps: FlowStep[] = [{ id: '1', type: 'open_url', url: url('form.html') }, { id: '2', type: 'click', selector: '#does-not-exist' }]
    const out = await startRun({ brandId: 'br_1', actor: 'flow', label: 'broken' }, (rt) => runSteps(rt, steps, scope(), { ...deps }))
    expect(out.run.status).toBe('failed')
    const err = out.run.log.find((l) => l.level === 'error' && l.screen)
    expect(err?.msg).toMatch(/2 · Click "#does-not-exist"/)
    expect(existsSync(err!.screen!)).toBe(true)
  }, 40_000)

  it('off-limits URLs stop flow runs', async () => {
    const out = await startRun({ brandId: 'br_1', actor: 'flow', label: 'bad' }, (rt) => runSteps(rt, [{ id: '1', type: 'open_url', url: 'https://www.facebook.com/settings?tab=security' }], scope(), deps))
    expect(out.run.status).toBe('failed')
    expect((out.error as GuardrailError).rule).toBe('off_limits')
  })

  it('abort stops a long wait_for promptly', async () => {
    const r = enqueueRun({ brandId: 'br_1', actor: 'flow', label: 'waits' }, (rt) =>
      runSteps(rt, [{ id: '1', type: 'open_url', url: url('form.html') }, { id: '2', type: 'wait_for', selector: '#never', timeoutMs: 60_000 }], scope(), deps)
    )
    await new Promise((res) => setTimeout(res, 1500))
    const t0 = Date.now()
    abortRun(r.run.id)
    const out = await r.done
    expect(out.run.status).toBe('aborted')
    expect(Date.now() - t0).toBeLessThan(1000)
  }, 30_000)

  it('recorder: captures clicks / typing / uploads / Enter / typed navigations with good selectors, replays them, and goes quiet when stopped', async () => {
    const events: RawEvent[] = []
    let on = false
    await context.exposeBinding('__cubbyRecord', (source: { page: Page; frame: Frame }, e: RawEvent | { kind: 'state' }) => {
      if (e.kind === 'state') return on
      if (on && source.frame === source.page.mainFrame()) events.push(e)
      return true
    })
    await context.addInitScript(RECORDER_SCRIPT)
    const rp = await context.newPage()
    rp.on('framenavigated', (f) => {
      if (on && f === rp.mainFrame()) events.push({ kind: 'nav', url: f.url(), ts: Date.now() })
    })
    await rp.goto(url('form.html'))
    const startUrl = rp.url()
    on = true
    await rp.evaluate(`${RECORDER_SCRIPT}; window.__cubbyRecOn = true;`)

    await rp.locator('#name').pressSequentially('Ann', { delay: 20 })
    await rp.locator('input[name="pw"]').pressSequentially('hunter2', { delay: 10 })
    await rp.locator('#save').click()
    await rp.locator('#gear').click()
    await rp.locator('#go').click()
    await rp.locator('#plain').click()
    const [chooser] = await Promise.all([rp.waitForEvent('filechooser'), rp.locator('#pickBtn').click()])
    await chooser.setFiles([files[0].path])
    await rp.locator('#next').click()
    await rp.waitForURL(/page2\.html$/)
    await rp.waitForTimeout(300)
    await rp.locator('#search').pressSequentially('cubby', { delay: 20 })
    await rp.keyboard.press('Enter')
    await rp.waitForTimeout(1700)
    await rp.goto(url('form.html')) // typed URL → open_url
    await rp.waitForTimeout(300)

    // stop: flag off — later actions are not recorded
    on = false
    await rp.evaluate('window.__cubbyRecOn = false')
    await rp.locator('#gear').click()

    let n = 0
    const steps = eventsToSteps(events, () => `r${++n}`, startUrl)
    const brief = steps.map((s) => {
      if (s.type === 'click') return `click ${s.selector}`
      if (s.type === 'type') return `type ${s.selector}=${s.text}${s.note ? ` (${s.note})` : ''}`
      if (s.type === 'open_url') return `open ${s.url.split('/').pop()}`
      if (s.type === 'press') return `press ${s.key}`
      if (s.type === 'upload') return `upload ${s.selector}`
      return s.type
    })
    expect(brief).toEqual([
      'open form.html',
      'type #name=Ann',
      'type input[name="pw"]= (secret field — use Fill login)',
      'click [data-testid="save-btn"]',
      'click button[aria-label="Settings gear"]',
      'click role=button[name="Continue" s]',
      'click text="Plain text item"',
      'click role=button[name="Pick files" s]',
      'upload #file',
      'click role=link[name="Next page" s]',
      'type #search=cubby',
      'press Enter',
      'open form.html'
    ])
    // the password never left the page
    expect(JSON.stringify(events)).not.toContain('hunter2')

    // replay on a fresh page (the person fills in the upload files after recording)
    const replay = steps
      .filter((s) => !(s.type === 'click' && s.selector === 'role=button[name="Pick files" s]'))
      .map((s) => (s.type === 'upload' ? { ...s, files: [files[1].path] } : s))
      .slice(0, -1)
    // prove the typed name reached the form before the replay navigates on
    replay.splice(replay.findIndex((s) => s.type === 'click' && s.selector === '[data-testid="save-btn"]') + 1, 0, { id: 'chk', type: 'wait_for', text: 'Saved for Ann', timeoutMs: 5000 })
    page = await context.newPage()
    const out = await startRun({ brandId: 'br_1', actor: 'flow', label: 'replay' }, (rt) => runSteps(rt, replay, scope(), deps))
    if (out.error) throw out.error
    expect(await page.locator('#out').innerText()).toBe('Entered: cubby')

    // re-recording works on the same context (binding already exposed)
    events.length = 0
    on = true
    await rp.evaluate(`${RECORDER_SCRIPT}; window.__cubbyRecOn = true;`)
    await rp.locator('#go').click()
    expect(events.filter((e) => e.kind === 'click')).toHaveLength(1)
  }, 60_000)
})
