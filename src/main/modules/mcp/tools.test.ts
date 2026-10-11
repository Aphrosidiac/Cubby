import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { contract } from '@shared/contract'
import { pickAccounts, TOOLS, type BrandRef, type ToolEnv } from './tools'
import { buildAddArgs, buildRemoveArgs, commandLine, pickWindowsCli, quoteArg } from './connect'

const FF: BrandRef = {
  id: 'br_ff',
  name: 'FF',
  accounts: [
    { id: 'acc_ig', platform: 'instagram', handle: 'ffdev' },
    { id: 'acc_tt', platform: 'tiktok', handle: 'ffdev' }
  ]
}

const env = (over: Partial<ToolEnv> = {}): ToolEnv => ({
  brand: (ref) => {
    if (['FF', 'ff', '#1', 'br_ff'].includes(ref)) return FF
    throw new Error(`Brand "${ref}" not found`)
  },
  postBrandId: () => 'br_ff',
  lock: 'br_ff',
  tokenBrandIds: null,
  ...over
})

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) throw new Error('no tool ' + name)
  return t
}

/** Parse args with the tool's zod shape (as the SDK does), then plan. */
function plan(name: string, args: Record<string, unknown>, e = env()) {
  const t = tool(name)
  const parsed = z.object(t.shape).parse(args)
  return t.plan(parsed, e)
}

describe('MCP tool table', () => {
  it('covers every planned tool once', () => {
    const names = TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of ['brands_list', 'brand_open', 'brand_switch', 'brand_close', 'brand_health', 'tabs', 'tab_open', 'tab_select', 'tab_close', 'navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'wait_for', 'screenshot', 'page_text', 'upload', 'media_find', 'post_create', 'post_prepare', 'post_status', 'queue_list', 'flows_list', 'flow_run', 'activity_tail'])
      expect(names).toContain(n)
  })

  it('every command a tool plans is in the contract and its input validates', () => {
    const samples: Record<string, Record<string, unknown>> = {
      brands_list: {}, brand_open: { brand: 'FF' }, brand_close: { brand: 'FF' }, brand_health: { brand: 'FF' }, tabs: { brand: 'FF' },
      tab_open: { brand: 'FF', url: 'https://x.com' }, tab_select: { brand: 'FF', index: 1 }, tab_close: { brand: 'FF' }, navigate: { brand: 'FF', url: 'instagram.com' },
      snapshot: { brand: 'FF' }, click: { brand: 'FF', ref: 'e3' }, type: { brand: 'FF', ref: 'e4', value: 'hi', submit: true }, press: { brand: 'FF', key: 'Enter' },
      scroll: { brand: 'FF' }, wait_for: { brand: 'FF', text: 'Done' }, screenshot: { brand: 'FF' }, page_text: { brand: 'FF' }, upload: { brand: 'FF', paths: ['C:/m/a.mp4'] },
      media_find: { q: 'reel' }, post_create: { brand: 'FF', kind: 'reel', mediaIds: ['m1'], platforms: ['instagram'] }, post_prepare: { postId: 'p1' }, post_status: { postId: 'p1' },
      queue_list: { brand: '#1' }, flows_list: {}, flow_run: { flowId: 'f1', brand: 'FF' }, activity_tail: {}
    }
    for (const t of TOOLS) {
      if (t.name === 'brand_switch') continue
      const p = plan(t.name, samples[t.name])
      expect(p.kind, t.name).toBe('command')
      if (p.kind !== 'command') continue
      const def = contract[p.command]
      expect(def, t.name).toBeTruthy()
      const r = def.input.safeParse(p.input)
      expect(r.success, `${t.name} → ${p.command}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true)
      // every MCP-exposed command must be reachable by a claude token
      expect(def.meta.scope, p.command).toBeTruthy()
      expect(!def.meta.actors || def.meta.actors.includes('claude'), p.command).toBe(true)
    }
  })

  it('maps browser args onto browser.* with the resolved brand id', () => {
    expect(plan('click', { brand: 'ff', ref: 'e12' })).toMatchObject({ command: 'browser.click', input: { brandId: 'br_ff', ref: 'e12' }, brandId: 'br_ff' })
    expect(plan('type', { brand: '#1', selector: '#cap', value: 'Hello', clear: false })).toMatchObject({ command: 'browser.type', input: { brandId: 'br_ff', selector: '#cap', value: 'Hello', clear: false } })
    expect(plan('scroll', { brand: 'FF' })).toMatchObject({ command: 'browser.scroll', input: { dy: 600 } })
    expect(plan('upload', { brand: 'FF', paths: ['/a.mp4'] })).toMatchObject({ command: 'browser.upload', input: { brandId: 'br_ff', paths: ['/a.mp4'] } })
    expect(plan('brand_open', { brand: 'FF' })).toMatchObject({ command: 'brands.open', input: { id: 'br_ff' } })
    expect(plan('brand_switch', { brand: 'FF' })).toEqual({ kind: 'switch', brandId: 'br_ff' })
    expect(plan('flow_run', { flowId: 'f1', brand: 'FF' })).toMatchObject({ command: 'flows.run', input: { id: 'f1', brandIds: ['br_ff'] } })
  })

  it('brand_open never hands Claude the CDP endpoint', () => {
    const p = plan('brand_open', { brand: 'FF' })
    if (p.kind !== 'command' || !p.format) throw new Error('expected a formatter')
    const text = JSON.stringify(p.format({ cdpUrl: 'http://127.0.0.1:9222', wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/x' }, env()))
    expect(text).not.toMatch(/9222|ws:\/\/|cdp/i)
  })

  it('screenshot returns MCP image content', () => {
    const p = plan('screenshot', { brand: 'FF' })
    if (p.kind !== 'command' || !p.format) throw new Error('expected a formatter')
    const c = p.format({ path: 'C:/s/ff.png', base64: 'iVBOR' }, env())
    expect(c[0]).toEqual({ type: 'image', data: 'iVBOR', mimeType: 'image/png' })
  })

  it('post_create picks accounts by platform and refuses foreign ids', () => {
    expect(plan('post_create', { brand: 'FF', kind: 'reel', platforms: ['tiktok'] })).toMatchObject({ command: 'posts.create', input: { brandId: 'br_ff', accountIds: ['acc_tt'], mode: 'draft', assetIds: [] } })
    expect(pickAccounts(FF)).toEqual(['acc_ig', 'acc_tt'])
    expect(() => pickAccounts(FF, ['acc_other'])).toThrow(/do not belong/)
    expect(() => pickAccounts(FF, undefined, ['youtube'])).toThrow(/no account on youtube/)
  })

  it('list outputs are filtered to the token\'s brands', () => {
    const e = env({ tokenBrandIds: ['br_ff'] })
    const p = plan('brands_list', {}, e)
    if (p.kind !== 'command' || !p.format) throw new Error('expected a formatter')
    const rows = [
      { id: 'br_ff', serial: 1, name: 'FF', slug: 'ff', status: 'open', tags: [], groupName: null, approvalRequired: true, accounts: [] },
      { id: 'br_x', serial: 2, name: 'Secret', slug: 'x', status: 'closed', tags: [], groupName: null, approvalRequired: true, accounts: [] }
    ]
    const out = JSON.parse((p.format(rows, e)[0] as { text: string }).text)
    expect(out.map((b: { name: string }) => b.name)).toEqual(['FF'])
    expect(out[0].lockedToThisSession).toBe(true)
  })

  it('declares lock modes: browser tools require the lock, brand_open sets it', () => {
    expect(tool('navigate').lock).toBe('require')
    expect(tool('brand_open').lock).toBe('open')
    expect(tool('brand_switch').lock).toBe('switch')
    expect(tool('brands_list').lock).toBe('none')
  })
})

describe('claude.connect command building', () => {
  const token = 'cub_' + 'A'.repeat(43)
  it('builds remove + add args', () => {
    expect(buildRemoveArgs('user')).toEqual(['mcp', 'remove', 'cubby', '-s', 'user'])
    expect(buildAddArgs('local', 7830, token)).toEqual(['mcp', 'add', '--transport', 'http', '-s', 'local', 'cubby', 'http://127.0.0.1:7830/mcp', '--header', `Authorization: Bearer ${token}`])
  })
  it('quotes for the shell and refuses shell syntax', () => {
    expect(commandLine(buildAddArgs('user', 7820, token))).toBe(`claude mcp add --transport http -s user cubby http://127.0.0.1:7820/mcp --header "Authorization: Bearer ${token}"`)
    expect(() => quoteArg('a & calc')).toThrow(/unsafe/)
    expect(() => quoteArg('"x"')).toThrow(/unsafe/)
    expect(() => quoteArg('%PATH%')).toThrow(/unsafe/)
  })
  it('picks the Windows CLI from `where` output', () => {
    expect(pickWindowsCli('C:\\Users\\a\\AppData\\Roaming\\npm\\claude\r\nC:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd\r\n')).toBe('C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd')
    expect(pickWindowsCli('C:\\a\\claude.cmd\nC:\\b\\.local\\bin\\claude.exe')).toBe('C:\\b\\.local\\bin\\claude.exe')
    expect(pickWindowsCli('')).toBeNull()
  })
})
