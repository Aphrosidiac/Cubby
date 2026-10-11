// Backup + transfer (PLAN §11): encrypted archives (tar-stream + gzip + AES-256-GCM, scrypt key) of an
// app.sqlite snapshot (db.snapshotTo) + brand profiles minus caches; restore = merge brands that are
// not here; .brand export/import (settings, accounts, optional credentials, cookies via CDP,
// re-encrypted with the passphrase); keep the newest N archives.
// Implements commands: backup.run, backup.list, backup.restore, transfer.export, transfer.import
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { BackupInfo } from '@shared/types'
import { db } from '../../core/db'
import { UserError } from '../../core/errors'
import { emit, toast } from '../../core/events'
import { paths } from '../../core/paths'
import { implement } from '../../core/registry'
import { requestStatus } from '../../core/runtime'
import { getSettings } from '../../core/settings'
import { getBackupPassphrase } from '../app'
import { listBrandsRaw } from '../brands/repo'
import { getContext, isBrandOpen } from '../browser'
import { createArchive } from './archive'
import { readCookies } from './cookies'
import { BACKUP_RE, backupFileName, skipProfilePath, toPrune } from './names'
import { restoreBackup } from './restore'
import { exportBrands, importBrands } from './transfer'

const DIFFERENT_MACHINE_NOTE = 'Profiles restored on a different computer lose their logins (cookies are tied to the computer) — use Export/Import brands to move between machines.'

let running = false

async function pruneFolder(folder: string, keep: number): Promise<void> {
  const files = await Promise.all(
    (await readdir(folder).catch(() => [] as string[]))
      .filter((n) => BACKUP_RE.test(n))
      .map(async (name) => ({ name, mtimeMs: (await stat(join(folder, name)).catch(() => ({ mtimeMs: 0 }))).mtimeMs }))
  )
  for (const f of toPrune(files, keep)) {
    await rm(join(folder, f.name), { force: true }).catch((e) => console.warn('could not prune backup', f.name, e))
  }
}

/** Run a backup now. Used by backup.run and the scheduler's daily trigger. */
export async function runBackup(passphraseIn?: string, folderIn?: string): Promise<BackupInfo & { warnings: string[] }> {
  const passphrase = passphraseIn || getBackupPassphrase()
  if (!passphrase) throw new UserError('Set a backup passphrase in Settings → Backups')
  const s = getSettings()
  const folder = resolve(folderIn || s.backup.folder || paths.backups)
  try {
    await mkdir(folder, { recursive: true })
  } catch (e) {
    throw new UserError(`Can't write to the backup folder ${folder} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
  }
  if (running) throw new UserError('A backup is already running')
  running = true
  const at = new Date()
  let out = join(folder, backupFileName(at))
  for (let i = 2; existsSync(out); i++) out = join(folder, backupFileName(at).replace(/\.cubbybak$/, `-${i}.cubbybak`))
  const snap = join(paths.tmp, `backup-${Date.now()}.sqlite`)
  const w = createArchive(out, passphrase)
  try {
    db.snapshotTo(snap)
    if (!(await w.addFile('app.sqlite', snap))) throw new UserError('Could not read the database snapshot')
    const brands = listBrandsRaw(true)
    for (const b of brands) {
      // an open brand's Chrome holds Cookies locked (Windows) — take them over CDP instead
      if (isBrandOpen(b.id)) {
        try {
          const cookies = await readCookies(await getContext(b.id, false))
          await w.addBuffer(`cookies/${b.slug}.json`, Buffer.from(JSON.stringify(cookies)))
        } catch (e) {
          w.warnings.push(`${b.name}: cookies not read over CDP (${(e as Error).message})`)
        }
      }
      if (existsSync(b.profileDir)) await w.addDir(`profiles/${b.slug}`, b.profileDir, skipProfilePath)
    }
    const manifest = {
      format: 'cubby-backup',
      version: 1,
      createdAt: at.toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug, open: isBrandOpen(b.id), deleted: !!b.deletedAt })),
      warnings: w.warnings
    }
    await w.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
    await w.finish()
  } catch (e) {
    await w.abort()
    throw e
  } finally {
    running = false
    await rm(snap, { force: true }).catch(() => {})
  }
  await pruneFolder(folder, s.backup.keep)
  const st = await stat(out)
  if (w.warnings.length) toast('warn', `Backup saved with ${w.warnings.length} skipped item${w.warnings.length === 1 ? '' : 's'}: ${w.warnings.slice(0, 2).join('; ')}${w.warnings.length > 2 ? '…' : ''}`)
  return { path: out, sizeBytes: st.size, at: at.toISOString(), warnings: [...w.warnings] }
}

async function listBackups(): Promise<BackupInfo[]> {
  const s = getSettings()
  const folders = [...new Set([s.backup.folder, paths.backups].filter((f): f is string => !!f).map((f) => resolve(f)))]
  const out: BackupInfo[] = []
  for (const f of folders) {
    for (const name of await readdir(f).catch(() => [] as string[])) {
      if (!BACKUP_RE.test(name)) continue
      const st = await stat(join(f, name)).catch(() => null)
      if (st?.isFile()) out.push({ path: join(f, name), sizeBytes: st.size, at: st.mtime.toISOString() })
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

implement({
  'backup.run': async ({ passphrase, folder }) => {
    const { warnings: _w, ...info } = await runBackup(passphrase, folder)
    return info
  },
  'backup.list': () => listBackups(),
  'backup.restore': async ({ path, passphrase }) => {
    const r = await restoreBackup(resolve(path), passphrase)
    if (r.brands) {
      emit('brands.changed', {})
      emit('posts.changed', {})
      emit('media.changed', {})
      requestStatus()
    }
    const head = r.brands ? `Restored ${r.brands} brand${r.brands === 1 ? '' : 's'}.` : 'Nothing to restore — every brand in this backup is already here.'
    toast(r.warnings.length ? 'warn' : 'good', [head, r.brands ? DIFFERENT_MACHINE_NOTE : '', ...r.warnings.slice(0, 3)].filter(Boolean).join(' '))
    return { brands: r.brands }
  },
  'transfer.export': async ({ ids, includeCredentials, passphrase, path }) => {
    const r = await exportBrands(ids, includeCredentials, passphrase, path)
    if (r.warnings.length) toast('warn', r.warnings.join(' · '))
    return { path: r.path, brands: r.brands }
  },
  'transfer.import': async ({ path, passphrase }) => (await importBrands(resolve(path), passphrase)).brands
})

export function start(): void {}
export async function stop(): Promise<void> {}
