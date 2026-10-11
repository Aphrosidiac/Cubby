// Live 2FA codes (otplib v13, RFC 6238: SHA-1, 6 digits, 30 s). Pure and synchronous.
import { createGuardrails, generateSync } from 'otplib'

const PERIOD = 30
// RFC 4226 recommends ≥16-byte secrets, but many platforms hand out 16-char base32 (10-byte) ones
const GUARDRAILS = createGuardrails({ MIN_SECRET_BYTES: 5 })

/** Accepts "JBSW Y3DP …", lowercase, or an otpauth:// URI; returns the bare base32 secret. */
export function normalizeTotpSecret(input: string): string {
  let s = input.trim()
  if (/^otpauth:\/\//i.test(s)) {
    try {
      s = new URL(s).searchParams.get('secret') ?? ''
    } catch {
      s = ''
    }
  }
  return s.replace(/[\s-]+/g, '').replace(/=+$/, '').toUpperCase()
}

export function isValidTotpSecret(input: string): boolean {
  return /^[A-Z2-7]{8,}$/.test(normalizeTotpSecret(input))
}

/** Current code and seconds left in this 30 s window. */
export function totpNow(secret: string, nowMs = Date.now()): { code: string; remainingSec: number } {
  const epoch = Math.floor(nowMs / 1000)
  const code = generateSync({ secret: normalizeTotpSecret(secret), epoch, period: PERIOD, guardrails: GUARDRAILS })
  return { code, remainingSec: PERIOD - (epoch % PERIOD) }
}
