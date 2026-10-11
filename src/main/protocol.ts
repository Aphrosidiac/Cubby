// cubby-file:// serves local images/videos to the renderer (thumbnails, screenshots, media preview).
// Only files under the data folder, indexed media, or watch folders are served.
import { net, protocol } from 'electron'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { db } from './core/db'
import { paths } from './core/paths'

protocol.registerSchemesAsPrivileged([{ scheme: 'cubby-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }])

function allowed(p: string): boolean {
  const abs = resolve(p)
  const under = (root: string) => {
    const r = resolve(root)
    return abs === r || abs.toLowerCase().startsWith((r + sep).toLowerCase())
  }
  if (under(paths.root)) return true
  if (db.get('SELECT 1 FROM media WHERE path = ?', p)) return true
  return db.all<{ path: string }>('SELECT path FROM watch_folders').some((w) => under(w.path))
}

export function registerFileProtocol(): void {
  protocol.handle('cubby-file', (req) => {
    const u = new URL(req.url)
    const p = u.searchParams.get('p') ?? ''
    if (!p || !allowed(p)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(p).toString(), { headers: req.headers, method: req.method })
  })
}
