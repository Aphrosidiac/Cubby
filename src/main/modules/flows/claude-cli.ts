// "Ask Claude" flow step: one non-interactive Claude Code call (`claude -p --output-format text`).
// The prompt goes in on stdin, so nothing from the flow is ever parsed by a shell.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { UserError } from '../../core/errors'

const TIMEOUT_MS = 10 * 60_000
let cached: string | null | undefined

/** Path of the Claude Code CLI (claude.exe / claude.cmd on Windows), or null when not installed. */
export async function resolveClaude(refresh = false): Promise<string | null> {
  if (cached !== undefined && !refresh) return cached
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const out = await new Promise<string>((resolve) => execFile(finder, ['claude'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => resolve(err ? '' : String(stdout))))
  const found = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && existsSync(l))
  const rank = (p: string) => (/\.exe$/i.test(p) ? 0 : /\.cmd$/i.test(p) ? 1 : /\.bat$/i.test(p) ? 2 : process.platform === 'win32' ? 9 : 0)
  found.sort((a, b) => rank(a) - rank(b))
  cached = found.find((p) => rank(p) < 9) ?? null
  return cached
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* gone */
    }
  }
}

export async function askClaude(prompt: string, opts: { signal?: AbortSignal; cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  const bin = await resolveClaude()
  if (!bin) throw new UserError('Claude Code is not installed (the `claude` command was not found). Install it from claude.com/claude-code, then run the flow again.')
  const args = ['-p', '--output-format', 'text']
  // .cmd/.bat shims need a shell on Windows; args are constants and the prompt goes through stdin
  const viaShell = /\.(cmd|bat)$/i.test(bin)
  const child = viaShell
    ? spawn(`"${bin}"`, args, { shell: true, windowsHide: true, cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(bin, args, { windowsHide: true, cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  return await new Promise<string>((resolve, reject) => {
    let out = ''
    let err = ''
    let done = false
    const end = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const timer = setTimeout(() => {
      killTree(child.pid)
      end(() => reject(new UserError(`Claude did not answer within ${Math.round((opts.timeoutMs ?? TIMEOUT_MS) / 60_000)} minutes`)))
    }, opts.timeoutMs ?? TIMEOUT_MS)
    const onAbort = () => {
      killTree(child.pid)
      end(() => reject(new Error('Stopped')))
    }
    if (opts.signal?.aborted) return onAbort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => end(() => reject(new UserError(`Could not start Claude Code: ${e.message}`))))
    child.on('close', (code) => {
      if (code === 0) end(() => resolve(out.trim()))
      else end(() => reject(new UserError(`Claude Code exited with code ${code}${err.trim() ? `: ${err.trim().slice(-500)}` : ''}`)))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
  })
}
