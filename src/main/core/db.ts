// SQLite through Node's built-in node:sqlite (no native module). Synchronous, WAL, one connection.
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Param = SQLInputValue | boolean | undefined
type Row = Record<string, unknown>

let conn: DatabaseSync | null = null
const stmts = new Map<string, StatementSync>()

export function openDb(file: string): void {
  conn = new DatabaseSync(file)
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;')
  migrate()
}

export function closeDb(): void {
  stmts.clear()
  conn?.close()
  conn = null
}

function c(): DatabaseSync {
  if (!conn) throw new Error('database not open')
  return conn
}

function prep(sql: string): StatementSync {
  let s = stmts.get(sql)
  if (!s) {
    s = c().prepare(sql)
    stmts.set(sql, s)
  }
  return s
}

const norm = (p: Param[]): SQLInputValue[] => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))

export const db = {
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return prep(sql).all(...norm(params)) as T[]
  },
  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return prep(sql).get(...norm(params)) as T | undefined
  },
  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = prep(sql).run(...norm(params))
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  },
  exec(sql: string): void {
    c().exec(sql)
  },
  /** Run fn inside a transaction (nested calls join the outer one). fn must be synchronous. */
  tx<T>(fn: () => T): T {
    const d = c()
    if (d.isTransaction) return fn()
    d.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      d.exec('COMMIT')
      return out
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }
  },
  /** Consistent copy of the live database (safe while running). */
  snapshotTo(file: string): void {
    c().prepare('VACUUM INTO ?').run(file)
  }
}

// JSON / boolean column helpers
export const j = (v: unknown): string => JSON.stringify(v ?? null)
export function pj<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || v === '') return fallback
  try {
    return (JSON.parse(v) as T) ?? fallback
  } catch {
    return fallback
  }
}
export const b = (v: unknown): boolean => v === 1 || v === true || v === '1'

function migrate(): void {
  const d = c()
  d.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, at TEXT NOT NULL)')
  const done = new Set((d.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id))
  MIGRATIONS.forEach((sql, i) => {
    const n = i + 1
    if (done.has(n)) return
    db.tx(() => {
      d.exec(sql)
      d.prepare('INSERT INTO _migrations (id, at) VALUES (?, ?)').run(n, new Date().toISOString())
    })
  })
}
