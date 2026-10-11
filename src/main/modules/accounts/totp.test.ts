import { describe, expect, it } from 'vitest'
import { isValidTotpSecret, normalizeTotpSecret, totpNow } from './totp'

// RFC 6238 appendix B: ASCII "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ (SHA-1)
const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totp', () => {
  it('matches the RFC 6238 test vectors (last 6 digits)', () => {
    expect(totpNow(RFC, 59_000).code).toBe('287082')
    expect(totpNow(RFC, 1111111109_000).code).toBe('081804')
    expect(totpNow(RFC, 1234567890_000).code).toBe('005924')
    expect(totpNow(RFC, 2000000000_000).code).toBe('279037')
  })
  it('reports seconds left in the window', () => {
    expect(totpNow(RFC, 59_000).remainingSec).toBe(1)
    expect(totpNow(RFC, 60_000).remainingSec).toBe(30)
  })
  it('accepts spaced/lowercase keys, otpauth links and short 10-byte secrets', () => {
    expect(normalizeTotpSecret(' gezd gnbv-gy3t ')).toBe('GEZDGNBVGY3T')
    expect(normalizeTotpSecret('otpauth://totp/IG:me?secret=jbswy3dpehpk3pxp&issuer=IG')).toBe('JBSWY3DPEHPK3PXP')
    expect(totpNow('jbsw y3dp ehpk 3pxp', 59_000).code).toMatch(/^\d{6}$/)
    expect(isValidTotpSecret('JBSWY3DPEHPK3PXP')).toBe(true)
    expect(isValidTotpSecret('not a secret!')).toBe(false)
    expect(isValidTotpSecret('ABC')).toBe(false)
  })
})
