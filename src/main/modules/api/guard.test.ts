import { describe, expect, it } from 'vitest'
import { GuardrailError, UserError } from '../../core/errors'
import { serializeError } from '../../core/registry'
import { bearerToken, checkRequestOrigin, csvParam, statusForCode } from './guard'

describe('Host / Origin guard', () => {
  it('accepts 127.0.0.1 and localhost on our port only', () => {
    expect(checkRequestOrigin({ host: '127.0.0.1:7830' }, 7830)).toBeNull()
    expect(checkRequestOrigin({ host: 'localhost:7830' }, 7830)).toBeNull()
    expect(checkRequestOrigin({ host: 'LOCALHOST:7830' }, 7830)).toBeNull()
  })
  it('refuses rebinding hosts, other ports and missing Host', () => {
    expect(checkRequestOrigin({ host: 'evil.example:7830' }, 7830)).toMatch(/Host/)
    expect(checkRequestOrigin({ host: '127.0.0.1:7820' }, 7830)).toMatch(/Host/)
    expect(checkRequestOrigin({ host: '127.0.0.1' }, 7830)).toMatch(/Host/)
    expect(checkRequestOrigin({}, 7830)).toMatch(/Host/)
  })
  it('refuses anything a browser sent', () => {
    expect(checkRequestOrigin({ host: '127.0.0.1:7830', origin: 'https://evil.example' }, 7830)).toMatch(/browser/)
    expect(checkRequestOrigin({ host: '127.0.0.1:7830', origin: 'null' }, 7830)).toMatch(/browser/)
    expect(checkRequestOrigin({ host: '127.0.0.1:7830', 'sec-fetch-site': 'cross-site' }, 7830)).toMatch(/browser/)
    expect(checkRequestOrigin({ host: '127.0.0.1:7830', 'sec-fetch-site': 'none' }, 7830)).toBeNull()
  })
})

describe('bearer token', () => {
  it('reads Authorization: Bearer only', () => {
    expect(bearerToken({ authorization: 'Bearer cub_abc' })).toBe('cub_abc')
    expect(bearerToken({ authorization: 'bearer   cub_abc ' })).toBe('cub_abc')
    expect(bearerToken({ authorization: 'Basic xyz' })).toBeNull()
    expect(bearerToken({})).toBeNull()
  })
})

describe('error → HTTP status', () => {
  const status = (e: unknown) => statusForCode(serializeError(e).code)
  it('maps CORE error codes', () => {
    expect(status(new UserError('bad', 'invalid'))).toBe(400)
    expect(status(new UserError('bad'))).toBe(400)
    expect(status(new UserError('no', 'forbidden'))).toBe(403)
    expect(status(new UserError('gone', 'not_found'))).toBe(404)
    expect(status(new GuardrailError('stop', 'checkpoint'))).toBe(409)
    expect(serializeError(new GuardrailError('stop', 'checkpoint')).rule).toBe('checkpoint')
    expect(status(new UserError('later', 'not_implemented'))).toBe(501)
    expect(statusForCode('internal')).toBe(500)
  })
  it('splits csv query params', () => {
    expect(csvParam('a, b,,c')).toEqual(['a', 'b', 'c'])
    expect(csvParam('')).toBeUndefined()
    expect(csvParam(['x', 'y'])).toEqual(['x', 'y'])
  })
})
