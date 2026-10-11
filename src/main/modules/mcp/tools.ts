// MCP tool table (PLAN §8): each tool maps Claude's arguments onto one CORE command. Kept free of
// Electron and the MCP SDK so the argument → command mapping is unit-tested; modules/mcp/index.ts
// registers these on each session's McpServer and adds the brand lock + invoke().
import { z } from 'zod'
import type { CommandName } from '@shared/contract'
import { PLATFORMS, POST_KINDS, type Platform } from '@shared/types'
import { UserError } from '../../core/errors'

export interface BrandRef {
  id: string
  name: string
  accounts: { id: string; platform: Platform; handle: string }[]
}

/** What a tool may ask of its session while planning. Throws UserError for unknown / forbidden refs. */
export interface ToolEnv {
  brand(ref: string): BrandRef
  /** brand id a post belongs to */
  postBrandId(postId: string): string
  lock: string | null
  tokenBrandIds: readonly string[] | null
}

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export type Plan =
  | {
      kind: 'command'
      command: CommandName
      input: Record<string, unknown>
      /** brand the call acts on (for the lock check) */
      brandId: string | null
      format?: (out: unknown, env: ToolEnv) => Content[]
    }
  /** handled by the session itself (brand_switch) */
  | { kind: 'switch'; brandId: string }

/**
 * require: the session must already be locked to the named brand (brand_open first)
 * open: sets the lock when there is none (brand_open)
 * switch: moves the lock (brand_switch)
 * none: read-only; allowed without a lock, but a set lock still applies
 */
export type LockMode = 'require' | 'open' | 'switch' | 'none'

export interface ToolSpec {
  name: string
  title: string
  description: string
  shape: Record<string, z.ZodType>
  readOnly: boolean
  lock: LockMode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plan(args: any, env: ToolEnv): Plan
}

const brand = z.string().min(1).describe('Brand name, slug, id or #serial (see brands_list)')
const ref = z.string().optional().describe('Element ref from the latest snapshot, e.g. "f3e12" (preferred)')
const selector = z.string().optional().describe('CSS / Playwright selector (when there is no ref)')
const text = z.string().optional().describe('Visible text of the element (first visible match)')

export const json = (v: unknown): Content[] => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]

const allowedBrand = (env: ToolEnv, id: string | null): boolean => !env.tokenBrandIds || (id !== null && env.tokenBrandIds.includes(id))

function cmd(command: CommandName, input: Record<string, unknown>, brandId: string | null, format?: (out: unknown, env: ToolEnv) => Content[]): Plan {
  return { kind: 'command', command, input, brandId, format }
}

/** Accounts for a post: explicit ids, or the brand's accounts on the named platforms. */
export function pickAccounts(b: BrandRef, accountIds?: string[], platforms?: Platform[]): string[] {
  if (accountIds?.length) {
    const own = new Set(b.accounts.map((a) => a.id))
    const bad = accountIds.filter((id) => !own.has(id))
    if (bad.length) throw new UserError(`accounts ${bad.join(', ')} do not belong to ${b.name}`)
    return accountIds
  }
  const ps = platforms?.length ? platforms : null
  const ids = b.accounts.filter((a) => !ps || ps.includes(a.platform)).map((a) => a.id)
  if (!ids.length) throw new UserError(ps ? `${b.name} has no account on ${ps.join(', ')}` : `${b.name} has no accounts — the person adds them in Cubby`)
  return ids
}

interface BrandListRow {
  id: string
  serial: number
  name: string
  slug: string
  status: string
  tags: string[]
  groupName: string | null
  approvalRequired: boolean
  accounts: { id: string; platform: string; handle: string; loginState: string }[]
}

export const TOOLS: ToolSpec[] = [
  // ── Brands ──────────────────────────────────────────────────────────────────
  {
    name: 'brands_list',
    title: 'List brands',
    description: 'List the brands (each is its own sealed Chrome profile) with their accounts, login state and open/closed status. Shows which brand this session is locked to.',
    shape: { q: z.string().optional().describe('Filter by name, handle, tag or serial') },
    readOnly: true,
    lock: 'none',
    plan: (a, env) =>
      cmd('brands.list', { filter: a.q ? { q: a.q } : {} }, null, (out, e) =>
        json(
          (out as BrandListRow[])
            .filter((b) => allowedBrand(e, b.id))
            .map((b) => ({
              id: b.id, serial: `#${b.serial}`, name: b.name, slug: b.slug, status: b.status, group: b.groupName, tags: b.tags,
              approvalRequired: b.approvalRequired, lockedToThisSession: env.lock === b.id,
              accounts: b.accounts.map((x) => ({ id: x.id, platform: x.platform, handle: x.handle, loginState: x.loginState }))
            }))
        )
      )
  },
  {
    name: 'brand_open',
    title: 'Open brand',
    description: 'Open (or reuse) a brand\'s Chrome window and lock this session to that brand. Every later tool call must name this brand until you call brand_switch.',
    shape: { brand },
    readOnly: false,
    lock: 'open',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('brands.open', { id: b.id }, b.id, () => json({ opened: true, brand: b.name, lockedTo: b.name, next: 'Call snapshot to see the active tab.' }))
    }
  },
  {
    name: 'brand_switch',
    title: 'Switch brand',
    description: 'Move this session\'s brand lock to another brand (explicit — only when the person asked to work in that brand). Does not open it; call brand_open next if it is closed.',
    shape: { brand },
    readOnly: false,
    lock: 'switch',
    plan: (a, env) => ({ kind: 'switch', brandId: env.brand(a.brand).id })
  },
  {
    name: 'brand_close',
    title: 'Close brand',
    description: 'Close the brand\'s Chrome window. The session stays locked to the brand.',
    shape: { brand },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('brands.close', { id: b.id }, b.id, () => json({ closed: true, brand: b.name }))
    }
  },
  {
    name: 'brand_health',
    title: 'Brand login health',
    description: 'Check login state per platform for a brand (session cookie presence + expiry; never cookie values).',
    shape: { brand },
    readOnly: true,
    lock: 'none',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('health.check', { brandId: b.id }, b.id, (out) =>
        json((out as { platform: string; handle: string; loginState: string; cookieExpiresAt: string | null; lastCheckedAt: string | null }[]).map((x) => ({ platform: x.platform, handle: x.handle, loginState: x.loginState, cookieExpiresAt: x.cookieExpiresAt, lastCheckedAt: x.lastCheckedAt })))
      )
    }
  },

  // ── Browser ─────────────────────────────────────────────────────────────────
  {
    name: 'tabs',
    title: 'List tabs',
    description: 'List the brand window\'s tabs; "active" is the tab the browser tools act on.',
    shape: { brand },
    readOnly: true,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.tabs', { brandId: b.id }, b.id)
    }
  },
  {
    name: 'tab_open',
    title: 'Open tab',
    description: 'Open a new tab (optionally at a URL) and make it the active tab.',
    shape: { brand, url: z.string().optional() },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.tabOpen', { brandId: b.id, url: a.url }, b.id)
    }
  },
  {
    name: 'tab_select',
    title: 'Select tab',
    description: 'Make the tab at `index` (from tabs) the active tab.',
    shape: { brand, index: z.number().int().min(0) },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.tabSelect', { brandId: b.id, index: a.index }, b.id)
    }
  },
  {
    name: 'tab_close',
    title: 'Close tab',
    description: 'Close the tab at `index` (default: the active tab).',
    shape: { brand, index: z.number().int().min(0).optional() },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.tabClose', { brandId: b.id, index: a.index }, b.id)
    }
  },
  {
    name: 'navigate',
    title: 'Navigate',
    description: 'Load a URL in the active tab. Off-limits pages (account settings, security, passwords, 2FA, billing, deactivation) are refused.',
    shape: { brand, url: z.string().min(1) },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.navigate', { brandId: b.id, url: a.url }, b.id)
    }
  },
  {
    name: 'snapshot',
    title: 'Page snapshot',
    description: 'Accessibility snapshot of the active tab with element refs like [ref=f3e12]. Use the refs with click / type / upload. Take a new snapshot after the page changes — refs only work for the latest one.',
    shape: { brand },
    readOnly: true,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.snapshot', { brandId: b.id }, b.id, (out) => {
        const o = out as { url: string; title: string; snapshot: string }
        return [{ type: 'text', text: `URL: ${o.url}\nTitle: ${o.title}\n\n${o.snapshot}` }]
      })
    }
  },
  {
    name: 'click',
    title: 'Click',
    description: 'Click an element by ref (from snapshot), selector or visible text.',
    shape: { brand, ref, selector, text },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.click', { brandId: b.id, ref: a.ref, selector: a.selector, text: a.text }, b.id)
    }
  },
  {
    name: 'type',
    title: 'Type',
    description: 'Type into a field (by ref or selector; without one, into the focused element). Replaces the content unless clear=false. Never used for passwords or 2FA codes.',
    shape: {
      brand, ref, selector, text,
      value: z.string().describe('Text to type'),
      submit: z.boolean().optional().describe('Press Enter afterwards'),
      clear: z.boolean().optional().describe('Replace existing content (default true)')
    },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.type', { brandId: b.id, ref: a.ref, selector: a.selector, text: a.text, value: a.value, submit: a.submit, clear: a.clear }, b.id)
    }
  },
  {
    name: 'press',
    title: 'Press key',
    description: 'Press a key or chord in the active tab, e.g. "Enter", "Escape", "Tab", "Control+A".',
    shape: { brand, key: z.string().min(1) },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.press', { brandId: b.id, key: a.key }, b.id)
    }
  },
  {
    name: 'scroll',
    title: 'Scroll',
    description: 'Scroll the active tab by dy pixels (positive = down).',
    shape: { brand, dy: z.number().default(600) },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.scroll', { brandId: b.id, dy: a.dy ?? 600 }, b.id)
    }
  },
  {
    name: 'wait_for',
    title: 'Wait for',
    description: 'Wait until an element (selector) or text is visible. Returns found=false on timeout.',
    shape: { brand, selector: z.string().optional(), text: z.string().optional(), timeoutMs: z.number().int().min(100).max(60_000).optional() },
    readOnly: true,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.waitFor', { brandId: b.id, selector: a.selector, text: a.text, timeoutMs: a.timeoutMs }, b.id)
    }
  },
  {
    name: 'screenshot',
    title: 'Screenshot',
    description: 'PNG screenshot of the active tab (saved in Cubby\'s screens folder too).',
    shape: { brand, fullPage: z.boolean().optional() },
    readOnly: true,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.screenshot', { brandId: b.id, fullPage: a.fullPage }, b.id, (out) => {
        const o = out as { path: string; base64: string }
        return [
          { type: 'image', data: o.base64, mimeType: 'image/png' },
          { type: 'text', text: `Saved to ${o.path}` }
        ]
      })
    }
  },
  {
    name: 'page_text',
    title: 'Page text',
    description: 'Visible text of the active tab (truncated to maxChars, default 20000).',
    shape: { brand, maxChars: z.number().int().min(500).max(100_000).optional() },
    readOnly: true,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.pageText', { brandId: b.id, maxChars: a.maxChars }, b.id, (out) => {
        const o = out as { url: string; title: string; text: string }
        return [{ type: 'text', text: `URL: ${o.url}\nTitle: ${o.title}\n\n${o.text}` }]
      })
    }
  },
  {
    name: 'upload',
    title: 'Upload files',
    description: 'Put files into a file input (by ref/selector; default: the first file input) or the file chooser a button opens. Only files from Cubby\'s media library or watch folders (use media_find for paths).',
    shape: { brand, paths: z.array(z.string()).min(1).describe('Absolute file paths from media_find'), ref, selector, text },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('browser.upload', { brandId: b.id, paths: a.paths, ref: a.ref, selector: a.selector, text: a.text }, b.id)
    }
  },

  // ── Posting ─────────────────────────────────────────────────────────────────
  {
    name: 'media_find',
    title: 'Find media',
    description: 'Search the media library (videos / images indexed in place) by text, tag or kind. Returns ids and paths for post_create / upload.',
    shape: { q: z.string().optional(), tag: z.string().optional(), kind: z.enum(['video', 'image']).optional() },
    readOnly: true,
    lock: 'none',
    plan: (a) =>
      cmd('media.list', { q: a.q, tag: a.tag, kind: a.kind }, null, (out) =>
        json(
          (out as { id: string; path: string; filename: string; kind: string; durationMs: number | null; width: number | null; height: number | null; tags: string[]; platformFit: Record<string, string>; missing: boolean }[])
            .filter((m) => !m.missing)
            .slice(0, 100)
            .map((m) => ({ id: m.id, filename: m.filename, path: m.path, kind: m.kind, durationMs: m.durationMs, size: m.width && m.height ? `${m.width}x${m.height}` : null, tags: m.tags, platformFit: m.platformFit }))
        )
      )
  },
  {
    name: 'post_create',
    title: 'Create post',
    description:
      'Create a post for the locked brand. Pick accounts by platform (default: all the brand\'s accounts) or by id. Publishing still needs the person\'s approval in Cubby when the brand requires it, and pacing decides the earliest time.',
    shape: {
      brand,
      kind: z.enum(POST_KINDS),
      caption: z.string().default(''),
      mediaIds: z.array(z.string()).default([]).describe('Media ids from media_find'),
      platforms: z.array(z.enum(PLATFORMS)).optional(),
      accountIds: z.array(z.string()).optional(),
      mode: z.enum(['draft', 'schedule', 'queue', 'now']).default('draft').describe('draft = save only; schedule = at scheduledAt; queue = next free slot; now = as soon as approved + paced'),
      scheduledAt: z.string().optional().describe('ISO time, for mode=schedule'),
      perPlatform: z.record(z.string(), z.record(z.string(), z.unknown())).optional().describe('Per-platform overrides: caption, firstComment, title, tiktokPrivacy, …')
    },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      const accountIds = pickAccounts(b, a.accountIds, a.platforms)
      return cmd(
        'posts.create',
        { brandId: b.id, accountIds, kind: a.kind, assetIds: a.mediaIds ?? [], caption: a.caption ?? '', perPlatform: a.perPlatform ?? {}, scheduledAt: a.scheduledAt ?? null, mode: a.mode ?? 'draft' },
        b.id
      )
    }
  },
  {
    name: 'post_prepare',
    title: 'Prepare post',
    description: 'Run the posting recipe up to the final button in the brand window and attach screenshots for the person to approve in Cubby. Does not publish.',
    shape: { postId: z.string().min(1) },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => cmd('posts.prepare', { id: a.postId }, env.postBrandId(a.postId))
  },
  {
    name: 'post_status',
    title: 'Post status',
    description: 'Status, approval, results and errors of one post.',
    shape: { postId: z.string().min(1) },
    readOnly: true,
    lock: 'none',
    plan: (a, env) => cmd('posts.get', { id: a.postId }, env.postBrandId(a.postId))
  },
  {
    name: 'queue_list',
    title: 'Queue',
    description: 'Posts (newest first) for a brand or all allowed brands, optionally filtered by status (draft, ready_for_approval, approved, queued, running, needs_human, posted, failed, cancelled).',
    shape: { brand: brand.optional(), status: z.array(z.string()).optional(), limit: z.number().int().min(1).max(200).optional() },
    readOnly: true,
    lock: 'none',
    plan: (a, env) => {
      const b = a.brand ? env.brand(a.brand) : null
      return cmd('posts.list', { brandId: b?.id, status: a.status, limit: a.limit ?? 50 }, b?.id ?? null, (out, e) => json((out as { brandId: string }[]).filter((p) => allowedBrand(e, p.brandId))))
    }
  },

  // ── Flows ───────────────────────────────────────────────────────────────────
  {
    name: 'flows_list',
    title: 'List flows',
    description: 'Saved automation flows (step lists) the person built in Cubby.',
    shape: {},
    readOnly: true,
    lock: 'none',
    plan: () =>
      cmd('flows.list', {}, null, (out) =>
        json((out as { id: string; name: string; brandScope: string; brandIds: string[]; enabled: boolean; schedule: string | null; steps: unknown[] }[]).map((f) => ({ id: f.id, name: f.name, brandScope: f.brandScope, brandIds: f.brandIds, enabled: f.enabled, schedule: f.schedule, steps: f.steps.length })))
      )
  },
  {
    name: 'flow_run',
    title: 'Run flow',
    description: 'Run a flow in the locked brand. Returns the run record; follow it with activity_tail.',
    shape: { flowId: z.string().min(1), brand },
    readOnly: false,
    lock: 'require',
    plan: (a, env) => {
      const b = env.brand(a.brand)
      return cmd('flows.run', { id: a.flowId, brandIds: [b.id] }, b.id)
    }
  },

  // ── Log ─────────────────────────────────────────────────────────────────────
  {
    name: 'activity_tail',
    title: 'Activity',
    description: 'Most recent Activity entries (what you, the person, the scheduler and flows did), optionally for one brand.',
    shape: { brand: brand.optional(), limit: z.number().int().min(1).max(200).optional() },
    readOnly: true,
    lock: 'none',
    plan: (a, env) => {
      const b = a.brand ? env.brand(a.brand) : null
      return cmd('activity.list', { brandId: b?.id, limit: a.limit ?? 30 }, b?.id ?? null, (out, e) =>
        json(
          (out as { at: string; actor: string; brandId: string | null; brandName: string | null; action: string; detail: Record<string, unknown> }[])
            .filter((x) => !e.tokenBrandIds || (x.brandId !== null && e.tokenBrandIds.includes(x.brandId)))
            .map((x) => ({ at: x.at, actor: x.actor, brand: x.brandName, action: x.action, error: x.detail?.error, rule: x.detail?.rule }))
        )
      )
    }
  }
]

export const SERVER_INSTRUCTIONS = `Cubby runs one sealed Google Chrome profile per brand (its own logins, cookies and window) on the person's own computer. You act in those windows through these tools.

- Brands: brands_list shows them. Every browser / posting tool names a \`brand\` (name, slug, id or #serial).
- Brand lock: brand_open opens a brand and locks this session to it. Until you call brand_switch, every tool must name that brand; a different brand is refused. Only switch when the person asked to work in another brand.
- Pages: snapshot gives element refs ([ref=f3e12]) for click / type / upload; take a fresh snapshot after the page changes. screenshot and page_text help you check results.
- Publishing: post_create + post_prepare get a post ready; the person approves it in Cubby's Approvals inbox (you cannot approve or publish). Pacing per account decides the earliest posting time — do not try to work around it.
- Pace yourself like a person: no rapid-fire actions, no mass posting, no repeating identical content across brands.
- No secrets: you never see or type passwords, 2FA / one-time codes or cookie values. If a login is needed, stop and ask the person (Cubby's Fill login does it for them).
- Off-limits: account settings, security, password, 2FA, login activity, billing and deactivation pages are refused.
- Checkpoints: if a tool reports a checkpoint, captcha, rate limit or login wall, STOP. Do not retry or try to solve it — tell the person; Cubby has brought the window to the front for them.
- Kill switch: if a tool says Cubby is stopped, stop and wait for the person.
- Uploads only take files from Cubby's media library or watch folders (media_find).`
