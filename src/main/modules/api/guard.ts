// Pure request checks and error mapping for the Local API (unit-tested, no Fastify / Electron).

type Headers = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

/**
 * DNS-rebinding + browser guard. Only `127.0.0.1:<port>` / `localhost:<port>` Host headers are served,
 * and any request a web browser made (Origin or Sec-Fetch-Site other than "none") is refused — no CORS.
 * Returns a reason when refused, null when fine.
 */
export function checkRequestOrigin(headers: Headers, port: number): string | null {
  const host = (first(headers.host) ?? '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 'bad Host header'
  if (first(headers.origin) !== undefined) return 'browser requests are not allowed'
  const site = first(headers['sec-fetch-site'])
  if (site !== undefined && site !== 'none') return 'browser requests are not allowed'
  return null
}

/** The bearer token from the Authorization header (never from the query string), or null. */
export function bearerToken(headers: Headers): string | null {
  const h = first(headers.authorization)
  if (!h) return null
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h)
  return m ? m[1] : null
}

/** HTTP status for a serialized CORE error code. */
export function statusForCode(code: string): number {
  switch (code) {
    case 'invalid':
    case 'bad_request':
      return 400
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'guardrail':
      return 409
    case 'not_implemented':
      return 501
    default:
      return 500
  }
}

/** Split "a,b" query values into arrays. */
export function csvParam(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const arr = Array.isArray(v) ? v.map(String) : String(v).split(',')
  const out = arr.map((s) => s.trim()).filter(Boolean)
  return out.length ? out : undefined
}

export function numParam(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
