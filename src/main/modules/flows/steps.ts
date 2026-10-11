// Pure flow-step helpers: placeholder substitution, validation, one-line descriptions, schedules.
// No Electron / Playwright imports — unit-tested.
import { Cron } from 'croner'
import type { FlowStep } from '@shared/types'

/** Values for {{…}} placeholders. Keys are dotted paths: brand.name, media.path, media.filename, index, claude. */
export type Vars = Record<string, string | number | undefined>

const PH = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi

/** Replace known {{placeholders}}; unknown ones are left as typed so the person sees them. */
export function fill(s: string, vars: Vars): string {
  return s.replace(PH, (m, key: string) => {
    const v = vars[key.toLowerCase()]
    return v === undefined || v === null ? m : String(v)
  })
}

function fillDeep(v: unknown, vars: Vars): unknown {
  if (typeof v === 'string') return fill(v, vars)
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, vars))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, vars)]))
  return v
}

const NESTED = new Set(['then', 'else', 'steps'])

/**
 * Substitute placeholders in a step's own fields. Nested step lists (if_exists.then/else,
 * loop_media.steps) are NOT touched — they are filled when they run, with their own scope
 * (inside a loop {{media.path}} changes every pass).
 */
export function fillStep<S extends FlowStep>(step: S, vars: Vars): S {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(step)) out[k] = NESTED.has(k) || k === 'id' ? v : fillDeep(v, vars)
  return out as S
}

export function describeStep(s: FlowStep): string {
  const q = (x: string, n = 50) => `"${x.length > n ? x.slice(0, n - 1) + '…' : x}"`
  switch (s.type) {
    case 'open_brand': return 'Open brand'
    case 'open_url': return `Open ${s.url}`
    case 'click': return `Click ${s.selector ? q(s.selector) : s.text ? `text ${q(s.text)}` : '?'}`
    case 'type': return `Type ${q(s.text, 30)}${s.selector ? ` into ${q(s.selector, 40)}` : ''}`
    case 'press': return `Press ${s.key}`
    case 'scroll': return `Scroll ${s.dy > 0 ? 'down' : 'up'} ${Math.abs(s.dy)}px`
    case 'upload': return `Upload ${s.files.length} file${s.files.length === 1 ? '' : 's'} to ${q(s.selector, 40)}`
    case 'wait_for': return `Wait for ${s.selector ? q(s.selector) : `text ${q(s.text ?? '')}`}`
    case 'wait': return `Wait ${s.ms >= 1000 ? `${s.ms / 1000} s` : `${s.ms} ms`}`
    case 'screenshot': return `Screenshot${s.label ? ` ${q(s.label)}` : ''}`
    case 'if_exists': return `If ${s.selector ? q(s.selector) : `text ${q(s.text ?? '')}`} exists`
    case 'loop_media': return `For each media ${s.tag ? `tagged ${q(s.tag)}` : `(${s.assetIds?.length ?? 0} picked)`}`
    case 'run_recipe': return `Run recipe ${s.recipe}`
    case 'ask_claude': return `Ask Claude ${q(s.prompt, 40)}`
    case 'notify': return `Notify ${q(s.message, 40)}`
    case 'close_brand': return 'Close brand'
  }
}

export interface StepIssue {
  stepId: string
  /** 1-based path like "3" or "4.then.2" */
  where: string
  message: string
}

/**
 * Problems that would make a step fail before it touches the page. `recipeExists` lets the caller
 * check recipe ids without importing the recipe registry here.
 */
export function validateSteps(steps: FlowStep[], recipeExists: (id: string) => boolean = () => true, prefix = ''): StepIssue[] {
  const issues: StepIssue[] = []
  const ids = new Set<string>()
  steps.forEach((s, i) => {
    const where = prefix + String(i + 1)
    const bad = (message: string) => issues.push({ stepId: s.id, where, message })
    if (!s.id) bad('step has no id')
    else if (ids.has(s.id)) bad('duplicate step id')
    ids.add(s.id)
    switch (s.type) {
      case 'open_url':
        if (!s.url.trim()) bad('URL is empty')
        else if (!/^(https?:|file:|about:|\{\{)/i.test(s.url.trim())) bad('URL must start with https://, http:// or file://')
        break
      case 'click':
      case 'wait_for':
      case 'if_exists':
        if (!s.selector?.trim() && !s.text?.trim()) bad('needs a selector or a text to look for')
        break
      case 'type':
        if (s.text === undefined) bad('nothing to type')
        break
      case 'press':
        if (!s.key.trim()) bad('no key given')
        break
      case 'upload':
        if (!s.selector.trim()) bad('needs the file input selector')
        if (!s.files.filter((f) => f.trim()).length) bad('no files picked')
        break
      case 'wait':
        if (!(s.ms >= 0) || s.ms > 30 * 60_000) bad('wait must be between 0 and 30 minutes')
        break
      case 'scroll':
        if (!Number.isFinite(s.dy)) bad('scroll amount must be a number')
        break
      case 'loop_media':
        if (!s.tag?.trim() && !s.assetIds?.length) bad('pick media or a tag to loop over')
        if (!s.steps.length) bad('the loop has no steps')
        break
      case 'run_recipe':
        if (!recipeExists(s.recipe)) bad(`unknown recipe "${s.recipe}"`)
        break
      case 'ask_claude':
        if (!s.prompt.trim()) bad('the prompt is empty')
        break
      case 'notify':
        if (!s.message.trim()) bad('the message is empty')
        break
    }
    if (s.type === 'if_exists') {
      issues.push(...validateSteps(s.then, recipeExists, `${where}.then.`))
      if (s.else) issues.push(...validateSteps(s.else, recipeExists, `${where}.else.`))
    }
    if (s.type === 'loop_media') issues.push(...validateSteps(s.steps, recipeExists, `${where}.loop.`))
  })
  return issues
}

/** Count steps including nested ones (for limits / UI). */
export function countSteps(steps: FlowStep[]): number {
  let n = 0
  for (const s of steps) {
    n++
    if (s.type === 'if_exists') n += countSteps(s.then) + countSteps(s.else ?? [])
    if (s.type === 'loop_media') n += countSteps(s.steps)
  }
  return n
}

// ── schedules ────────────────────────────────────────────────────────────────
/** Throws a person-readable message when the cron expression is not valid. */
export function checkCron(expr: string, timezone: string): void {
  try {
    new Cron(expr, { timezone, paused: true }).stop()
  } catch (e) {
    throw new Error(`"${expr}" is not a valid schedule (${e instanceof Error ? e.message : e}). Use cron like "0 9 * * *" for every day at 09:00.`)
  }
}

/** Next run strictly after `from`, in the given IANA timezone; null when the schedule never fires again. */
export function nextRunAt(expr: string, timezone: string, from: Date = new Date()): string | null {
  const c = new Cron(expr, { timezone, paused: true })
  try {
    return c.nextRun(from)?.toISOString() ?? null
  } finally {
    c.stop()
  }
}
