// Media library (PLAN §6.7): index files in place (never copy/move them). ffprobe (ffprobe-static,
// asar-unpacked path fix: replace 'app.asar' with 'app.asar.unpacked') for duration/size/codec/fps,
// ffmpeg (ffmpeg-static) for a 320px JPG thumbnail into paths.thumbs (video: frame at 1 s; image:
// scaled). hash = sha1 of size + first/last 1 MB (fast). platformFit/fitNotes = gradeMedia() against
// every FIT_TARGET. Watch folders: fs.watch (recursive) + debounce, add new media files, mark missing.
// Rescan on start and every 10 min. Implements: media.* commands.
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import type { MediaAsset } from '@shared/types'
import { db, j } from '../../core/db'
import { UserError } from '../../core/errors'
import { emit, toast } from '../../core/events'
import { newId, nowIso } from '../../core/ids'
import { paths } from '../../core/paths'
import { implement } from '../../core/registry'
import { gradeAll, makeThumb, mediaKindOfPath, probeFile, quickHash } from './probe'
import { listFolders, mapMedia, mediaByIds, mediaByPath, postsUsing, type MediaDbRow } from './repo'

const RESCAN_MS = 10 * 60_000
const DEBOUNCE_MS = 1500

/** Assets by id, in the order asked; unknown ids are dropped. Used by posts / recipes. */
export function getAssets(ids: string[]): MediaAsset[] {
  return mediaByIds(ids)
}

const changed = (): void => emit('media.changed', {})

// ── indexing ────────────────────────────────────────────────────────────────
interface IndexResult {
  asset: MediaAsset | null
  added: boolean
  error?: string
}

const inflight = new Map<string, Promise<IndexResult>>()

/** Index one file (dedupe by path). Existing rows are returned as-is (a missing one is revived). */
function indexFile(path: string, tags: string[]): Promise<IndexResult> {
  const p = resolve(path)
  let job = inflight.get(p)
  if (!job) {
    job = doIndex(p, tags).finally(() => inflight.delete(p))
    inflight.set(p, job)
  }
  return job
}

async function doIndex(p: string, tags: string[]): Promise<IndexResult> {
  const existing = mediaByPath(p)
  if (existing) {
    if (existing.missing && existsSync(p)) {
      db.run('UPDATE media SET missing = 0 WHERE id = ?', existing.id)
      return { asset: { ...existing, missing: false }, added: false }
    }
    return { asset: existing, added: false }
  }
  if (!mediaKindOfPath(p)) return { asset: null, added: false, error: `${basename(p)}: not a supported media type` }
  let hash: string
  let size: number
  try {
    ;({ hash, size } = await quickHash(p))
  } catch (e) {
    return { asset: null, added: false, error: `${basename(p)}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'file not found' : (e as Error).message}` }
  }
  const facts = await probeFile(p)
  if (!facts) return { asset: null, added: false, error: `${basename(p)}: could not read this file (unsupported or damaged)` }
  const id = newId('med_')
  const thumbPath = join(paths.thumbs, `${id}.jpg`)
  const thumb = (await makeThumb(p, thumbPath, facts)) ? thumbPath : null
  const { platformFit, fitNotes } = gradeAll({ ...facts, sizeBytes: size })
  const r = db.run(
    `INSERT INTO media (id, path, filename, kind, hash, duration_ms, width, height, fps, codec, size_bytes, thumb, tags, platform_fit, fit_notes, added_at, missing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(path) DO NOTHING`,
    id, p, basename(p), facts.kind, hash, facts.durationMs, facts.width, facts.height, facts.fps, facts.codec, size, thumb, j(dedupeTags(tags)), j(platformFit), j(fitNotes), nowIso()
  )
  if (!r.changes) {
    // indexed meanwhile by another path through the app (e.g. watcher + add at once)
    if (thumb) await rm(thumb, { force: true }).catch(() => {})
    return { asset: mediaByPath(p), added: false }
  }
  return { asset: mediaByIds([id])[0] ?? null, added: true }
}

const dedupeTags = (tags: string[]): string[] => {
  const seen = new Set<string>()
  return tags.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
}

/** Supported media files under a folder (recursive; skips hidden folders and node_modules). */
async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '$RECYCLE.BIN') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      await walk(p, out)
    } else if (e.isFile() && mediaKindOfPath(e.name)) out.push(p)
  }
  return out
}

/** Index files and folders; returns every asset (new + already indexed) and the per-file errors. */
async function addPaths(inputs: string[], tags: string[]): Promise<{ assets: MediaAsset[]; added: number; errors: string[] }> {
  const files: string[] = []
  const errors: string[] = []
  for (const raw of inputs) {
    const p = resolve(raw)
    try {
      const s = await stat(p)
      if (s.isDirectory()) files.push(...(await walk(p)))
      else files.push(p)
    } catch {
      errors.push(`${raw}: not found`)
    }
  }
  const results = await Promise.all([...new Set(files)].map((f) => indexFile(f, tags)))
  const assets: MediaAsset[] = []
  let added = 0
  for (const r of results) {
    if (r.asset) assets.push(r.asset)
    if (r.added) added++
    if (r.error) errors.push(r.error)
  }
  return { assets, added, errors }
}

// ── missing detection / rescan ──────────────────────────────────────────────
function markMissingUnder(p: string): number {
  const prefix = p.endsWith(sep) ? p : p + sep
  const r = db.run("UPDATE media SET missing = 1 WHERE missing = 0 AND (path = ? OR substr(path, 1, length(?)) = ?)", p, prefix, prefix)
  return r.changes
}

let scanning: Promise<{ added: number; missing: number }> | null = null

/** Index new files in every watch folder and flag files that disappeared (or came back). */
function rescan(): Promise<{ added: number; missing: number }> {
  if (!scanning) {
    scanning = (async () => {
      let added = 0
      let flips = 0
      for (const f of listFolders()) {
        if (!existsSync(f.path)) continue
        // a drive that was unplugged at start (or a watcher that errored) gets watched again
        if (!watchers.has(f.id)) startWatcher(f.id, f.path, f.tags)
        const r = await addPaths([f.path], f.tags)
        added += r.added
      }
      for (const row of db.all<{ id: string; path: string; missing: number }>('SELECT id, path, missing FROM media')) {
        const there = existsSync(row.path)
        if (there === !!row.missing) {
          db.run('UPDATE media SET missing = ? WHERE id = ?', there ? 0 : 1, row.id)
          flips++
        }
      }
      const missing = db.get<{ n: number }>('SELECT count(*) n FROM media WHERE missing = 1')?.n ?? 0
      if (added || flips) changed()
      return { added, missing }
    })().finally(() => {
      scanning = null
    })
  }
  return scanning
}

// ── watch folders ───────────────────────────────────────────────────────────
const watchers = new Map<string, FSWatcher>()
const pending = new Map<string, string[]>() // path → tags of the folder it came from
let flushTimer: NodeJS.Timeout | null = null

/** Wait until a file stops growing (a render or copy still in progress). */
async function settled(p: string): Promise<boolean> {
  let last = -1
  for (let i = 0; i < 120; i++) {
    let size: number
    try {
      size = (await stat(p)).size
    } catch {
      return false
    }
    if (size === last && size > 0) return true
    last = size
    await new Promise((r) => setTimeout(r, 1000))
  }
  return true
}

async function flushPending(): Promise<void> {
  const batch = [...pending.entries()]
  pending.clear()
  let dirty = false
  await Promise.all(
    batch.map(async ([p, tags]) => {
      if (!existsSync(p)) {
        if (markMissingUnder(p)) dirty = true
        return
      }
      try {
        const s = await stat(p)
        if (s.isDirectory()) {
          const r = await addPaths([p], tags)
          if (r.added) dirty = true
          return
        }
      } catch {
        return
      }
      if (!mediaKindOfPath(p)) return
      if (!(await settled(p))) return
      const r = await indexFile(p, tags)
      if (r.added || (r.asset && !r.asset.missing)) dirty = true
    })
  )
  if (dirty) changed()
}

function startWatcher(id: string, folder: string, tags: string[]): void {
  stopWatcher(id)
  try {
    const w = watch(folder, { recursive: true }, (_ev, name) => {
      if (!name) return
      const p = join(folder, name.toString())
      if (basename(p).startsWith('.')) return
      pending.set(p, tags)
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = setTimeout(() => {
        flushTimer = null
        flushPending().catch((e) => console.warn('media watch flush failed', e))
      }, DEBOUNCE_MS)
    })
    w.on('error', (e) => {
      console.warn('media watcher stopped', folder, e)
      stopWatcher(id)
    })
    watchers.set(id, w)
  } catch (e) {
    console.warn('could not watch folder', folder, e)
  }
}

function stopWatcher(id: string): void {
  watchers.get(id)?.close()
  watchers.delete(id)
}

// ── commands ────────────────────────────────────────────────────────────────
implement({
  'media.list': ({ q, tag, kind, ids }) => {
    if (ids?.length) return mediaByIds(ids).filter((a) => (!kind || a.kind === kind))
    const where = ['missing = 0']
    const params: string[] = []
    if (kind) {
      where.push('kind = ?')
      params.push(kind)
    }
    if (q?.trim()) {
      where.push('(filename LIKE ? OR tags LIKE ?)')
      const like = `%${q.trim().replace(/^#/, '')}%`
      params.push(like, like)
    }
    let rows = db.all<MediaDbRow>(`SELECT * FROM media WHERE ${where.join(' AND ')} ORDER BY added_at DESC, id DESC`, ...params).map(mapMedia)
    if (tag) rows = rows.filter((a) => a.tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
    return rows
  },

  'media.add': async ({ paths: inputs, tags }) => {
    const r = await addPaths(inputs, tags ?? [])
    if (!r.assets.length && r.errors.length) throw new UserError(r.errors.slice(0, 3).join('; ') + (r.errors.length > 3 ? ` (+${r.errors.length - 3} more)` : ''))
    if (r.errors.length) toast('warn', `Skipped ${r.errors.length} file${r.errors.length === 1 ? '' : 's'}: ${r.errors.slice(0, 2).join('; ')}${r.errors.length > 2 ? '…' : ''}`)
    changed()
    return r.assets
  },

  'media.update': ({ id, tags }) => {
    const r = db.run('UPDATE media SET tags = ? WHERE id = ?', j(dedupeTags(tags)), id)
    if (!r.changes) throw new UserError('Media file not found', 'not_found')
    changed()
    return mediaByIds([id])[0]
  },

  'media.remove': async ({ ids }) => {
    const rows = mediaByIds(ids)
    db.tx(() => ids.forEach((id) => db.run('DELETE FROM media WHERE id = ?', id)))
    for (const a of rows) {
      if (a.thumb) await rm(a.thumb, { force: true }).catch(() => {})
    }
    changed()
  },

  'media.usage': ({ id }) => postsUsing(id),

  'media.rescan': () => rescan(),

  'media.folders': () => listFolders(),

  'media.addFolder': async ({ path, tags }) => {
    const p = resolve(path)
    let isDir = false
    try {
      isDir = (await stat(p)).isDirectory()
    } catch {
      /* missing */
    }
    if (!isDir) throw new UserError(`Folder not found: ${path}`)
    const t = dedupeTags(tags ?? [])
    const dup = listFolders().find((f) => f.path.toLowerCase() === p.toLowerCase())
    if (dup) throw new UserError('That folder is already watched')
    const id = newId('wf_')
    db.run('INSERT INTO watch_folders (id, path, tags) VALUES (?, ?, ?)', id, p, j(t))
    startWatcher(id, p, t)
    // index what is already there in the background — a big folder can take minutes
    addPaths([p], t)
      .then((r) => {
        if (r.added) {
          changed()
          toast('good', `Indexed ${r.added} file${r.added === 1 ? '' : 's'} from ${basename(p)}`)
        }
      })
      .catch((e) => console.warn('initial folder scan failed', e))
    changed()
    return { id, path: p, tags: t }
  },

  'media.removeFolder': ({ id }) => {
    stopWatcher(id)
    db.run('DELETE FROM watch_folders WHERE id = ?', id)
    changed()
  }
})

let timer: NodeJS.Timeout | null = null
let firstScan: NodeJS.Timeout | null = null

export function start(): void {
  for (const f of listFolders()) {
    if (existsSync(f.path)) startWatcher(f.id, f.path, f.tags)
  }
  firstScan = setTimeout(() => rescan().catch((e) => console.warn('media rescan failed', e)), 5000)
  timer = setInterval(() => rescan().catch((e) => console.warn('media rescan failed', e)), RESCAN_MS)
}

export async function stop(): Promise<void> {
  if (timer) clearInterval(timer)
  if (firstScan) clearTimeout(firstScan)
  if (flushTimer) clearTimeout(flushTimer)
  for (const id of [...watchers.keys()]) stopWatcher(id)
}
