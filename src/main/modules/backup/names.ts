// Pure helpers for backup / transfer: file names, pruning, name collisions, profile skip rules.

const pad = (n: number): string => String(n).padStart(2, '0')
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Cubby-backup-YYYY-MM-DD-HHmm.cubbybak (local time). */
export function backupFileName(d: Date): string {
  return `Cubby-backup-${ymd(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.cubbybak`
}

export const BACKUP_RE = /^Cubby-backup-.*\.cubbybak$/i

/** A filesystem-safe base name (Windows-reserved characters stripped). */
export function safeFileBase(s: string): string {
  return (
    s
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 60) || 'brands'
  )
}

/** <name or "brands">-YYYY-MM-DD.brand */
export function exportFileName(names: string[], d: Date): string {
  return `${names.length === 1 ? safeFileBase(names[0]) : 'brands'}-${ymd(d)}.brand`
}

/** Archives to delete so only the newest `keep` remain. Input: name + mtime (ms). */
export function toPrune<T extends { name: string; mtimeMs: number }>(files: T[], keep: number): T[] {
  const sorted = files.filter((f) => BACKUP_RE.test(f.name)).sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
  return sorted.slice(Math.max(1, Math.floor(keep)))
}

/** "Name", "Name (2)", "Name (3)"… — first one not in `taken` (case-insensitive). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((t) => t.trim().toLowerCase()))
  const base = name.trim()
  if (!set.has(base.toLowerCase())) return base
  const stem = base.replace(/\s\(\d+\)$/, '')
  for (let i = 2; ; i++) {
    const n = `${stem} (${i})`
    if (!set.has(n.toLowerCase())) return n
  }
}

// Chrome profile content that is cache, lock or log — rebuilt by Chrome, worthless in a backup.
const SKIP_DIRS = new Set(
  ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GraphiteDawnCache', 'GrShaderCache', 'ShaderCache', 'Crashpad', 'Crash Reports', 'component_crx_cache', 'BrowserMetrics'].map((s) =>
    s.toLowerCase()
  )
)
const SKIP_FILES = new Set(['lock', 'singletonlock', 'singletoncookie', 'singletonsocket', 'devtoolsactiveport', 'log', 'log.old'])

/**
 * True when a path inside a profile folder should not go into a backup. `rel` is relative to the
 * profile folder, any separator. LevelDB keeps not-yet-compacted data in numbered `000123.log`
 * files (Local Storage, IndexedDB), so those are kept; other *.log files are skipped.
 */
export function skipProfilePath(rel: string): boolean {
  const low = rel.split(/[\\/]+/).filter(Boolean).map((p) => p.toLowerCase())
  for (let i = 0; i < low.length; i++) {
    const seg = low[i]
    if (SKIP_DIRS.has(seg) || seg.startsWith('optimization_guide_')) return true
    if (seg === 'service worker' && (low[i + 1] === 'cachestorage' || low[i + 1] === 'scriptcache')) return true
  }
  const name = low[low.length - 1] ?? ''
  if (SKIP_FILES.has(name)) return true
  if (name.endsWith('.log') && !/^\d+\.log$/.test(name)) return true
  if (name.endsWith('.pma') || name.endsWith('.tmp')) return true
  return false
}

/** Tar entry name → safe relative path (no absolute paths, no ".."). Null = reject. */
export function safeEntryName(name: string): string | null {
  const parts = name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
  if (!parts.length || parts.some((p) => p === '..' || /^[a-zA-Z]:$/.test(p))) return null
  return parts.join('/')
}
