// Domain types shared by main, preload and renderer. Pure TypeScript — no runtime imports.

export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin', 'threads', 'custom'] as const
export type Platform = (typeof PLATFORMS)[number]

export const AGE_TIERS = ['new', 'warm', 'established'] as const
export type AgeTier = (typeof AGE_TIERS)[number]

export type LoginState = 'ok' | 'expiring' | 'expired' | 'unknown'
export type BrandStatus = 'closed' | 'opening' | 'open' | 'error'
export type Actor = 'you' | 'claude' | 'scheduler' | 'flow' | 'api'

export const POST_KINDS = ['reel', 'video', 'image', 'carousel', 'text', 'story'] as const
export type PostKind = (typeof POST_KINDS)[number]

export type PostStatus =
  | 'draft'
  | 'ready_for_approval'
  | 'approved'
  | 'queued'
  | 'running'
  | 'needs_human'
  | 'posted'
  | 'failed'
  | 'cancelled'

export type FitLevel = 'ok' | 'warn' | 'bad'

export interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
}

export interface Brand {
  id: string
  serial: number
  name: string
  slug: string
  /** data: URL (small PNG/SVG) or null */
  logo: string | null
  color: string
  groupId: string | null
  tags: string[]
  notes: string
  sort: number
  profileDir: string
  cdpPort: number | null
  pid: number | null
  chromePath: string | null
  startupUrls: string[]
  window: WindowBounds
  downloadsDir: string | null
  approvalRequired: boolean
  status: BrandStatus
  statusError: string | null
  lastOpenedAt: string | null
  createdAt: string
  deletedAt: string | null
}

export interface AccountSummary {
  id: string
  platform: Platform
  handle: string
  loginState: LoginState
  ageTier: AgeTier
  cookieExpiresAt: string | null
}

export interface BrandRow extends Brand {
  accounts: AccountSummary[]
  groupName: string | null
  /** posts queued/scheduled in the future */
  upcoming: number
}

export interface Group {
  id: string
  name: string
  color: string
  sort: number
  count: number
}

export interface Tag {
  id: string
  name: string
  color: string
  count: number
}

export interface Account {
  id: string
  brandId: string
  platform: Platform
  handle: string
  displayName: string
  profileUrl: string
  ageTier: AgeTier
  loginState: LoginState
  cookieExpiresAt: string | null
  lastCheckedAt: string | null
  hasUsername: boolean
  hasPassword: boolean
  hasTotp: boolean
  notes: string
  createdAt: string
}

export interface CookieInfo {
  domain: string
  name: string
  expires: string | null // ISO, null = session cookie
  httpOnly: boolean
  secure: boolean
}

export interface MediaAsset {
  id: string
  path: string
  filename: string
  kind: 'video' | 'image'
  hash: string
  durationMs: number | null
  width: number | null
  height: number | null
  fps: number | null
  codec: string | null
  sizeBytes: number
  /** absolute path of the generated thumbnail jpg */
  thumb: string | null
  tags: string[]
  /** keyed by fit target id, e.g. instagram_reel */
  platformFit: Record<string, FitLevel>
  fitNotes: Record<string, string[]>
  addedAt: string
  missing: boolean
}

export interface WatchFolder {
  id: string
  path: string
  tags: string[]
}

export interface PerPlatformOptions {
  caption?: string
  /** cover frame offset in ms (video posts) */
  coverMs?: number
  firstComment?: string
  title?: string
  tiktokPrivacy?: 'public' | 'friends' | 'private'
  allowComments?: boolean
  allowDuet?: boolean
  allowStitch?: boolean
  igShareToFeed?: boolean
  fbPageName?: string
}

export interface PostScreen {
  accountId: string
  path: string
  at: string
}

export interface PostResult {
  accountId: string
  url: string | null
  error: string | null
  at: string
}

export interface Post {
  id: string
  brandId: string
  accountIds: string[]
  kind: PostKind
  assetIds: string[]
  caption: string
  perPlatform: Partial<Record<Platform, PerPlatformOptions>>
  scheduledAt: string | null
  status: PostStatus
  approval: { by: Actor; at: string; accountIds: string[] } | null
  screens: PostScreen[]
  results: PostResult[]
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface Slot {
  id: string
  brandId: string
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[]
  /** HH:mm local time (Settings.timezone) */
  time: string
}

/** Steps for user flows and built-in recipes. Every step has a stable id. */
export type FlowStep = { id: string; note?: string } & (
  | { type: 'open_brand' }
  | { type: 'open_url'; url: string }
  | { type: 'click'; selector?: string; text?: string }
  | { type: 'type'; selector?: string; text: string; clear?: boolean }
  | { type: 'press'; key: string }
  | { type: 'scroll'; dy: number }
  | { type: 'upload'; selector: string; files: string[] }
  | { type: 'wait_for'; selector?: string; text?: string; timeoutMs?: number }
  | { type: 'wait'; ms: number }
  | { type: 'screenshot'; label?: string }
  | { type: 'if_exists'; selector?: string; text?: string; then: FlowStep[]; else?: FlowStep[] }
  | { type: 'loop_media'; assetIds?: string[]; tag?: string; steps: FlowStep[] }
  | { type: 'run_recipe'; recipe: string; params: Record<string, unknown> }
  | { type: 'ask_claude'; prompt: string }
  | { type: 'notify'; message: string }
  | { type: 'close_brand' }
)
export type FlowStepType = FlowStep['type']

export interface Flow {
  id: string
  name: string
  brandScope: 'one' | 'many' | 'any'
  brandIds: string[]
  steps: FlowStep[]
  /** cron expression or null */
  schedule: string | null
  enabled: boolean
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export type RunStatus = 'running' | 'ok' | 'failed' | 'aborted' | 'needs_human'

export interface RunLogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  msg: string
  step?: string
  screen?: string
}

export interface FlowRun {
  id: string
  flowId: string | null
  recipe: string | null
  brandId: string
  postId: string | null
  actor: Actor
  label: string
  status: RunStatus
  startedAt: string
  endedAt: string | null
  log: RunLogEntry[]
  screens: string[]
  error: string | null
}

export interface RecipeInfo {
  id: string
  name: string
  platform: Platform | null
  kinds: PostKind[]
  description: string
}

export interface PacingRule {
  platform: Platform
  ageTier: AgeTier
  minGapMin: number
  dailyMax: number
  jitterMin: number
}

export interface PacingCheck {
  ok: boolean
  /** earliest time this account may post again */
  nextAllowedAt: string | null
  reason: string | null
}

export const TOKEN_SCOPES = ['read', 'brands', 'browser', 'posting', 'flows', 'cdp', 'mcp'] as const
export type TokenScope = (typeof TOKEN_SCOPES)[number]

export interface ApiToken {
  id: string
  name: string
  prefix: string
  scopes: TokenScope[]
  brandIds: string[] | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface Activity {
  id: number
  at: string
  actor: Actor
  brandId: string | null
  brandName: string | null
  action: string
  detail: Record<string, unknown>
  screen: string | null
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  launchAtLogin: boolean
  closeToTray: boolean
  quickSwitchHotkey: string
  chromePath: string | null
  apiPort: number
  approvalDefault: boolean
  timezone: string
  quietHours: { enabled: boolean; start: string; end: string }
  /** what the scheduler does with posts missed while the machine slept */
  catchUp: 'run' | 'skip'
  notifications: { os: boolean; telegramBotToken: string | null; telegramChatId: string | null }
  backup: { enabled: boolean; folder: string | null; cron: string; keep: number }
  /** hour (0-23) for the daily background login check of closed brands */
  healthCheckHour: number
  defaultWindow: WindowBounds
  /** true once an unlock passphrase is stored (value never leaves main) */
  unlockPassphraseSet: boolean
  /** passphrase for scheduled backups is stored encrypted; this only says if one exists */
  backupPassphraseSet: boolean
}

export interface LiveRun {
  runId: string
  brandId: string
  brandName: string
  actor: Actor
  label: string
  startedAt: string
  step: string | null
}

export interface McpClientInfo {
  sessionId: string
  tokenName: string
  brandLock: string | null
  connectedAt: string
  lastCallAt: string | null
}

export interface AppStatus {
  version: string
  platform: NodeJS.Platform | string
  chrome: { path: string; version: string } | null
  dataDir: string
  apiUrl: string
  mcpUrl: string
  apiListening: boolean
  killSwitch: boolean
  runs: LiveRun[]
  mcpClients: McpClientInfo[]
  approvalsCount: number
  openBrands: number
  needsRelogin: number
}

export interface Checkpoint {
  kind: 'checkpoint' | 'captcha' | 'rate_limit' | 'login_wall'
  reason: string
}

export interface ChromeProfileInfo {
  /** folder name inside the Chrome user data dir, e.g. "Profile 1" */
  dir: string
  name: string
  path: string
  email: string | null
}

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  enabled: boolean
}

export interface BackupInfo {
  path: string
  sizeBytes: number
  at: string
}

export interface TabInfo {
  index: number
  url: string
  title: string
  active: boolean
}
