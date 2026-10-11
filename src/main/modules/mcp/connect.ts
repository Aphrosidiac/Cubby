// claude.connect helpers: build the `claude mcp add` command for Cubby's MCP server and run the
// Claude Code CLI. Pure command building is unit-tested; nothing here touches the person's config
// unless runCli is called.
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SERVER_NAME = 'cubby'

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

export function buildAddArgs(scope: 'user' | 'local', port: number, token: string): string[] {
  return ['mcp', 'add', '--transport', 'http', '-s', scope, SERVER_NAME, mcpUrl(port), '--header', `Authorization: Bearer ${token}`]
}

export function buildRemoveArgs(scope: 'user' | 'local'): string[] {
  return ['mcp', 'remove', SERVER_NAME, '-s', scope]
}

// Only these characters ever appear in our arguments (token = base64url); anything else is refused
// rather than escaped, so cmd.exe (needed for claude.cmd) can never be handed shell syntax.
const SAFE_ARG = /^[A-Za-z0-9_:/.\-@ ]*$/

/** Quote one argument for cmd.exe / sh display. Throws on characters outside SAFE_ARG. */
export function quoteArg(a: string): string {
  if (!SAFE_ARG.test(a)) throw new Error(`unsafe argument for the shell: ${a}`)
  return a === '' || a.includes(' ') ? `"${a}"` : a
}

/** The command line as a person would type it. */
export function commandLine(args: string[], bin = 'claude'): string {
  return [bin, ...args.map(quoteArg)].join(' ')
}

/** Pick the best CLI from `where claude` output (Windows): .exe, then .cmd, then anything. */
export function pickWindowsCli(whereOutput: string): string | null {
  const lines = whereOutput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.find((l) => /\.exe$/i.test(l)) ?? lines.find((l) => /\.cmd$/i.test(l)) ?? lines.find((l) => !/\.(ps1)$/i.test(l) && /\.[a-z]+$/i.test(l)) ?? null
}

/** Absolute path of the Claude Code CLI, or null when it is not installed / not on PATH. */
export function findClaudeCli(): string | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 })
      const hit = pickWindowsCli(out)
      if (hit) return hit
    } else {
      const out = execFileSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 5_000 }).trim()
      if (out) return out.split('\n')[0]
    }
  } catch {
    /* not on PATH — try the usual install spots */
  }
  const home = homedir()
  const candidates =
    process.platform === 'win32'
      ? [join(home, '.local', 'bin', 'claude.exe'), join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'), join(home, '.claude', 'local', 'claude.exe')]
      : [join(home, '.local', 'bin', 'claude'), join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  return candidates.find((c) => existsSync(c)) ?? desktopBundledCli()
}

/** Claude Code as bundled by the Claude desktop app: <appdata>/Claude/claude-code/<version>/<build>/claude(.exe), newest version. */
export function desktopBundledCli(): string | null {
  const root =
    process.platform === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude-code')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code')
        : join(homedir(), '.config', 'Claude', 'claude-code')
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  let versions: string[] = []
  try {
    versions = readdirSync(root).filter((v) => /^\d+\.\d+\.\d+/.test(v))
  } catch {
    return null
  }
  const num = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number)
  versions.sort((a, b) => {
    const x = num(a)
    const y = num(b)
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
  })
  for (const v of versions) {
    let builds: string[] = []
    try {
      builds = readdirSync(join(root, v))
    } catch {
      continue
    }
    for (const b of builds) {
      const p = join(root, v, b, exe)
      if (existsSync(p)) return p
    }
    if (existsSync(join(root, v, exe))) return join(root, v, exe)
  }
  return null
}

export interface CliResult {
  code: number
  output: string
}

/** Run the CLI. .cmd/.bat shims need cmd.exe; every argument has passed SAFE_ARG first. */
export function runCli(bin: string, args: string[], timeoutMs = 30_000): Promise<CliResult> {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
  const file = needsShell ? `"${bin}"` : bin
  const quoted = args.map(quoteArg) // validates every argument, shell or not
  const argv = needsShell ? quoted : args
  return new Promise((resolve) => {
    execFile(file, argv, { shell: needsShell, windowsHide: true, timeout: timeoutMs, cwd: homedir(), encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : 1) : 0
      resolve({ code, output: `${stdout ?? ''}${stderr ?? ''}`.trim() || (err ? err.message : '') })
    })
  })
}
