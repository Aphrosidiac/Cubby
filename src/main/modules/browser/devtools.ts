// The DevToolsActivePort file Chrome writes into its user-data-dir when started with
// --remote-debugging-port=0, and the /json/version probe that tells a live Chrome from a stale file.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export interface DevToolsPort {
  port: number
  /** "/devtools/browser/<guid>" — unique per Chrome launch */
  wsPath: string
}

/** Parse the file's text: line 1 = port, line 2 = browser ws path. Null when incomplete. Pure. */
export function parseDevToolsActivePort(text: string): DevToolsPort | null {
  const [p, ws] = text.split(/\r?\n/).map((l) => l.trim())
  const port = Number(p)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (!ws || !ws.startsWith('/devtools/browser/')) return null
  return { port, wsPath: ws }
}

export const devToolsFile = (profileDir: string): string => join(profileDir, 'DevToolsActivePort')

export function readDevToolsActivePort(profileDir: string): DevToolsPort | null {
  const f = devToolsFile(profileDir)
  if (!existsSync(f)) return null
  try {
    return parseDevToolsActivePort(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

export function removeDevToolsActivePort(profileDir: string): void {
  try {
    rmSync(devToolsFile(profileDir), { force: true })
  } catch {
    /* Chrome may hold it; a live Chrome is detected before this is called */
  }
}

export interface JsonVersion {
  Browser: string
  webSocketDebuggerUrl: string
}

/** GET http://127.0.0.1:<port>/json/version with a short timeout; null when nothing answers. */
export async function probeVersion(port: number, timeoutMs = 1500): Promise<JsonVersion | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const v = (await r.json()) as JsonVersion
    return v && typeof v.webSocketDebuggerUrl === 'string' ? v : null
  } catch {
    return null
  }
}

/** True when the port answers AND it is the same Chrome launch that wrote the file (not a reused port). */
export async function isLive(dt: DevToolsPort, timeoutMs = 1500): Promise<boolean> {
  const v = await probeVersion(dt.port, timeoutMs)
  if (!v) return false
  try {
    return new URL(v.webSocketDebuggerUrl).pathname === dt.wsPath
  } catch {
    return false
  }
}
