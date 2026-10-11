// The command contract. Every capability in Cubby is one named command with a zod input schema
// and a TypeScript output type. CORE implements them (src/main/modules/*), and the three doors —
// IPC (renderer), Local API, MCP — only translate to `invoke(name, input, ctx)`.
import { z } from 'zod'
import {
  AGE_TIERS, PLATFORMS, POST_KINDS, TOKEN_SCOPES,
  type Account, type Activity, type ApiToken, type AppStatus, type BackupInfo, type BrandRow,
  type ChromeProfileInfo, type CookieInfo, type ExtensionInfo, type Flow, type FlowRun, type FlowStep,
  type Group, type MediaAsset, type PacingCheck, type PacingRule, type Post, type RecipeInfo,
  type Settings, type Slot, type TabInfo, type Tag, type TokenScope, type WatchFolder, type Actor, type FitLevel, type Platform
} from './types'

export interface CommandMeta {
  /** actors allowed to call this command; default: all */
  actors?: readonly Actor[]
  /** token scope needed through the Local API / MCP; undefined = not exposed to tokens */
  scope?: TokenScope
  /** read-only commands are not written to Activity */
  readOnly?: boolean
  /** input key holding the brand id (for brand lock, token brand scoping and Activity) */
  brandKey?: string
}

export interface CommandDef<I extends z.ZodType = z.ZodType, O = unknown> {
  input: I
  meta: CommandMeta
  /** phantom: output type */
  __out?: O
}

const cmd =
  <O>() =>
  <I extends z.ZodType>(input: I, meta: CommandMeta = {}): CommandDef<I, O> => ({ input, meta })

const none = z.object({}).strict().optional().default({})
const id = z.string().min(1)
const ids = z.array(id).min(1)
const platform = z.enum(PLATFORMS)
const ageTier = z.enum(AGE_TIERS)
const postKind = z.enum(POST_KINDS)
const hhmm = z.string().regex(/^\d{2}:\d{2}$/)
const iso = z.string().min(10)

const windowBounds = z.object({ width: z.number().int().min(400), height: z.number().int().min(300), x: z.number().int().optional(), y: z.number().int().optional() })

export const flowStep: z.ZodType<FlowStep> = z.lazy(() =>
  z.intersection(
    z.object({ id: z.string(), note: z.string().optional() }),
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('open_brand') }),
      z.object({ type: z.literal('open_url'), url: z.string() }),
      z.object({ type: z.literal('click'), selector: z.string().optional(), text: z.string().optional() }),
      z.object({ type: z.literal('type'), selector: z.string().optional(), text: z.string(), clear: z.boolean().optional() }),
      z.object({ type: z.literal('press'), key: z.string() }),
      z.object({ type: z.literal('scroll'), dy: z.number() }),
      z.object({ type: z.literal('upload'), selector: z.string(), files: z.array(z.string()) }),
      z.object({ type: z.literal('wait_for'), selector: z.string().optional(), text: z.string().optional(), timeoutMs: z.number().optional() }),
      z.object({ type: z.literal('wait'), ms: z.number() }),
      z.object({ type: z.literal('screenshot'), label: z.string().optional() }),
      z.object({ type: z.literal('if_exists'), selector: z.string().optional(), text: z.string().optional(), then: z.array(flowStep), else: z.array(flowStep).optional() }),
      z.object({ type: z.literal('loop_media'), assetIds: z.array(z.string()).optional(), tag: z.string().optional(), steps: z.array(flowStep) }),
      z.object({ type: z.literal('run_recipe'), recipe: z.string(), params: z.record(z.string(), z.unknown()) }),
      z.object({ type: z.literal('ask_claude'), prompt: z.string() }),
      z.object({ type: z.literal('notify'), message: z.string() }),
      z.object({ type: z.literal('close_brand') })
    ])
  )
) as z.ZodType<FlowStep>

const perPlatformOptions = z.object({
  caption: z.string().optional(),
  coverMs: z.number().optional(),
  firstComment: z.string().optional(),
  title: z.string().optional(),
  tiktokPrivacy: z.enum(['public', 'friends', 'private']).optional(),
  allowComments: z.boolean().optional(),
  allowDuet: z.boolean().optional(),
  allowStitch: z.boolean().optional(),
  igShareToFeed: z.boolean().optional(),
  fbPageName: z.string().optional()
})
const perPlatform = z.partialRecord(platform, perPlatformOptions)

const accountInput = z.object({
  platform,
  handle: z.string().min(1),
  displayName: z.string().optional(),
  profileUrl: z.string().optional(),
  ageTier: ageTier.default('new'),
  notes: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  totpSecret: z.string().optional()
})

const brandFields = z.object({
  name: z.string().min(1).max(80),
  color: z.string().optional(),
  logo: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  startupUrls: z.array(z.string()).optional(),
  window: windowBounds.optional(),
  downloadsDir: z.string().nullable().optional(),
  chromePath: z.string().nullable().optional(),
  approvalRequired: z.boolean().optional()
})

const brandFilter = z.object({
  groupId: z.string().optional(),
  tag: z.string().optional(),
  platform: platform.optional(),
  loginState: z.enum(['ok', 'expiring', 'expired', 'unknown', 'relogin']).optional(),
  status: z.enum(['closed', 'opening', 'open', 'error']).optional(),
  q: z.string().optional(),
  deleted: z.boolean().optional()
})

const selectorTarget = z.object({
  brandId: id,
  /** ref from browser.snapshot, e.g. "e12" */
  ref: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional()
})

export const contract = {
  // ── App ─────────────────────────────────────────────────────────────────────
  'app.status': cmd<AppStatus>()(none, { readOnly: true, scope: 'read' }),
  'app.killSwitch': cmd<AppStatus>()(z.object({ on: z.boolean() }), { actors: ['you'] }),
  'app.openPath': cmd<void>()(z.object({ path: z.string() }), { actors: ['you'], readOnly: true }),
  'app.revealPath': cmd<void>()(z.object({ path: z.string() }), { actors: ['you'], readOnly: true }),
  'app.openExternal': cmd<void>()(z.object({ url: z.string().url() }), { actors: ['you'], readOnly: true }),
  'app.pickFiles': cmd<string[]>()(
    z.object({ directory: z.boolean().optional(), multi: z.boolean().optional(), filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional(), save: z.boolean().optional(), defaultPath: z.string().optional() }),
    { actors: ['you'], readOnly: true }
  ),
  'app.readImageDataUrl': cmd<string>()(z.object({ path: z.string(), maxPx: z.number().optional() }), { actors: ['you'], readOnly: true }),
  /** bring the main Cubby window up at a route (quick switcher, notifications) */
  'app.showInMain': cmd<void>()(z.object({ path: z.string().startsWith('/') }), { actors: ['you'], readOnly: true }),
  'app.brandKits': cmd<{ name: string; path: string; dataUrl: string }[]>()(none, { actors: ['you'], readOnly: true }),

  // ── Settings ────────────────────────────────────────────────────────────────
  'settings.get': cmd<Settings>()(none, { readOnly: true }),
  'settings.set': cmd<Settings>()(z.object({ patch: z.record(z.string(), z.unknown()) }), { actors: ['you'] }),
  'settings.setUnlockPassphrase': cmd<Settings>()(z.object({ passphrase: z.string().min(6), current: z.string().optional() }), { actors: ['you'] }),
  'settings.setBackupPassphrase': cmd<Settings>()(z.object({ passphrase: z.string().min(8) }), { actors: ['you'] }),

  // ── Brands ──────────────────────────────────────────────────────────────────
  'brands.list': cmd<BrandRow[]>()(z.object({ filter: brandFilter.optional() }).optional().default({}), { readOnly: true, scope: 'read' }),
  'brands.get': cmd<BrandRow>()(z.object({ id }), { readOnly: true, scope: 'read', brandKey: 'id' }),
  'brands.create': cmd<BrandRow>()(
    brandFields.extend({ accounts: z.array(accountInput).optional(), importFromChromeProfile: z.string().optional() }),
    { scope: 'brands' }
  ),
  'brands.update': cmd<BrandRow>()(z.object({ id, patch: brandFields.partial() }), { scope: 'brands', brandKey: 'id' }),
  'brands.delete': cmd<void>()(z.object({ ids }), { scope: 'brands', actors: ['you', 'api'] }),
  'brands.restore': cmd<void>()(z.object({ ids }), { actors: ['you'] }),
  'brands.purge': cmd<void>()(z.object({ ids }), { actors: ['you'] }),
  'brands.reorder': cmd<void>()(z.object({ ids }), { actors: ['you'] }),
  'brands.batchCreateCsv': cmd<{ created: number; errors: string[] }>()(z.object({ csv: z.string() }), { actors: ['you'] }),
  'brands.open': cmd<{ cdpUrl: string; wsEndpoint: string }>()(z.object({ id, urls: z.array(z.string()).optional() }), { scope: 'brands', brandKey: 'id' }),
  'brands.close': cmd<void>()(z.object({ id }), { scope: 'brands', brandKey: 'id' }),
  'brands.closeAll': cmd<void>()(none, { actors: ['you'] }),
  'brands.front': cmd<void>()(z.object({ id }), { scope: 'brands', brandKey: 'id', readOnly: true }),
  'brands.arrange': cmd<void>()(z.object({ mode: z.enum(['tile', 'cascade']), ids: z.array(id).optional() }), { actors: ['you'] }),
  'brands.batch': cmd<{ ok: number; errors: string[] }>()(
    z.object({ ids, action: z.enum(['open', 'close', 'health', 'addTags', 'removeTags', 'move', 'delete']), tags: z.array(z.string()).optional(), groupId: z.string().nullable().optional() }),
    { actors: ['you'] }
  ),
  'brands.openUrl': cmd<void>()(z.object({ id, url: z.string() }), { actors: ['you'], brandKey: 'id' }),
  'brands.chromeProfiles': cmd<ChromeProfileInfo[]>()(none, { actors: ['you'], readOnly: true }),
  'brands.extensions': cmd<ExtensionInfo[]>()(z.object({ id }), { readOnly: true, brandKey: 'id' }),

  // ── Groups & tags ───────────────────────────────────────────────────────────
  'groups.list': cmd<Group[]>()(none, { readOnly: true, scope: 'read' }),
  'groups.create': cmd<Group>()(z.object({ name: z.string().min(1), color: z.string().optional() }), { actors: ['you', 'api'], scope: 'brands' }),
  'groups.update': cmd<Group>()(z.object({ id, patch: z.object({ name: z.string().optional(), color: z.string().optional(), sort: z.number().optional() }) }), { actors: ['you'] }),
  'groups.delete': cmd<void>()(z.object({ id }), { actors: ['you'] }),
  'tags.list': cmd<Tag[]>()(none, { readOnly: true, scope: 'read' }),
  'tags.create': cmd<Tag>()(z.object({ name: z.string().min(1), color: z.string().optional() }), { actors: ['you'] }),
  'tags.update': cmd<Tag>()(z.object({ id, patch: z.object({ name: z.string().optional(), color: z.string().optional() }) }), { actors: ['you'] }),
  'tags.delete': cmd<void>()(z.object({ id }), { actors: ['you'] }),

  // ── Accounts & secrets ──────────────────────────────────────────────────────
  'accounts.list': cmd<Account[]>()(z.object({ brandId: id }), { readOnly: true, scope: 'read', brandKey: 'brandId' }),
  'accounts.create': cmd<Account>()(accountInput.extend({ brandId: id }), { actors: ['you', 'api'], scope: 'brands', brandKey: 'brandId' }),
  'accounts.update': cmd<Account>()(
    z.object({
      id,
      patch: z.object({
        handle: z.string().optional(), displayName: z.string().optional(), profileUrl: z.string().optional(), ageTier: ageTier.optional(), notes: z.string().optional(),
        /** null clears the stored value */
        username: z.string().nullable().optional(), password: z.string().nullable().optional(), totpSecret: z.string().nullable().optional()
      })
    }),
    { actors: ['you'] }
  ),
  'accounts.delete': cmd<void>()(z.object({ id }), { actors: ['you'] }),
  'accounts.totp': cmd<{ code: string; remainingSec: number }>()(z.object({ id }), { actors: ['you'], readOnly: true }),
  'accounts.reveal': cmd<{ username: string | null; password: string | null }>()(z.object({ id, passphrase: z.string().optional() }), { actors: ['you'] }),
  'accounts.fillLogin': cmd<void>()(z.object({ id }), { actors: ['you'] }),

  // ── Login health & cookies ──────────────────────────────────────────────────
  'health.check': cmd<Account[]>()(z.object({ brandId: id.optional() }).optional().default({}), { scope: 'read', brandKey: 'brandId' }),
  'cookies.list': cmd<CookieInfo[]>()(z.object({ brandId: id }), { actors: ['you'], readOnly: true, brandKey: 'brandId' }),
  'cookies.export': cmd<{ path: string; count: number }>()(z.object({ brandId: id, passphrase: z.string().min(8), path: z.string().optional() }), { actors: ['you'], brandKey: 'brandId' }),
  'cookies.import': cmd<{ count: number }>()(z.object({ brandId: id, path: z.string(), passphrase: z.string().optional() }), { actors: ['you'], brandKey: 'brandId' }),
  'cookies.clear': cmd<{ count: number }>()(z.object({ brandId: id, platform }), { actors: ['you'], brandKey: 'brandId' }),

  // ── Browser (Claude / API tools; every call names a brand) ──────────────────
  'browser.tabs': cmd<TabInfo[]>()(z.object({ brandId: id }), { scope: 'browser', readOnly: true, brandKey: 'brandId' }),
  'browser.tabOpen': cmd<TabInfo[]>()(z.object({ brandId: id, url: z.string().optional() }), { scope: 'browser', brandKey: 'brandId' }),
  'browser.tabSelect': cmd<TabInfo[]>()(z.object({ brandId: id, index: z.number().int() }), { scope: 'browser', brandKey: 'brandId' }),
  'browser.tabClose': cmd<TabInfo[]>()(z.object({ brandId: id, index: z.number().int().optional() }), { scope: 'browser', brandKey: 'brandId' }),
  'browser.navigate': cmd<{ url: string; title: string }>()(z.object({ brandId: id, url: z.string() }), { scope: 'browser', brandKey: 'brandId' }),
  'browser.snapshot': cmd<{ url: string; title: string; snapshot: string }>()(z.object({ brandId: id }), { scope: 'browser', readOnly: true, brandKey: 'brandId' }),
  'browser.click': cmd<{ url: string }>()(selectorTarget, { scope: 'browser', brandKey: 'brandId' }),
  'browser.type': cmd<{ url: string }>()(selectorTarget.extend({ value: z.string(), submit: z.boolean().optional(), clear: z.boolean().optional() }), { scope: 'browser', brandKey: 'brandId' }),
  'browser.press': cmd<{ url: string }>()(z.object({ brandId: id, key: z.string() }), { scope: 'browser', brandKey: 'brandId' }),
  'browser.scroll': cmd<{ url: string }>()(z.object({ brandId: id, dy: z.number() }), { scope: 'browser', brandKey: 'brandId' }),
  'browser.waitFor': cmd<{ found: boolean }>()(z.object({ brandId: id, selector: z.string().optional(), text: z.string().optional(), timeoutMs: z.number().max(60_000).optional() }), { scope: 'browser', readOnly: true, brandKey: 'brandId' }),
  'browser.screenshot': cmd<{ path: string; base64: string }>()(z.object({ brandId: id, fullPage: z.boolean().optional() }), { scope: 'browser', readOnly: true, brandKey: 'brandId' }),
  'browser.pageText': cmd<{ url: string; title: string; text: string }>()(z.object({ brandId: id, maxChars: z.number().optional() }), { scope: 'browser', readOnly: true, brandKey: 'brandId' }),
  'browser.upload': cmd<{ url: string }>()(selectorTarget.extend({ paths: z.array(z.string()).min(1) }), { scope: 'browser', brandKey: 'brandId' }),

  // ── Media library ───────────────────────────────────────────────────────────
  'media.list': cmd<MediaAsset[]>()(z.object({ q: z.string().optional(), tag: z.string().optional(), kind: z.enum(['video', 'image']).optional(), ids: z.array(id).optional() }).optional().default({}), { readOnly: true, scope: 'read' }),
  'media.add': cmd<MediaAsset[]>()(z.object({ paths: z.array(z.string()).min(1), tags: z.array(z.string()).optional() }), { scope: 'posting' }),
  'media.update': cmd<MediaAsset>()(z.object({ id, tags: z.array(z.string()) }), { actors: ['you'] }),
  'media.remove': cmd<void>()(z.object({ ids }), { actors: ['you'] }),
  'media.usage': cmd<Post[]>()(z.object({ id }), { readOnly: true }),
  'media.rescan': cmd<{ added: number; missing: number }>()(none, { actors: ['you', 'scheduler'] }),
  'media.folders': cmd<WatchFolder[]>()(none, { readOnly: true }),
  'media.addFolder': cmd<WatchFolder>()(z.object({ path: z.string(), tags: z.array(z.string()).optional() }), { actors: ['you'] }),
  'media.removeFolder': cmd<void>()(z.object({ id }), { actors: ['you'] }),

  // ── Posts, approvals, queue ─────────────────────────────────────────────────
  'posts.list': cmd<Post[]>()(
    z.object({ brandId: id.optional(), status: z.array(z.string()).optional(), from: iso.optional(), to: iso.optional(), limit: z.number().optional() }).optional().default({}),
    { readOnly: true, scope: 'read', brandKey: 'brandId' }
  ),
  'posts.get': cmd<Post>()(z.object({ id }), { readOnly: true, scope: 'read' }),
  'posts.create': cmd<Post>()(
    z.object({
      brandId: id, accountIds: z.array(id).min(1), kind: postKind, assetIds: z.array(id).default([]), caption: z.string().default(''),
      perPlatform: perPlatform.default({}), scheduledAt: iso.nullable().optional(),
      /** draft = save only; schedule = at scheduledAt; queue = next free slot; now = as soon as approved + paced */
      mode: z.enum(['draft', 'schedule', 'queue', 'now']).default('draft')
    }),
    { scope: 'posting', brandKey: 'brandId' }
  ),
  'posts.update': cmd<Post>()(
    z.object({ id, patch: z.object({ accountIds: z.array(id).optional(), kind: postKind.optional(), assetIds: z.array(id).optional(), caption: z.string().optional(), perPlatform: perPlatform.optional(), scheduledAt: iso.nullable().optional() }) }),
    { scope: 'posting' }
  ),
  /** send an existing draft on its way (same post id): schedule at a time, next free slot, or now */
  'posts.submit': cmd<Post>()(z.object({ id, mode: z.enum(['schedule', 'queue', 'now']), scheduledAt: iso.nullable().optional() }), { scope: 'posting' }),
  'posts.delete': cmd<void>()(z.object({ id }), { actors: ['you'] }),
  'posts.fit': cmd<{ accountId: string; platform: Platform; level: FitLevel; notes: string[] }[]>()(
    z.object({ brandId: id, kind: postKind, assetIds: z.array(id), accountIds: z.array(id), caption: z.string(), perPlatform: perPlatform.default({}) }),
    { readOnly: true }
  ),
  /** run the recipe up to the final button and attach screenshots for approval */
  'posts.prepare': cmd<Post>()(z.object({ id }), { scope: 'posting' }),
  'posts.approve': cmd<Post>()(z.object({ id, accountIds: z.array(id).optional() }), { actors: ['you'] }),
  'posts.reject': cmd<Post>()(z.object({ id, reason: z.string().optional() }), { actors: ['you'] }),
  /** publish now (approved posts only when the brand requires approval) */
  'posts.run': cmd<Post>()(z.object({ id }), { actors: ['you', 'scheduler'] }),
  'posts.cancel': cmd<Post>()(z.object({ id }), { actors: ['you', 'api'], scope: 'posting' }),
  'posts.reschedule': cmd<Post>()(z.object({ id, scheduledAt: iso }), { actors: ['you'] }),
  'posts.nextSlot': cmd<string | null>()(z.object({ brandId: id }), { readOnly: true, brandKey: 'brandId' }),
  'slots.list': cmd<Slot[]>()(z.object({ brandId: id.optional() }).optional().default({}), { readOnly: true }),
  'slots.set': cmd<Slot[]>()(z.object({ brandId: id, slots: z.array(z.object({ weekdays: z.array(z.number().int().min(0).max(6)).min(1), time: hhmm })) }), { actors: ['you'], brandKey: 'brandId' }),

  // ── Pacing ──────────────────────────────────────────────────────────────────
  'pacing.rules': cmd<PacingRule[]>()(none, { readOnly: true }),
  'pacing.setRules': cmd<PacingRule[]>()(z.object({ rules: z.array(z.object({ platform, ageTier, minGapMin: z.number().min(0), dailyMax: z.number().int().min(1), jitterMin: z.number().min(0) })) }), { actors: ['you'] }),
  'pacing.check': cmd<PacingCheck>()(z.object({ accountId: id, at: iso.optional() }), { readOnly: true }),

  // ── Flows, recipes, runs ────────────────────────────────────────────────────
  'flows.list': cmd<Flow[]>()(none, { readOnly: true, scope: 'read' }),
  'flows.get': cmd<Flow>()(z.object({ id }), { readOnly: true, scope: 'read' }),
  'flows.create': cmd<Flow>()(z.object({ name: z.string().min(1), brandScope: z.enum(['one', 'many', 'any']).default('one'), brandIds: z.array(id).default([]), steps: z.array(flowStep).default([]), schedule: z.string().nullable().optional(), enabled: z.boolean().default(true) }), { actors: ['you'] }),
  'flows.update': cmd<Flow>()(z.object({ id, patch: z.object({ name: z.string().optional(), brandScope: z.enum(['one', 'many', 'any']).optional(), brandIds: z.array(id).optional(), steps: z.array(flowStep).optional(), schedule: z.string().nullable().optional(), enabled: z.boolean().optional() }) }), { actors: ['you'] }),
  'flows.delete': cmd<void>()(z.object({ id }), { actors: ['you'] }),
  'flows.duplicate': cmd<Flow>()(z.object({ id }), { actors: ['you'] }),
  'flows.run': cmd<FlowRun[]>()(z.object({ id, brandIds: z.array(id).optional() }), { scope: 'flows' }),
  'flows.recipes': cmd<RecipeInfo[]>()(none, { readOnly: true, scope: 'read' }),
  'flows.runRecipe': cmd<FlowRun>()(z.object({ recipe: z.string(), brandId: id, params: z.record(z.string(), z.unknown()).default({}) }), { actors: ['you'], brandKey: 'brandId' }),
  'flows.recordStart': cmd<{ recordingId: string }>()(z.object({ brandId: id }), { actors: ['you'], brandKey: 'brandId' }),
  'flows.recordStop': cmd<FlowStep[]>()(z.object({ recordingId: id }), { actors: ['you'] }),
  'runs.list': cmd<FlowRun[]>()(z.object({ flowId: id.optional(), brandId: id.optional(), postId: id.optional(), status: z.string().optional(), limit: z.number().optional() }).optional().default({}), { readOnly: true, scope: 'read' }),
  'runs.get': cmd<FlowRun>()(z.object({ id }), { readOnly: true, scope: 'read' }),
  'runs.abort': cmd<void>()(z.object({ id }), { actors: ['you', 'api'], scope: 'flows' }),

  // ── Activity ────────────────────────────────────────────────────────────────
  'activity.list': cmd<Activity[]>()(
    z.object({ brandId: id.optional(), actor: z.string().optional(), action: z.string().optional(), q: z.string().optional(), limit: z.number().max(1000).optional(), before: z.number().optional() }).optional().default({}),
    { readOnly: true, scope: 'read' }
  ),
  'activity.exportCsv': cmd<{ path: string; count: number }>()(z.object({ brandId: id.optional(), actor: z.string().optional(), action: z.string().optional(), q: z.string().optional(), path: z.string().optional() }).optional().default({}), { actors: ['you'] }),

  // ── Tokens & Claude ─────────────────────────────────────────────────────────
  'tokens.list': cmd<ApiToken[]>()(none, { actors: ['you'], readOnly: true }),
  'tokens.create': cmd<{ token: string; record: ApiToken }>()(z.object({ name: z.string().min(1), scopes: z.array(z.enum(TOKEN_SCOPES)).min(1), brandIds: z.array(id).nullable().optional() }), { actors: ['you'] }),
  'tokens.revoke': cmd<void>()(z.object({ id }), { actors: ['you'] }),
  /** registers Cubby's MCP server with Claude Code (`claude mcp add`) using a fresh scoped token */
  'claude.connect': cmd<{ ok: boolean; command: string; output: string }>()(z.object({ scope: z.enum(['user', 'local']).default('user'), brandIds: z.array(id).nullable().optional() }), { actors: ['you'] }),

  // ── Backup & export ─────────────────────────────────────────────────────────
  'backup.run': cmd<BackupInfo>()(z.object({ passphrase: z.string().optional(), folder: z.string().optional() }).optional().default({}), { actors: ['you', 'scheduler'] }),
  'backup.list': cmd<BackupInfo[]>()(none, { actors: ['you'], readOnly: true }),
  'backup.restore': cmd<{ brands: number }>()(z.object({ path: z.string(), passphrase: z.string() }), { actors: ['you'] }),
  'transfer.export': cmd<{ path: string; brands: number }>()(z.object({ ids, includeCredentials: z.boolean().default(false), passphrase: z.string().min(8), path: z.string().optional() }), { actors: ['you'] }),
  'transfer.import': cmd<BrandRow[]>()(z.object({ path: z.string(), passphrase: z.string() }), { actors: ['you'] })
} as const

export type Contract = typeof contract
export type CommandName = keyof Contract
export type In<K extends CommandName> = z.input<Contract[K]['input']>
export type Parsed<K extends CommandName> = z.output<Contract[K]['input']>
export type Out<K extends CommandName> = Contract[K] extends CommandDef<z.ZodType, infer O> ? O : never

// ── Events pushed from main to the renderer (and to MCP/API listeners) ────────
export interface EventMap {
  'brand.status': { id: string; status: BrandRow['status']; error?: string | null }
  'brands.changed': { ids?: string[] }
  'accounts.changed': { brandId: string }
  'posts.changed': { id?: string }
  'media.changed': Record<string, never>
  'flows.changed': Record<string, never>
  'runs.changed': { id: string; status: FlowRun['status'] }
  'run.log': { runId: string; brandId: string; entry: FlowRun['log'][number] }
  'activity.new': Activity
  'app.status': AppStatus
  'settings.changed': Settings
  toast: { kind: 'info' | 'good' | 'warn' | 'bad'; message: string }
  navigate: { path: string }
}
export type EventName = keyof EventMap
