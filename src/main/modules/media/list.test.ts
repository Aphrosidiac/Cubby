import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, openDb } from '../../core/db'
import { initPaths, paths } from '../../core/paths'
import { invoke } from '../../core/registry'
import './index'

const row = (id: string, filename: string, missing: number, addedAt: string) =>
  db.run(
    `INSERT INTO media (id, path, filename, kind, hash, size_bytes, tags, platform_fit, fit_notes, added_at, missing) VALUES (?, ?, ?, 'video', 'h', 10, '["demo"]', '{}', '{}', ?, ?)`,
    id, join('C:\\media', filename), filename, addedAt, missing
  )

beforeAll(() => {
  delete process.env.CUBBY_DATA_DIR
  initPaths(mkdtempSync(join(tmpdir(), 'cubby-media-list-')))
  openDb(paths.db)
  row('med_a', 'here.mp4', 0, '2026-10-11T01:00:00Z')
  row('med_b', 'gone.mp4', 1, '2026-10-11T02:00:00Z')
})

describe('media.list', () => {
  it('leaves missing files out by default (pickers, Local API, MCP)', async () => {
    const list = await invoke('media.list', {}, { actor: 'you' })
    expect(list.map((a) => a.id)).toEqual(['med_a'])
  })

  it('includes missing files when the library page asks, flagged and still filterable', async () => {
    const list = await invoke('media.list', { includeMissing: true }, { actor: 'you' })
    expect(list.map((a) => [a.id, a.missing])).toEqual([['med_b', true], ['med_a', false]])
    const q = await invoke('media.list', { includeMissing: true, q: 'gone' }, { actor: 'you' })
    expect(q.map((a) => a.id)).toEqual(['med_b'])
  })
})
