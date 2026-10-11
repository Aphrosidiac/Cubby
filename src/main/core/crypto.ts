// Passphrase encryption for exports and backups: scrypt key + AES-256-GCM.
// Format (buffer and stream): MAGIC(8) | salt(16) | iv(12) | ciphertext… | tag(16)
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, type DecipherGCM } from 'node:crypto'
import { Transform, type TransformCallback } from 'node:stream'
import { UserError } from './errors'

const MAGIC = Buffer.from('CUBBYEN1')
const HEAD = MAGIC.length + 16 + 12
const TAG = 16

function key(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(passphrase, salt), iv)
  const body = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()])
}

export function decryptBuffer(data: Buffer, passphrase: string): Buffer {
  if (data.length < HEAD + TAG || !data.subarray(0, MAGIC.length).equals(MAGIC)) throw new UserError('Not a Cubby encrypted file')
  const salt = data.subarray(MAGIC.length, MAGIC.length + 16)
  const iv = data.subarray(MAGIC.length + 16, HEAD)
  const d = createDecipheriv('aes-256-gcm', key(passphrase, salt), iv)
  d.setAuthTag(data.subarray(data.length - TAG))
  try {
    return Buffer.concat([d.update(data.subarray(HEAD, data.length - TAG)), d.final()])
  } catch {
    throw new UserError('Wrong passphrase, or the file is damaged')
  }
}

export const isEncrypted = (data: Buffer): boolean => data.subarray(0, MAGIC.length).equals(MAGIC)

/** Streaming encrypt: pipe plaintext in, encrypted bytes (same format) out. */
export function encryptStream(passphrase: string): Transform {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(passphrase, salt), iv)
  let started = false
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (!started) {
        this.push(Buffer.concat([MAGIC, salt, iv]))
        started = true
      }
      cb(null, c.update(chunk))
    },
    flush(cb: TransformCallback) {
      if (!started) this.push(Buffer.concat([MAGIC, salt, iv]))
      this.push(c.final())
      this.push(c.getAuthTag())
      cb()
    }
  })
}

/** Streaming decrypt. Holds back the last 16 bytes (the tag) until the end; throws UserError on a bad passphrase. */
export function decryptStream(passphrase: string): Transform {
  let head = Buffer.alloc(0)
  let d: DecipherGCM | null = null
  let tail = Buffer.alloc(0)
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        if (!d) {
          head = Buffer.concat([head, chunk])
          if (head.length < HEAD) return cb()
          if (!head.subarray(0, MAGIC.length).equals(MAGIC)) return cb(new UserError('Not a Cubby encrypted file'))
          d = createDecipheriv('aes-256-gcm', key(passphrase, head.subarray(MAGIC.length, MAGIC.length + 16)), head.subarray(MAGIC.length + 16, HEAD))
          chunk = head.subarray(HEAD)
        }
        const buf = Buffer.concat([tail, chunk])
        if (buf.length <= TAG) {
          tail = buf
          return cb()
        }
        tail = buf.subarray(buf.length - TAG)
        cb(null, d.update(buf.subarray(0, buf.length - TAG)))
      } catch (e) {
        cb(e as Error)
      }
    },
    flush(cb: TransformCallback) {
      try {
        if (!d) return cb(new UserError('Not a Cubby encrypted file'))
        d.setAuthTag(tail)
        this.push(d.final())
        cb()
      } catch {
        cb(new UserError('Wrong passphrase, or the file is damaged'))
      }
    }
  })
}
