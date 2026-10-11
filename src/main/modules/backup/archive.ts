// Encrypted archives: tar (tar-stream) → gzip → AES-256-GCM (core/crypto encryptStream), written
// streaming because profiles can be gigabytes. Electron-free (vitest covers the round trip).
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import * as tar from 'tar-stream'
import { decryptStream, encryptStream } from '../../core/crypto'
import { UserError } from '../../core/errors'
import { safeEntryName } from './names'

const IN_MEMORY_MAX = 64 * 1024 * 1024
const CHUNK = 1024 * 1024
const SKIPPABLE = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOENT', 'ELOOP', 'EINVAL'])

export interface ArchiveWriter {
  addBuffer(name: string, data: Buffer): Promise<void>
  /** false (and a warning) when the file can't be read — e.g. locked by a running Chrome */
  addFile(name: string, file: string): Promise<boolean>
  /** every regular file under `dir` as `<prefix>/<relative path>`, minus what `skip(rel)` rejects */
  addDir(prefix: string, dir: string, skip?: (rel: string) => boolean): Promise<void>
  warnings: string[]
  /** finish and move the archive into place */
  finish(): Promise<{ files: number }>
  abort(): Promise<void>
}

export function createArchive(out: string, passphrase: string): ArchiveWriter {
  const partial = out + '.partial'
  const pack = tar.pack()
  const done = pipeline(pack, createGzip({ level: 6 }), encryptStream(passphrase), createWriteStream(partial))
  let failed: Error | null = null
  done.catch((e: Error) => {
    failed = e
  })
  const warnings: string[] = []
  let files = 0

  // if the output side fails (disk full…) tar-stream callbacks may never fire — race them against it
  const guard = <T>(p: Promise<T>): Promise<T> => Promise.race([p, done.then(() => p)])
  const entry = (header: Partial<tar.Header> & { name: string }, data: Buffer): Promise<void> =>
    guard(
      new Promise<void>((resolve, reject) => {
        if (failed) return reject(failed)
        pack.entry(header, data, (err) => (err ? reject(err) : resolve()))
      })
    )

  async function addBuffer(name: string, data: Buffer): Promise<void> {
    await entry({ name, size: data.length, mtime: new Date(), mode: 0o644 }, data)
    files++
  }

  async function addFile(name: string, file: string): Promise<boolean> {
    let fh: import('node:fs/promises').FileHandle
    try {
      fh = await open(file, 'r')
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      if (SKIPPABLE.has(code)) {
        warnings.push(`${name}: skipped (${code})`)
        return false
      }
      throw e
    }
    try {
      const st = await fh.stat()
      if (st.size <= IN_MEMORY_MAX) {
        // read it whole first: a read error then skips the file cleanly instead of corrupting the tar
        let data: Buffer
        try {
          data = await fh.readFile()
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code ?? 'read error'
          warnings.push(`${name}: skipped (${code})`)
          return false
        }
        await entry({ name, size: data.length, mtime: st.mtime, mode: 0o644 }, data)
        files++
        return true
      }
      // large file: stream exactly st.size bytes (pad if it shrank while we read it)
      let ws!: import('node:stream').Writable
      const finished = new Promise<void>((resolve, reject) => {
        if (failed) return reject(failed)
        ws = pack.entry({ name, size: st.size, mtime: st.mtime, mode: 0o644 }, (err) => (err ? reject(err) : resolve())) as unknown as import('node:stream').Writable
      })
      let pos = 0
      let short = false
      while (pos < st.size) {
        const len = Math.min(CHUNK, st.size - pos)
        let buf = Buffer.alloc(len)
        let n = 0
        if (!short) {
          try {
            n = (await fh.read(buf, 0, len, pos)).bytesRead
          } catch {
            n = 0
          }
          if (n === 0) short = true
          else if (n < len) buf = buf.subarray(0, n)
        }
        pos += buf.length
        if (!ws.write(buf)) await guard(new Promise((r) => ws.once('drain', r)))
      }
      ws.end()
      await guard(finished)
      if (short) warnings.push(`${name}: changed while being read (may be incomplete)`)
      files++
      return true
    } finally {
      await fh.close().catch(() => {})
    }
  }

  async function addDir(prefix: string, dir: string, skip?: (rel: string) => boolean): Promise<void> {
    const walk = async (abs: string, rel: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(abs, { withFileTypes: true })
      } catch (e) {
        warnings.push(`${prefix}/${rel}: folder skipped (${(e as NodeJS.ErrnoException).code ?? 'error'})`)
        return
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (skip?.(r)) continue
        if (e.isDirectory()) {
          await walk(join(abs, e.name), r)
        } else if (e.isFile()) {
          await addFile(`${prefix}/${r}`, join(abs, e.name))
        }
      }
    }
    await walk(dir, '')
  }

  return {
    addBuffer,
    addFile,
    addDir,
    warnings,
    async finish() {
      pack.finalize()
      await done
      await rename(partial, out)
      return { files }
    },
    async abort() {
      pack.destroy()
      await done.catch(() => {})
      await rm(partial, { force: true }).catch(() => {})
    }
  }
}

/** Decrypt + extract an archive into `dest`. Bad passphrase / damaged file → UserError. */
export async function extractArchive(file: string, passphrase: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  const ex = tar.extract()
  ex.on('entry', (header, stream, next) => {
    const rel = safeEntryName(header.name)
    const target = rel ? join(dest, rel) : null
    const skip = () => {
      stream.on('end', () => next())
      stream.resume()
    }
    if (!target) return skip()
    if (header.type === 'directory') {
      mkdir(target, { recursive: true }).then(skip, next)
      return
    }
    if (header.type !== 'file') return skip()
    mkdir(dirname(target), { recursive: true })
      .then(() => pipeline(stream as unknown as NodeJS.ReadableStream, createWriteStream(target)))
      .then(() => next(), next)
  })
  try {
    await pipeline(createReadStream(file), decryptStream(passphrase), createGunzip(), ex)
  } catch (e) {
    if (e instanceof UserError) throw e
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT' && err.path === file) throw new UserError(`Backup file not found: ${file}`)
    if ((err.code && /^Z_/.test(err.code)) || /tar|header|unexpected end/i.test(err.message)) throw new UserError('Wrong passphrase, or the file is damaged')
    throw e
  }
}
