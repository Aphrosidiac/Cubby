// MCP server (PLAN §8): Streamable HTTP mounted by the api module at /mcp. One McpServer +
// transport per session; every tool maps onto invoke() with actor "claude", the calling token's
// scopes / brands and the session's brand lock. runtime.mcpClients mirrors the live sessions, the
// kill switch aborts in-flight tool calls, and claude.connect registers Cubby with Claude Code.
// Implements commands: claude.connect
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { ApiToken } from '@shared/types'
import { logActivity } from '../../core/activity'
import { db } from '../../core/db'
import { GuardrailError, UserError, notFound } from '../../core/errors'
import { implement, invoke, serializeError } from '../../core/registry'
import { onKill, requestStatus, runtime } from '../../core/runtime'
import { getSettings } from '../../core/settings'
import { getBrand, resolveBrand, toBrandRows } from '../brands/repo'
import { createToken, onTokenRevoked } from '../tokens'
import { maskTokens } from '../tokens/token'
import { buildAddArgs, buildRemoveArgs, commandLine, findClaudeCli, runCli } from './connect'
import { SERVER_INSTRUCTIONS, TOOLS, json, type Content, type ToolEnv, type ToolSpec } from './tools'

const IDLE_CLOSE_MS = 12 * 3600_000

interface Session {
  id: string
  token: ApiToken
  transport: StreamableHTTPServerTransport
  server: McpServer
  brandLock: string | null
  inflight: Set<AbortController>
}

const sessions = new Map<string, Session>()

function touch(s: Session): void {
  const c = runtime.mcpClients.get(s.id)
  if (!c) return
  c.lastCallAt = new Date().toISOString()
  c.brandLock = s.brandLock ? (db.get<{ name: string }>('SELECT name FROM brands WHERE id = ?', s.brandLock)?.name ?? s.brandLock) : null
  requestStatus()
}

function dropSession(id: string): void {
  const s = sessions.get(id)
  sessions.delete(id)
  if (s) for (const c of s.inflight) c.abort(new UserError('The MCP session closed.'))
  if (runtime.mcpClients.delete(id)) requestStatus()
}

async function closeSession(s: Session): Promise<void> {
  dropSession(s.id)
  await s.transport.close().catch(() => {})
  await s.server.close().catch(() => {})
}

function envFor(s: Session): ToolEnv {
  const tokenBrandIds = s.token.brandIds
  const check = (id: string, name: string) => {
    if (tokenBrandIds && !tokenBrandIds.includes(id)) throw new UserError(`This token is not allowed to use ${name}.`, 'forbidden')
  }
  return {
    lock: s.brandLock,
    tokenBrandIds,
    brand(ref) {
      const b = resolveBrand(ref)
      check(b.id, b.name)
      const row = toBrandRows([b])[0]
      return { id: b.id, name: b.name, accounts: row.accounts.map((a) => ({ id: a.id, platform: a.platform, handle: a.handle })) }
    },
    postBrandId(postId) {
      const r = db.get<{ brand_id: string }>('SELECT brand_id FROM posts WHERE id = ?', postId)
      if (!r) throw notFound(`Post ${postId}`)
      check(r.brand_id, getBrand(r.brand_id).name)
      return r.brand_id
    }
  }
}

const brandName = (id: string): string => db.get<{ name: string }>('SELECT name FROM brands WHERE id = ?', id)?.name ?? id

/** Lock rules, checked before invoke (the registry enforces the lock again for brand-keyed commands). */
function checkLock(s: Session, spec: ToolSpec, brandId: string | null): void {
  if (!brandId) return
  const lock = s.brandLock
  if (spec.lock === 'require' && !lock) throw new GuardrailError(`No brand is open in this session yet — call brand_open with "${brandName(brandId)}" first.`, 'brand_lock')
  if ((spec.lock === 'require' || spec.lock === 'open' || spec.lock === 'none') && lock && lock !== brandId)
    throw new GuardrailError(
      `This session is locked to ${brandName(lock)}. To work in ${brandName(brandId)}, call brand_switch with "${brandName(brandId)}" first (only if the person asked for that brand).`,
      'brand_lock'
    )
}

function errorResult(e: unknown): { isError: true; content: Content[] } {
  const err = serializeError(e)
  return { isError: true, content: [{ type: 'text', text: err.rule ? `${err.message} [guardrail: ${err.rule}]` : err.message }] }
}

async function runTool(s: Session, spec: ToolSpec, args: unknown, requestSignal: AbortSignal): Promise<{ content: Content[]; isError?: boolean }> {
  const ctrl = new AbortController()
  s.inflight.add(ctrl)
  const signal = AbortSignal.any([ctrl.signal, requestSignal])
  try {
    const env = envFor(s)
    const plan = spec.plan(args ?? {}, env)
    if (plan.kind === 'switch') {
      const from = s.brandLock
      s.brandLock = plan.brandId
      logActivity({ actor: 'claude', brandId: plan.brandId, action: 'mcp.brandSwitch', detail: { from: from ? brandName(from) : null, to: brandName(plan.brandId), via: s.token.name } })
      const b = getBrand(plan.brandId)
      return { content: json({ lockedTo: b.name, previous: from ? brandName(from) : null, status: b.status, next: b.status === 'open' ? 'Call snapshot.' : 'Call brand_open to open it.' }) }
    }
    checkLock(s, spec, plan.brandId)
    const prevLock = s.brandLock
    if (spec.lock === 'open' && plan.brandId) s.brandLock = plan.brandId
    try {
      const out = await invoke(plan.command, plan.input, {
        actor: 'claude',
        tokenId: s.token.id,
        tokenName: s.token.name,
        scopes: s.token.scopes,
        tokenBrandIds: s.token.brandIds,
        mcpSessionId: s.id,
        brandLock: s.brandLock,
        signal
      })
      return { content: plan.format ? plan.format(out, envFor(s)) : json(out ?? { ok: true }) }
    } catch (e) {
      if (spec.lock === 'open') s.brandLock = prevLock
      throw e
    }
  } catch (e) {
    return errorResult(e)
  } finally {
    s.inflight.delete(ctrl)
    touch(s)
  }
}

function buildServer(s: Session): McpServer {
  const server = new McpServer({ name: 'cubby', title: 'Cubby', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS })
  for (const spec of TOOLS) {
    // The SDK's generic overloads cannot follow a table of different shapes; inputs are validated
    // by the SDK (zod 4 shape) and again by the registry.
    const register = server.registerTool.bind(server) as unknown as (
      name: string,
      config: { title: string; description: string; inputSchema: ToolSpec['shape']; annotations: Record<string, boolean> },
      cb: (args: unknown, extra: { signal: AbortSignal }) => Promise<{ content: Content[]; isError?: boolean }>
    ) => void
    register(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.shape, annotations: { readOnlyHint: spec.readOnly, openWorldHint: !spec.name.startsWith('brand') } },
      (args, extra) => runTool(s, spec, args, extra.signal)
    )
  }
  return server
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: status === 404 ? -32001 : -32000, message }, id: null }))
}

/**
 * Handle one /mcp request (POST / GET / DELETE) for an already-authenticated token with the mcp
 * scope. The api module hijacks the Fastify reply and hands over the raw req/res + parsed body.
 */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, body: unknown, token: ApiToken): Promise<void> {
  const sid = req.headers['mcp-session-id']
  const sessionId = Array.isArray(sid) ? sid[0] : sid
  if (sessionId) {
    const s = sessions.get(sessionId)
    if (!s) return sendJsonRpcError(res, 404, 'Session not found — start a new session')
    if (s.token.id !== token.id) return sendJsonRpcError(res, 403, 'This session belongs to another token')
    s.token = token
    await s.transport.handleRequest(req, res, body)
    return
  }
  if (req.method !== 'POST' || !isInitializeRequest(body)) return sendJsonRpcError(res, 400, 'No valid session id — send an initialize request first')

  const s = { token, brandLock: null, inflight: new Set<AbortController>() } as unknown as Session
  s.transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      s.id = id
      sessions.set(id, s)
      runtime.mcpClients.set(id, { sessionId: id, tokenName: token.name, brandLock: null, connectedAt: new Date().toISOString(), lastCallAt: null })
      requestStatus()
      logActivity({ actor: 'claude', action: 'mcp.connected', detail: { via: token.name, session: id.slice(0, 8) } })
    },
    onsessionclosed: (id) => dropSession(id)
  })
  s.transport.onclose = () => {
    if (s.id) dropSession(s.id)
  }
  s.server = buildServer(s)
  await s.server.connect(s.transport)
  await s.transport.handleRequest(req, res, body)
}

/** Drop every session (port change / shutdown). */
export async function closeAllSessions(): Promise<void> {
  await Promise.all([...sessions.values()].map((s) => closeSession(s)))
}

const CLAUDE_SCOPES = ['mcp', 'read', 'brands', 'browser', 'posting', 'flows'] as const

implement({
  'claude.connect': async ({ scope, brandIds }) => {
    const port = getSettings().apiPort
    const { token } = createToken('Claude Code', [...CLAUDE_SCOPES], brandIds ?? null)
    const addArgs = buildAddArgs(scope, port, token)
    const full = commandLine(addArgs)
    // "local" scope belongs to the folder the command runs in. Run from here it would land on
    // Cubby's own working folder, so the person runs it inside their project instead.
    if (scope === 'local') return { ok: false, command: full, output: 'Run this inside the project folder Claude Code should use — the token is shown only now.' }
    const bin = findClaudeCli()
    // Without the CLI (or when it fails) the full command is returned once so the person can run it;
    // like tokens.create, this is the only time the token is shown.
    if (!bin) return { ok: false, command: full, output: 'Claude Code CLI ("claude") was not found. Run this command yourself in a terminal — the token is shown only now.' }
    await runCli(bin, buildRemoveArgs(scope)).catch(() => null)
    const r = await runCli(bin, addArgs)
    const output = maskTokens(r.output)
    if (r.code !== 0) return { ok: false, command: full, output: output || `claude exited with code ${r.code}` }
    return { ok: true, command: maskTokens(full), output }
  }
})

let sweep: NodeJS.Timeout | null = null
let offKill: (() => void) | null = null
let offRevoke: (() => void) | null = null

export function start(): void {
  offKill = onKill(() => {
    for (const s of sessions.values())
      for (const c of s.inflight) c.abort(new GuardrailError('Stopped — the person pressed Cubby\'s kill switch. Do not retry; wait for them.', 'kill_switch'))
  })
  offRevoke = onTokenRevoked((id) => {
    for (const s of [...sessions.values()]) if (s.token.id === id) void closeSession(s)
  })
  sweep = setInterval(() => {
    const now = Date.now()
    for (const s of [...sessions.values()]) {
      const c = runtime.mcpClients.get(s.id)
      const last = Date.parse(c?.lastCallAt ?? c?.connectedAt ?? '') || now
      if (now - last > IDLE_CLOSE_MS && !s.inflight.size) void closeSession(s)
    }
  }, 10 * 60_000)
}

export async function stop(): Promise<void> {
  if (sweep) clearInterval(sweep)
  offKill?.()
  offRevoke?.()
  await closeAllSessions()
}
