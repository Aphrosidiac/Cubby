import { randomBytes } from 'node:crypto'

/** Short, time-sortable id. */
export function newId(prefix = ''): string {
  return prefix + Date.now().toString(36).padStart(9, '0') + randomBytes(5).toString('hex')
}

export const nowIso = (): string => new Date().toISOString()

const SLUG_MAX = 40

/** Folder-safe slug, at most 40 characters, cut at a word boundary so it never ends mid-word. */
export function slugify(s: string): string {
  const full = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (full.length <= SLUG_MAX) return full || 'brand'
  const cut = full.slice(0, SLUG_MAX + 1)
  const at = cut.lastIndexOf('-')
  return (at >= 12 ? cut.slice(0, at) : full.slice(0, SLUG_MAX)).replace(/-+$/, '') || 'brand'
}
