// Cookie read/write through a brand's Chrome (CDP via the browser module). A closed brand is opened
// in the background for the job and closed again afterwards.
import type { BrowserContext } from 'playwright-core'
import { z } from 'zod'
import { closeBrand, getContext, isBrandOpen, openBrand } from '../browser'

export const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string().default('/'),
  expires: z.number().default(-1),
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(false),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional()
})
export type PortableCookie = z.output<typeof cookieSchema>

export async function withBrandContext<T>(brandId: string, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const wasOpen = isBrandOpen(brandId)
  if (!wasOpen) await openBrand(brandId, { background: true, actor: 'you', urls: ['about:blank'] })
  try {
    return await fn(await getContext(brandId, false))
  } finally {
    if (!wasOpen) await closeBrand(brandId).catch((e) => console.warn('could not close brand after cookie job', brandId, e))
  }
}

/** Every cookie in the brand's profile, in a portable shape. */
export async function readCookies(ctx: BrowserContext): Promise<PortableCookie[]> {
  return (await ctx.cookies()).map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }))
}

/** Write cookies (expired ones dropped). One bad cookie must not sink the rest: falls back to one by one. */
export async function writeCookies(ctx: BrowserContext, cookies: PortableCookie[]): Promise<{ written: number; failed: number }> {
  const now = Date.now() / 1000
  const live = cookies.filter((c) => c.expires <= 0 || c.expires > now)
  try {
    await ctx.addCookies(live)
    return { written: live.length, failed: 0 }
  } catch {
    let written = 0
    for (const c of live) {
      try {
        await ctx.addCookies([c])
        written++
      } catch {
        /* counted below */
      }
    }
    return { written, failed: live.length - written }
  }
}
