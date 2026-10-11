import { describe, expect, it } from 'vitest'
import type { FlowStep } from '@shared/types'
import { eventsToSteps, type RawEvent } from './recorder-logic'
import { checkCron, countSteps, describeStep, fill, fillStep, nextRunAt, validateSteps } from './steps'

describe('placeholders', () => {
  const vars = { 'brand.name': 'FF', 'media.path': 'C:\\media\\a b.mp4', 'media.filename': 'a b.mp4', index: 2 }

  it('fills known placeholders, tolerant of spaces and case, leaves unknown ones', () => {
    expect(fill('Hi {{brand.name}} #{{ index }} {{Media.Filename}} {{nope}}', vars)).toBe('Hi FF #2 a b.mp4 {{nope}}')
  })

  it('fills every string field of a step but not nested step lists', () => {
    const up: FlowStep = { id: 'u', type: 'upload', selector: 'input[name="{{brand.name}}"]', files: ['{{media.path}}', 'x'] }
    expect(fillStep(up, vars)).toEqual({ id: 'u', type: 'upload', selector: 'input[name="FF"]', files: ['C:\\media\\a b.mp4', 'x'] })
    const loop: FlowStep = { id: 'l', type: 'loop_media', tag: '{{brand.name}}', steps: [{ id: 't', type: 'type', text: '{{media.filename}}' }] }
    const f = fillStep(loop, vars) as Extract<FlowStep, { type: 'loop_media' }>
    expect(f.tag).toBe('FF')
    expect((f.steps[0] as Extract<FlowStep, { type: 'type' }>).text).toBe('{{media.filename}}') // filled later, per pass
    const rec: FlowStep = { id: 'r', type: 'run_recipe', recipe: 'x', params: { caption: 'for {{brand.name}}', nested: { list: ['{{index}}'] } } }
    expect((fillStep(rec, vars) as Extract<FlowStep, { type: 'run_recipe' }>).params).toEqual({ caption: 'for FF', nested: { list: ['2'] } })
  })

  it('does not change the id', () => {
    expect(fillStep({ id: '{{index}}', type: 'press', key: 'Enter' }, vars).id).toBe('{{index}}')
  })
})

describe('validateSteps', () => {
  it('passes a good flow', () => {
    const steps: FlowStep[] = [
      { id: '1', type: 'open_url', url: 'https://example.com' },
      { id: '2', type: 'click', text: 'Next' },
      { id: '3', type: 'loop_media', tag: 'reels', steps: [{ id: '3a', type: 'upload', selector: 'input[type=file]', files: ['{{media.path}}'] }] },
      { id: '4', type: 'run_recipe', recipe: 'check_logins', params: {} }
    ]
    expect(validateSteps(steps, (id) => id === 'check_logins')).toEqual([])
  })

  it('reports each problem with a readable location, including nested steps', () => {
    const steps: FlowStep[] = [
      { id: 'a', type: 'open_url', url: 'example.com' },
      { id: 'b', type: 'click' },
      { id: 'b', type: 'wait', ms: -5 },
      { id: 'c', type: 'if_exists', text: 'Login', then: [{ id: 'c1', type: 'upload', selector: '', files: [] }] },
      { id: 'd', type: 'loop_media', steps: [] },
      { id: 'e', type: 'run_recipe', recipe: 'nope', params: {} },
      { id: 'f', type: 'ask_claude', prompt: '  ' }
    ]
    const issues = validateSteps(steps, () => false)
    const by = (where: string) => issues.filter((i) => i.where === where).map((i) => i.message)
    expect(by('1')).toEqual(['URL must start with https://, http:// or file://'])
    expect(by('2')).toEqual(['needs a selector or a text to look for'])
    expect(by('3')).toEqual(['duplicate step id', 'wait must be between 0 and 30 minutes'])
    expect(by('4.then.1')).toEqual(['needs the file input selector', 'no files picked'])
    expect(by('5')).toEqual(['pick media or a tag to loop over', 'the loop has no steps'])
    expect(by('6')).toEqual(['unknown recipe "nope"'])
    expect(by('7')).toEqual(['the prompt is empty'])
  })

  it('counts and describes steps', () => {
    const steps: FlowStep[] = [{ id: '1', type: 'if_exists', selector: '#x', then: [{ id: '2', type: 'wait', ms: 1500 }], else: [{ id: '3', type: 'press', key: 'Enter' }] }]
    expect(countSteps(steps)).toBe(3)
    expect(describeStep({ id: '1', type: 'wait', ms: 1500 })).toBe('Wait 1.5 s')
    expect(describeStep({ id: '1', type: 'type', text: 'hello', selector: '#q' })).toBe('Type "hello" into "#q"')
  })
})

describe('schedules', () => {
  it('validates cron', () => {
    expect(() => checkCron('0 9 * * *', 'Asia/Kuala_Lumpur')).not.toThrow()
    expect(() => checkCron('every day', 'Asia/Kuala_Lumpur')).toThrow(/not a valid schedule/)
    expect(() => checkCron('61 9 * * *', 'Asia/Kuala_Lumpur')).toThrow()
  })

  it('computes the next run in the settings timezone', () => {
    // 09:00 in Kuala Lumpur (UTC+8) = 01:00 UTC
    const from = new Date('2026-10-11T00:30:00Z')
    expect(nextRunAt('0 9 * * *', 'Asia/Kuala_Lumpur', from)).toBe('2026-10-11T01:00:00.000Z')
    expect(nextRunAt('0 9 * * *', 'Asia/Kuala_Lumpur', new Date('2026-10-11T01:00:00Z'))).toBe('2026-10-12T01:00:00.000Z')
    // weekdays only: Sat 2026-10-10 → next Monday 2026-10-12
    expect(nextRunAt('30 8 * * 1-5', 'UTC', new Date('2026-10-10T12:00:00Z'))).toBe('2026-10-12T08:30:00.000Z')
    // different zone, same wall clock
    expect(nextRunAt('0 9 * * *', 'Europe/London', from)).toBe('2026-10-11T08:00:00.000Z')
  })
})

describe('recorder: events → steps', () => {
  let n = 0
  const id = () => `s${++n}`

  it('coalesces typing in one field, keeps separate fields apart, drops click-caused navigations', () => {
    n = 0
    const ev: RawEvent[] = [
      { kind: 'type', selector: '#q', value: 'h', ts: 1000 },
      { kind: 'type', selector: '#q', value: 'he', ts: 1100 },
      { kind: 'type', selector: '#q', value: 'hello', ts: 1300 },
      { kind: 'press', key: 'Enter', ts: 1400 },
      { kind: 'nav', url: 'https://example.com/search?q=hello', ts: 2200 },
      { kind: 'click', selector: 'role=link[name="Result" s]', label: 'Result', ts: 5000 },
      { kind: 'nav', url: 'https://example.com/result', ts: 5900 },
      { kind: 'type', selector: '#email', value: 'a@b.c', ts: 7000 },
      { kind: 'type', selector: '#name', value: 'Fakhrul', ts: 7100 },
      { kind: 'type', selector: '#email', value: 'a@b.co', ts: 7200 }
    ]
    expect(eventsToSteps(ev, id, 'https://example.com/')).toEqual([
      { id: 's1', type: 'open_url', url: 'https://example.com/' },
      { id: 's2', type: 'type', selector: '#q', text: 'hello', clear: true },
      { id: 's3', type: 'press', key: 'Enter' },
      { id: 's4', type: 'click', selector: 'role=link[name="Result" s]', note: 'Result' },
      { id: 's5', type: 'type', selector: '#email', text: 'a@b.c', clear: true },
      { id: 's6', type: 'type', selector: '#name', text: 'Fakhrul', clear: true },
      { id: 's7', type: 'type', selector: '#email', text: 'a@b.co', clear: true }
    ])
  })

  it('records typed-in URLs as open_url, skips repeats and browser pages, sorts by time', () => {
    n = 0
    const ev: RawEvent[] = [
      { kind: 'nav', url: 'https://b.example/', ts: 9000 },
      { kind: 'nav', url: 'about:blank', ts: 100 },
      { kind: 'nav', url: 'https://a.example/', ts: 3000 },
      { kind: 'nav', url: 'https://a.example/', ts: 3500 }
    ]
    expect(eventsToSteps(ev, id).map((s) => (s.type === 'open_url' ? s.url : s.type))).toEqual(['https://a.example/', 'https://b.example/'])
  })

  it('secret fields record no text; uploads record no paths', () => {
    n = 0
    const out = eventsToSteps(
      [
        { kind: 'type', selector: 'input[name="password"]', value: '', secret: true, ts: 1 },
        { kind: 'upload', selector: 'input[type="file"]', count: 2, ts: 2 }
      ],
      id
    )
    expect(out[0]).toMatchObject({ type: 'type', text: '', note: 'secret field — use Fill login' })
    expect(out[1]).toMatchObject({ type: 'upload', files: [], note: 'recorded uploads keep no file paths — pick the files' })
    // and such a recorded upload does not validate until files are picked
    expect(validateSteps(out).some((i) => i.message === 'no files picked')).toBe(true)
  })
})
