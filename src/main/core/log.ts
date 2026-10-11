// Main-process log file: everything printed to the console also goes to <data>/logs/main.log
// (rotated at 5 MB, 3 old files kept) so problems on someone's machine can be read afterwards.
import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

const MAX = 5 * 1024 * 1024
const KEEP = 3

export function startLogFile(dir: string): string {
  const file = join(dir, 'main.log')
  const rotate = () => {
    try {
      if (!existsSync(file) || statSync(file).size < MAX) return
      const old = (n: number) => join(dir, `main.${n}.log`)
      if (existsSync(old(KEEP))) unlinkSync(old(KEEP))
      for (let n = KEEP - 1; n >= 1; n--) if (existsSync(old(n))) renameSync(old(n), old(n + 1))
      renameSync(file, old(1))
    } catch {
      /* never let logging break the app */
    }
  }
  rotate()
  let writes = 0
  const write = (level: string, args: unknown[]) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level.padEnd(5)} ${format(...args)}\n`)
      if (++writes % 500 === 0) rotate()
    } catch {
      /* disk full or locked — keep going */
    }
  }
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      orig(...args)
      write(level, args)
    }
  }
  process.on('uncaughtException', (e) => console.error('uncaught exception', e))
  process.on('unhandledRejection', (e) => console.error('unhandled rejection', e))
  return file
}
