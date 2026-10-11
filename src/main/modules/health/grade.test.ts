import { describe, expect, it } from 'vitest'
import { domainMatches, domainRegex, gradeLogin, normalizeCookies, toCookieInfo } from './grade'

const NOW = Date.UTC(2026, 9, 11, 12)
const days = (n: number) => Math.floor((NOW + n * 864e5) / 1000)

describe('gradeLogin', () => {
  it('ok when every session cookie is present and far from expiry', () => {
    const g = gradeLogin(['sessionid', 'ds_user_id'], [{ name: 'sessionid', expires: days(300) }, { name: 'ds_user_id', expires: days(80) }, { name: 'other', expires: days(1) }], NOW)
    expect(g.state).toBe('ok')
    expect(g.expiresAt).toBe(new Date(days(80) * 1000).toISOString())
  })
  it('expiring when one ends within 7 days', () => {
    expect(gradeLogin(['c_user', 'xs'], [{ name: 'c_user', expires: days(6) }, { name: 'xs', expires: days(300) }], NOW).state).toBe('expiring')
  })
  it('expired when one is missing or already expired', () => {
    const g = gradeLogin(['c_user', 'xs'], [{ name: 'c_user', expires: days(30) }], NOW)
    expect(g).toEqual({ state: 'expired', expiresAt: null, missing: ['xs'] })
    expect(gradeLogin(['li_at'], [{ name: 'li_at', expires: days(-1) }], NOW).state).toBe('expired')
  })
  it('session cookies count as present with no expiry', () => {
    expect(gradeLogin(['auth_token'], [{ name: 'auth_token', expires: -1 }], NOW)).toEqual({ state: 'ok', expiresAt: null, missing: [] })
  })
  it('the longest-lived duplicate wins', () => {
    expect(gradeLogin(['sessionid'], [{ name: 'sessionid', expires: days(-3) }, { name: 'sessionid', expires: days(100) }], NOW).state).toBe('ok')
  })
  it('unknown for platforms without session cookies', () => {
    expect(gradeLogin([], [], NOW).state).toBe('unknown')
  })
})

describe('cookie helpers', () => {
  it('matches platform domains', () => {
    expect(domainMatches('.instagram.com', 'instagram.com')).toBe(true)
    expect(domainMatches('www.instagram.com', 'instagram.com')).toBe(true)
    expect(domainMatches('notinstagram.com', 'instagram.com')).toBe(false)
    const r = domainRegex(['x.com', 'twitter.com'])
    expect(['.x.com', 'x.com', 'api.x.com', '.twitter.com'].every((d) => r.test(d))).toBe(true)
    expect(['box.com', 'x.com.evil.io', 'xx.com'].some((d) => r.test(d))).toBe(false)
  })

  it('maps cookies for display without values', () => {
    const out = toCookieInfo([
      { name: 'b', value: 'SECRET', domain: '.z.com', path: '/', expires: -1, httpOnly: true, secure: true },
      { name: 'a', value: 'SECRET', domain: 'a.com', path: '/', expires: 1893456000, httpOnly: false, secure: false }
    ])
    expect(out).toEqual([
      { domain: 'a.com', name: 'a', expires: '2030-01-01T00:00:00.000Z', httpOnly: false, secure: false },
      { domain: '.z.com', name: 'b', expires: null, httpOnly: true, secure: true }
    ])
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })

  it('normalises EditThisCookie, Playwright and Cubby files', () => {
    const etc = [
      { domain: '.instagram.com', name: 'sessionid', value: 'v', path: '/', expirationDate: 1893456000.5, hostOnly: false, httpOnly: true, secure: true, sameSite: 'no_restriction', session: false },
      { domain: 'www.instagram.com', name: 'csrftoken', value: 'c', path: '/', hostOnly: true, secure: true, sameSite: 'unspecified', session: true },
      { domain: 'x.com', name: 'n', value: 'v', sameSite: 'none', secure: false }
    ]
    expect(normalizeCookies(etc)).toEqual([
      { name: 'sessionid', value: 'v', domain: '.instagram.com', path: '/', expires: 1893456000.5, httpOnly: true, secure: true, sameSite: 'None' },
      { name: 'csrftoken', value: 'c', domain: 'www.instagram.com', path: '/', expires: -1, httpOnly: false, secure: true },
      { name: 'n', value: 'v', domain: 'x.com', path: '/', expires: -1, httpOnly: false, secure: false }
    ])
    const cubby = { format: 'cubby-cookies', cookies: [{ name: 'a', value: '1', domain: '.a.com', path: '/p', expires: 1893456000000, httpOnly: false, secure: true, sameSite: 'Lax' }] }
    expect(normalizeCookies(cubby)).toEqual([{ name: 'a', value: '1', domain: '.a.com', path: '/p', expires: 1893456000, httpOnly: false, secure: true, sameSite: 'Lax' }])
  })

  it('rejects files without cookies', () => {
    expect(() => normalizeCookies({ hello: 1 })).toThrow(/No cookies/)
    expect(() => normalizeCookies([{ foo: 1 }])).toThrow(/no usable/)
  })
})
