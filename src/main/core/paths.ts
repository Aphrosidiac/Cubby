// Where Cubby keeps its files. CUBBY_DATA_DIR overrides (tests, e2e, a second instance).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let root = ''

export function initPaths(dir: string): void {
  root = process.env.CUBBY_DATA_DIR || dir
  for (const d of ['', 'profiles', 'screens', 'thumbs', 'exports', 'backups', 'logs', 'tmp']) mkdirSync(join(root, d), { recursive: true })
}

export const paths = {
  get root(): string {
    if (!root) throw new Error('paths not initialised')
    return root
  },
  get db(): string { return join(paths.root, 'app.sqlite') },
  get profiles(): string { return join(paths.root, 'profiles') },
  get screens(): string { return join(paths.root, 'screens') },
  get thumbs(): string { return join(paths.root, 'thumbs') },
  get exports(): string { return join(paths.root, 'exports') },
  get backups(): string { return join(paths.root, 'backups') },
  get logs(): string { return join(paths.root, 'logs') },
  get tmp(): string { return join(paths.root, 'tmp') },
  profile: (slug: string): string => join(paths.profiles, slug)
}
