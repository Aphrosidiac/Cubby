// Local API (PLAN §7): Fastify on 127.0.0.1:Settings.apiPort. A door, not a module of commands:
// it authenticates the bearer token, refuses browser / rebinding requests, maps REST routes onto
// invoke() with actor "api", and mounts the MCP server at /mcp. runtime.apiListening + requestStatus().
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { contract, type CommandName } from '@shared/contract'
import type { ApiToken, BrandRow } from '@shared/types'
import { db } from '../../core/db'
import { UserError, notFound } from '../../core/errors'
import { on, toast } from '../../core/events'
import { implement, invoke, isCommand, serializeError, type Ctx } from '../../core/registry'
import { requestStatus, runtime } from '../../core/runtime'
import { getSettings } from '../../core/settings'
import { resolveBrand } from '../brands/repo'
import { handleMcp } from '../mcp'
import { verifyToken } from '../tokens'
import { bearerToken, checkRequestOrigin, csvParam, numParam, statusForCode } from './guard'

implement({})

type Req = FastifyRequest<{ Params: Record<string, string>; Querystring: Record<string, string>; Body: Record<string, unknown> | undefined }>

let server: FastifyInstance | null = null
let port = 0

declare module 'fastify' {
  interface FastifyRequest {
    token?: ApiToken
  }
}

function ctxOf(req: Req): Ctx {
  const t = req.token!
  return { actor: 'api', tokenId: t.id, tokenName: t.name, scopes: t.scopes, tokenBrandIds: t.brandIds }
}

const call = <K extends CommandName>(req: Req, name: K, input: unknown) => invoke(name, input, ctxOf(req))

const allowed = (req: Req, brandId: string | null | undefined): boolean => !req.token!.brandIds || (!!brandId && req.token!.brandIds.includes(brandId))

/** :ref → brand id (id, slug, #serial or name), refusing brands outside the token's list. */
function brandParam(req: Req, ref: string): string {
  const b = resolveBrand(decodeURIComponent(ref))
  if (!allowed(req, b.id)) throw new UserError(`This token is not allowed to use ${b.name}`, 'forbidden')
  return b.id
}

function postBrand(req: Req, id: string): void {
  const r = db.get<{ brand_id: string }>('SELECT brand_id FROM posts WHERE id = ?', id)
  if (!r) throw notFound('Post')
  if (!allowed(req, r.brand_id)) throw new UserError('This token is not allowed to use this post\'s brand', 'forbidden')
}

function sendError(reply: FastifyReply, e: unknown): FastifyReply {
  const err = serializeError(e)
  return reply.code(statusForCode(err.code)).send({ error: err })
}

function buildServer(p: number): FastifyInstance {
  const app = Fastify({ logger: false, forceCloseConnections: true, bodyLimit: 4 * 1024 * 1024 })

  // DNS-rebinding / browser guard, then bearer auth — for every route including /mcp.
  app.addHook('onRequest', async (req, reply) => {
    const refused = checkRequestOrigin(req.headers, p)
    if (refused) return reply.code(403).send({ error: { message: `Refused: ${refused}`, code: 'forbidden' } })
    if (/[?&](token|access_token|key)=/i.test(req.url)) return reply.code(400).send({ error: { message: 'Send the token in the Authorization header, never in the URL', code: 'invalid' } })
    const raw = bearerToken(req.headers)
    const token = raw ? verifyToken(raw) : null
    if (!token) return reply.code(401).header('www-authenticate', 'Bearer').send({ error: { message: 'Missing or invalid token (Authorization: Bearer cub_…)', code: 'unauthorized' } })
    req.token = token
  })

  app.setErrorHandler((e, _req, reply) => {
    const fe = e as { statusCode?: number; message?: string }
    if (fe.statusCode && fe.statusCode < 500 && !(e instanceof UserError)) return reply.code(fe.statusCode).send({ error: { message: fe.message ?? 'Bad request', code: 'invalid' } })
    return sendError(reply, e)
  })
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { message: 'No such endpoint', code: 'not_found' } }))

  // ── MCP ────────────────────────────────────────────────────────────────────
  const mcp = async (req: Req, reply: FastifyReply) => {
    if (!req.token!.scopes.includes('mcp')) return reply.code(403).send({ error: { message: 'token lacks the "mcp" scope', code: 'forbidden' } })
    reply.hijack()
    try {
      await handleMcp(req.raw, reply.raw, req.body, req.token!)
    } catch (e) {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' })
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: serializeError(e).message }, id: null }))
      }
    }
  }
  app.post('/mcp', mcp)
  app.get('/mcp', mcp)
  app.delete('/mcp', mcp)

  // ── Status ─────────────────────────────────────────────────────────────────
  app.get('/api/status', (req: Req) => call(req, 'app.status', {}))

  // ── Brands ─────────────────────────────────────────────────────────────────
  app.get('/api/brands', async (req: Req) => {
    const q = req.query
    const rows = (await call(req, 'brands.list', { filter: { q: q.q, groupId: q.groupId, tag: q.tag, platform: q.platform, status: q.status, loginState: q.loginState } })) as BrandRow[]
    return rows.filter((b) => allowed(req, b.id))
  })
  app.post('/api/brands', async (req: Req, reply) => {
    if (req.token!.brandIds) throw new UserError('A token limited to some brands cannot create brands', 'forbidden')
    return reply.code(201).send(await call(req, 'brands.create', req.body ?? {}))
  })
  app.get('/api/brands/:ref', (req: Req) => call(req, 'brands.get', { id: brandParam(req, req.params.ref) }))
  app.patch('/api/brands/:ref', (req: Req) => call(req, 'brands.update', { id: brandParam(req, req.params.ref), patch: req.body ?? {} }))
  app.delete('/api/brands/:ref', async (req: Req) => {
    await call(req, 'brands.delete', { ids: [brandParam(req, req.params.ref)] })
    return { deleted: true }
  })
  app.post('/api/brands/:ref/open', async (req: Req) => {
    const urls = Array.isArray(req.body?.urls) ? req.body!.urls : undefined
    const out = await call(req, 'brands.open', { id: brandParam(req, req.params.ref), urls })
    // raw CDP endpoints only for tokens with the cdp scope (PLAN §7)
    return req.token!.scopes.includes('cdp') ? out : { opened: true }
  })
  app.post('/api/brands/:ref/close', async (req: Req) => {
    await call(req, 'brands.close', { id: brandParam(req, req.params.ref) })
    return { closed: true }
  })
  app.get('/api/brands/:ref/health', (req: Req) => call(req, 'health.check', { brandId: brandParam(req, req.params.ref) }))

  // ── Posts ──────────────────────────────────────────────────────────────────
  app.get('/api/posts', async (req: Req) => {
    const q = req.query
    const brandId = q.brand ? brandParam(req, q.brand) : undefined
    const rows = await call(req, 'posts.list', { brandId, status: csvParam(q.status), from: q.from || undefined, to: q.to || undefined, limit: numParam(q.limit) })
    return (rows as { brandId: string }[]).filter((p) => allowed(req, p.brandId))
  })
  app.post('/api/posts', async (req: Req, reply) => {
    const body = { ...(req.body ?? {}) }
    if (typeof body.brand === 'string' && !body.brandId) body.brandId = brandParam(req, body.brand)
    delete body.brand
    return reply.code(201).send(await call(req, 'posts.create', body))
  })
  app.get('/api/posts/:id', (req: Req) => {
    postBrand(req, req.params.id)
    return call(req, 'posts.get', { id: req.params.id })
  })
  for (const action of ['prepare', 'run', 'cancel', 'approve'] as const) {
    app.post(`/api/posts/:id/${action}`, (req: Req) => {
      postBrand(req, req.params.id)
      return call(req, `posts.${action}` as CommandName, { ...(req.body ?? {}), id: req.params.id })
    })
  }

  // ── Media ──────────────────────────────────────────────────────────────────
  app.get('/api/media', (req: Req) => {
    const q = req.query
    return call(req, 'media.list', { q: q.q || undefined, tag: q.tag || undefined, kind: q.kind || undefined, ids: csvParam(q.ids) })
  })
  app.post('/api/media', async (req: Req, reply) => reply.code(201).send(await call(req, 'media.add', req.body ?? {})))

  // ── Flows & runs ───────────────────────────────────────────────────────────
  app.get('/api/flows', (req: Req) => call(req, 'flows.list', {}))
  app.post('/api/flows/:id/run', (req: Req) => {
    const refs = Array.isArray(req.body?.brands) ? (req.body!.brands as string[]) : Array.isArray(req.body?.brandIds) ? (req.body!.brandIds as string[]) : undefined
    const brandIds = refs?.map((r) => brandParam(req, String(r)))
    if (!brandIds && req.token!.brandIds) throw new UserError('A token limited to some brands must name the brands to run the flow on', 'forbidden')
    return call(req, 'flows.run', { id: req.params.id, brandIds })
  })
  app.get('/api/runs/:id', async (req: Req) => {
    const run = (await call(req, 'runs.get', { id: req.params.id })) as { brandId: string }
    if (!allowed(req, run.brandId)) throw new UserError('This token is not allowed to use this run\'s brand', 'forbidden')
    return run
  })

  // ── Activity ───────────────────────────────────────────────────────────────
  app.get('/api/activity', async (req: Req) => {
    const q = req.query
    const brandId = q.brand ? brandParam(req, q.brand) : undefined
    const rows = await call(req, 'activity.list', { brandId, actor: q.actor || undefined, action: q.action || undefined, q: q.q || undefined, limit: numParam(q.limit), before: numParam(q.before) })
    return (rows as { brandId: string | null }[]).filter((a) => !req.token!.brandIds || allowed(req, a.brandId))
  })

  // ── Any token-exposed command ──────────────────────────────────────────────
  app.post('/api/invoke/:command', async (req: Req) => {
    const name = req.params.command
    if (!isCommand(name) || !contract[name].meta.scope) throw new UserError(`${name} is not available through the API`, 'not_found')
    const meta = contract[name].meta
    const input = (req.body ?? {}) as Record<string, unknown>
    // brand-limited tokens: commands without a brand key could touch any brand
    if (req.token!.brandIds && !meta.readOnly && !meta.brandKey) throw new UserError(`${name} is not available to a token limited to some brands`, 'forbidden')
    const out = await call(req, name, input)
    return out === undefined ? { ok: true } : out
  })

  return app
}

async function listen(): Promise<void> {
  const p = getSettings().apiPort
  const app = buildServer(p)
  try {
    await app.listen({ host: '127.0.0.1', port: p })
    server = app
    port = p
    runtime.apiListening = true
    console.log(`[cubby] Local API on http://127.0.0.1:${p} (MCP at /mcp)`)
  } catch (e) {
    runtime.apiListening = false
    await app.close().catch(() => {})
    const msg = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${p} is already in use — pick another Local API port in Settings.` : `Local API could not start: ${(e as Error).message}`
    console.warn('[cubby]', msg)
    toast('bad', msg)
  }
  requestStatus()
}

async function close(): Promise<void> {
  const s = server
  server = null
  runtime.apiListening = false
  requestStatus()
  if (s) await s.close().catch(() => {})
}

let offSettings: (() => void) | null = null
let restarting: Promise<void> = Promise.resolve()
let wanted = 0

export function start(): void {
  wanted = getSettings().apiPort
  restarting = listen()
  // restart when the port setting changes, or retry when the last attempt failed (port was busy)
  offSettings = on('settings.changed', (s) => {
    if (s.apiPort === wanted && runtime.apiListening) return
    wanted = s.apiPort
    restarting = restarting.then(async () => {
      await close()
      await listen()
    })
  })
}

export async function stop(): Promise<void> {
  offSettings?.()
  await restarting.catch(() => {})
  await close()
}
