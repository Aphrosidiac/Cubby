// The flow engine: executes FlowStep[] on a run (RunContext). Electron-free — the brand / notify /
// recipe / media / Claude hooks come in through EngineDeps so tests can drive it with a plain page.
import type { Locator, Page } from 'playwright-core'
import type { FlowStep } from '@shared/types'
import { UserError } from '../../core/errors'
import type { RunContext } from '../runs/manager'
import { describeStep, fill, fillStep, type Vars } from './steps'

export interface MediaRef {
  id: string
  path: string
  filename: string
}

export interface EngineDeps {
  openBrand(brandId: string): Promise<unknown>
  closeBrand(brandId: string): Promise<void>
  notify(n: { title: string; body: string; path?: string }): void
  runRecipe(rt: RunContext, id: string, params: Record<string, unknown>): Promise<{ url?: string | null; screen?: string | null; note?: string }>
  media(sel: { assetIds?: string[]; tag?: string }): MediaRef[]
  askClaude(prompt: string, signal: AbortSignal): Promise<string>
}

export interface Scope {
  vars: Vars
  flowName: string
  brandName: string
}

const CLICK_TIMEOUT = 15_000
const WAIT_FOR_TIMEOUT = 30_000
const IF_EXISTS_TIMEOUT = 3_000

/** Element for a step: a Playwright selector, or visible text (exact match preferred over contains). */
async function locate(rt: RunContext, page: Page, s: { selector?: string; text?: string }, timeout: number): Promise<Locator> {
  if (s.selector?.trim()) {
    const loc = page.locator(s.selector.trim()).first()
    await rt.race(loc.waitFor({ state: 'visible', timeout }))
    return loc
  }
  const text = (s.text ?? '').trim()
  if (!text) throw new UserError('This step needs a selector or a text to look for')
  const exact = page.getByText(text, { exact: true }).first()
  const loose = page.getByText(text).first()
  const until = Date.now() + timeout
  for (;;) {
    rt.throwIfAborted()
    if (await exact.isVisible().catch(() => false)) return exact
    if (await loose.isVisible().catch(() => false)) return loose
    if (Date.now() > until) throw new UserError(`Text "${text}" did not appear within ${Math.round(timeout / 1000)} s`)
    await rt.sleep(200)
  }
}

async function exists(rt: RunContext, page: Page, s: { selector?: string; text?: string }): Promise<boolean> {
  try {
    await locate(rt, page, s, IF_EXISTS_TIMEOUT)
    return true
  } catch (e) {
    if (rt.signal.aborted) throw e
    return false
  }
}

/** Run a list of steps in order. `path` prefixes step names for nested lists ("4.2"). */
export async function runSteps(rt: RunContext, steps: FlowStep[], scope: Scope, deps: EngineDeps, path = ''): Promise<void> {
  for (const [i, raw] of steps.entries()) {
    rt.throwIfAborted()
    const s = fillStep(raw, scope.vars)
    const name = `${path}${i + 1} · ${describeStep(s)}`
    if (s.type === 'if_exists') {
      const page = await rt.page()
      const yes = await rt.step(name, () => exists(rt, page, s))
      rt.log(yes ? '→ found, running "then"' : s.else?.length ? '→ not found, running "else"' : '→ not found, skipping')
      const branch = yes ? s.then : (s.else ?? [])
      if (branch.length) {
        await runSteps(rt, branch, scope, deps, `${path}${i + 1}.${yes ? 'then' : 'else'}.`)
      }
      continue
    }
    if (s.type === 'loop_media') {
      const items = await rt.step(name, async () => {
        const found = deps.media({ assetIds: s.assetIds, tag: s.tag })
        if (!found.length) rt.log(s.tag ? `No media tagged "${s.tag}"` : 'None of the picked media is in the library any more', 'warn')
        else rt.log(`${found.length} media file${found.length === 1 ? '' : 's'}`)
        return found
      })
      for (const [n, m] of items.entries()) {
        rt.throwIfAborted()
        const child: Scope = { ...scope, vars: { ...scope.vars, 'media.path': m.path, 'media.filename': m.filename, 'media.id': m.id, index: n + 1 } }
        rt.log(`Loop ${n + 1}/${items.length}: ${m.filename}`)
        await runSteps(rt, s.steps, child, deps, `${path}${i + 1}.${n + 1}.`)
      }
      continue
    }
    await rt.step(name, () => runOne(rt, s, scope, deps))
  }
}

async function runOne(rt: RunContext, s: FlowStep, scope: Scope, deps: EngineDeps): Promise<void> {
  switch (s.type) {
    case 'open_brand':
      await rt.race(deps.openBrand(rt.brandId))
      return
    case 'close_brand':
      await rt.race(deps.closeBrand(rt.brandId))
      return
    case 'open_url': {
      const url = s.url.trim()
      rt.guardUrl(url)
      const page = await rt.page()
      await rt.race(page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }))
      await rt.checkpoint()
      return
    }
    case 'click': {
      const page = await rt.page()
      const el = await locate(rt, page, s, CLICK_TIMEOUT)
      await rt.race(el.click({ timeout: CLICK_TIMEOUT }))
      await rt.sleep(150)
      rt.guardUrl(page.url())
      await rt.checkpoint()
      return
    }
    case 'type': {
      const page = await rt.page()
      if (!s.selector?.trim()) {
        await rt.race(page.keyboard.type(s.text, { delay: 15 }))
        return
      }
      const el = await locate(rt, page, s, CLICK_TIMEOUT)
      if (s.clear === false) {
        await rt.race(el.click({ timeout: CLICK_TIMEOUT }))
        await rt.race(page.keyboard.type(s.text, { delay: 15 }))
      } else {
        await rt.race(el.fill(s.text, { timeout: CLICK_TIMEOUT }))
      }
      return
    }
    case 'press': {
      const page = await rt.page()
      await rt.race(page.keyboard.press(s.key))
      await rt.sleep(150)
      rt.guardUrl(page.url())
      await rt.checkpoint()
      return
    }
    case 'scroll': {
      const page = await rt.page()
      await rt.race(page.mouse.wheel(0, s.dy))
      await rt.sleep(200)
      return
    }
    case 'upload': {
      const files = s.files.map((f) => f.trim()).filter(Boolean)
      if (!files.length) throw new UserError('The upload step has no files — pick them in the flow editor')
      const page = await rt.page()
      // file inputs are usually hidden; attached is enough for setInputFiles (never the OS dialog)
      const input = page.locator(s.selector.trim()).first()
      await rt.race(input.waitFor({ state: 'attached', timeout: CLICK_TIMEOUT }))
      await rt.race(input.setInputFiles(files, { timeout: CLICK_TIMEOUT }))
      rt.log(`Attached ${files.map((f) => f.split(/[\\/]/).pop()).join(', ')}`)
      return
    }
    case 'wait_for': {
      const page = await rt.page()
      await locate(rt, page, s, s.timeoutMs ?? WAIT_FOR_TIMEOUT)
      return
    }
    case 'wait':
      await rt.sleep(s.ms)
      return
    case 'screenshot':
      await rt.screenshot(s.label || 'flow')
      return
    case 'run_recipe': {
      const r = await deps.runRecipe(rt, s.recipe, s.params)
      if (r.url) rt.log(`Post URL: ${r.url}`)
      if (r.note) rt.log(r.note)
      return
    }
    case 'ask_claude': {
      const prompt = fill(s.prompt, scope.vars)
      const answer = await rt.race(deps.askClaude(prompt, rt.signal))
      scope.vars.claude = answer
      rt.log(`Claude: ${answer.length > 4000 ? answer.slice(0, 4000) + '…' : answer}`)
      return
    }
    case 'notify':
      deps.notify({ title: `${scope.flowName} · ${scope.brandName}`, body: s.message, path: `/runs/${rt.runId}` })
      rt.log(`Notified: ${s.message}`)
      return
    case 'if_exists':
    case 'loop_media':
      // handled by runSteps (they own nested lists)
      return
  }
}
