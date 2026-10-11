// CORE command registry. Modules `implement()` commands from the shared contract; the doors
// (IPC, Local API, MCP) call `invoke()`. Everything that must hold no matter which door is used —
// actor rules, token scopes and brand scoping, the brand lock, the kill switch, Activity — is here.
import { contract, type CommandName, type Out, type Parsed } from '@shared/contract'
import type { Actor, TokenScope } from '@shared/types'
import { logActivity } from './activity'
import { GuardrailError, UserError } from './errors'
import { runtime } from './runtime'

export interface Ctx {
  actor: Actor
  /** set by the Local API / MCP doors: the calling token */
  tokenId?: string | null
  tokenName?: string | null
  /** token scopes; when set, the command's meta.scope must be included */
  scopes?: readonly TokenScope[] | null
  /** token limited to these brands; null/undefined = all */
  tokenBrandIds?: readonly string[] | null
  /** MCP session id + the brand it is locked to */
  mcpSessionId?: string | null
  brandLock?: string | null
  /** run that issued this call (flows / recipes) */
  runId?: string | null
  signal?: AbortSignal
}

export type Handler<K extends CommandName> = (input: Parsed<K>, ctx: Ctx) => Out<K> | Promise<Out<K>>
export type Handlers = { [K in CommandName]?: Handler<K> }

const handlers = new Map<CommandName, Handler<CommandName>>()

/** Register handlers for contract commands. Each command may be implemented once. */
export function implement(h: Handlers): void {
  for (const [name, fn] of Object.entries(h) as [CommandName, Handler<CommandName>][]) {
    if (!(name in contract)) throw new Error(`implement(): ${name} is not in the contract`)
    if (handlers.has(name)) throw new Error(`implement(): ${name} implemented twice`)
    handlers.set(name, fn)
  }
}

export function missingCommands(): CommandName[] {
  return (Object.keys(contract) as CommandName[]).filter((k) => !handlers.has(k))
}

export const isCommand = (name: string): name is CommandName => name in contract

const SECRET_KEYS = new Set(['password', 'totpSecret', 'passphrase', 'current', 'username', 'token', 'csv'])

/** Copy of the input that is safe to store in Activity. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4) return '…'
  if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) + '…' : v
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEYS.has(k) ? (x == null ? x : '••••') : k === 'logo' ? (x ? '[image]' : x) : redact(x, depth + 1)
    return out
  }
  return v
}

function brandFrom(name: CommandName, input: Record<string, unknown>, out: unknown): string | null {
  const key = contract[name].meta.brandKey
  if (key && typeof input[key] === 'string') return input[key] as string
  if (out && typeof out === 'object') {
    const o = out as Record<string, unknown>
    if (typeof o.brandId === 'string') return o.brandId
    if (name.startsWith('brands.') && typeof o.id === 'string') return o.id
  }
  return null
}

export async function invoke<K extends CommandName>(name: K, raw: unknown, ctx: Ctx): Promise<Out<K>> {
  if (!isCommand(name)) throw new UserError(`unknown command ${String(name)}`, 'not_found')
  const def = contract[name]
  const meta = def.meta
  const fn = handlers.get(name) as Handler<K> | undefined
  if (!fn) throw new UserError(`${name} is not available`, 'not_implemented')

  if (meta.actors && !meta.actors.includes(ctx.actor)) throw new UserError(`${name} can only be done from the Cubby app`, 'forbidden')
  if (ctx.scopes) {
    if (!meta.scope) throw new UserError(`${name} is not available to API tokens`, 'forbidden')
    if (!ctx.scopes.includes(meta.scope)) throw new UserError(`token lacks the "${meta.scope}" scope for ${name}`, 'forbidden')
  }

  const parsed = def.input.safeParse(raw ?? {})
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    throw new UserError(`invalid input for ${name} — ${msg}`, 'invalid')
  }
  const input = parsed.data as Parsed<K>
  const inObj = (input ?? {}) as Record<string, unknown>
  const brandKey = meta.brandKey
  const brandId = brandKey && typeof inObj[brandKey] === 'string' ? (inObj[brandKey] as string) : null

  if (brandId && ctx.tokenBrandIds && !ctx.tokenBrandIds.includes(brandId)) throw new UserError('token is not allowed to use this brand', 'forbidden')
  if (brandId && ctx.brandLock && brandId !== ctx.brandLock)
    throw new GuardrailError(`this session is locked to another brand — call brand_open/brand_switch for this brand first`, 'brand_lock')
  if (runtime.killSwitch && ctx.actor !== 'you' && !meta.readOnly)
    throw new GuardrailError('Cubby is stopped (kill switch is on). Turn it off in the app to continue.', 'kill_switch')

  try {
    const out = await fn(input, ctx)
    if (!meta.readOnly) logActivity({ actor: ctx.actor, brandId: brandFrom(name, inObj, out), action: name, detail: { input: redact(input), via: ctx.tokenName ?? undefined } })
    return out
  } catch (e) {
    if (!meta.readOnly || e instanceof GuardrailError)
      logActivity({
        actor: ctx.actor,
        brandId,
        action: name + '.failed',
        detail: { input: redact(input), error: e instanceof Error ? e.message : String(e), rule: e instanceof GuardrailError ? e.rule : undefined, via: ctx.tokenName ?? undefined }
      })
    throw e
  }
}

/** Errors as plain objects for IPC / HTTP / MCP. */
export function serializeError(e: unknown): { message: string; code: string; rule?: string } {
  if (e instanceof GuardrailError) return { message: e.message, code: e.code, rule: e.rule }
  if (e instanceof UserError) return { message: e.message, code: e.code }
  console.error(e)
  return { message: e instanceof Error ? e.message : String(e), code: 'internal' }
}
