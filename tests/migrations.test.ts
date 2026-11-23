import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, Store } from '../src/main/db'

const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm')
const RANGE = { from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' }
let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-migrate-'))
  file = path.join(dir, 'old.db')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Write a database file at an older schema version, the way an earlier release left it. */
async function writeOldDatabase(version: number, seed: string): Promise<void> {
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(fs.readFileSync(WASM)).buffer as ArrayBuffer, useOldExtensionFunctions: false })
  const db = new SQL.Database()
  db.run('PRAGMA foreign_keys = ON')
  for (let v = 0; v < version; v++) db.run(MIGRATIONS[v])
  db.run(`PRAGMA user_version = ${version}`)
  db.run(seed)
  fs.writeFileSync(file, db.export())
  db.close()
}

const V1_SEED = `
  INSERT INTO clients (id, name, created_at) VALUES (1, 'Acme', '2026-10-01T00:00:00.000Z');
  INSERT INTO projects (id, client_id, code, name, color, created_at) VALUES (1, 1, 'ACM-101', 'Site', '#12877A', '2026-10-01T00:00:00.000Z');
  INSERT INTO tags (id, name, created_at) VALUES (1, 'design', '2026-10-01T00:00:00.000Z'), (2, 'admin', '2026-10-01T00:00:00.000Z');
  INSERT INTO time_entries (id, project_id, description, start_utc, end_utc, idle_seconds, created_at, updated_at) VALUES
    (1, 1, 'Wireframes', '2026-10-31T12:00:00.000Z', '2026-10-31T13:00:00.000Z', 120, '2026-10-31T12:00:00.000Z', '2026-10-31T13:00:00.000Z'),
    (2, 1, 'Running', '2026-10-31T14:00:00.000Z', NULL, 0, '2026-10-31T14:00:00.000Z', '2026-10-31T14:00:00.000Z');
  INSERT INTO entry_tags (entry_id, tag_id) VALUES (1, 1), (1, 2), (2, 1);
  INSERT INTO settings (key, value) VALUES ('roundingMinutes', '6');
`

describe('migrations', () => {
  it('upgrades a version 1 database without losing entries or their tags', async () => {
    await writeOldDatabase(1, V1_SEED)
    const s = await Store.open(file, WASM)

    const entries = s.listEntries(RANGE)
    expect(entries).toHaveLength(2)
    expect(s.entry(1)).toMatchObject({ description: 'Wireframes', idleSeconds: 120, tagIds: [1, 2] })
    expect(s.getRunning()).toMatchObject({ id: 2, description: 'Running', tagIds: [1] })
    expect(s.getSettings().roundingMinutes).toBe(6)
    s.close()
  })

  it('stops reusing entry ids after the upgrade, including across reopen', async () => {
    await writeOldDatabase(1, V1_SEED)
    let s = await Store.open(file, WASM)
    const removed = s.deleteEntry(2)!
    const next = s.startTimer({ projectId: 1, description: 'New', tagIds: [] }, '2026-10-31T15:00:00.000Z')
    expect(next.id).toBe(3)
    expect(s.restoreEntry(removed).id).toBe(2)
    s.close()

    s = await Store.open(file, WASM)
    s.deleteEntry(3)
    expect(s.createEntry({ projectId: 1, description: '', start: '2026-10-31T16:00:00.000Z', end: null, tagIds: [] }).id).toBe(4)
    s.close()
  })

  it('keeps indexes and foreign keys working after the upgrade', async () => {
    await writeOldDatabase(1, V1_SEED)
    const s = await Store.open(file, WASM)
    s.close()

    const SQL = await initSqlJs({ wasmBinary: new Uint8Array(fs.readFileSync(WASM)).buffer as ArrayBuffer, useOldExtensionFunctions: false })
    const db = new SQL.Database(fs.readFileSync(file))
    const version = db.exec('PRAGMA user_version')[0].values[0][0]
    expect(version).toBe(MIGRATIONS.length)
    const indexes = db.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'time_entries' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0].values.flat()
    expect(indexes).toEqual(['time_entries_end', 'time_entries_start'])
    expect(db.exec("SELECT name FROM sqlite_master WHERE name = 'time_entries_new'")).toHaveLength(0)
    db.close()

    // Deleting a project still cascades to entries and their tags.
    const s2 = await Store.open(file, WASM)
    s2.deleteProject(1)
    expect(s2.listEntries(RANGE)).toHaveLength(0)
    expect(s2.tagUsage(RANGE)).toEqual({})
    s2.close()
  })

  it('leaves the file untouched if an upgrade fails', async () => {
    // An entry pointing at a missing project: the reference check must reject the upgrade.
    await writeOldDatabase(1, `
      PRAGMA foreign_keys = OFF;
      INSERT INTO time_entries (id, project_id, start_utc, created_at, updated_at) VALUES (1, 99, '2026-10-31T12:00:00.000Z', '', '');
    `)
    const before = fs.readFileSync(file)
    await expect(Store.open(file, WASM)).rejects.toThrow('broken references')
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })

  it('opens an up-to-date database without migrating again', async () => {
    const s = await Store.open(file, WASM)
    s.createProject({ clientId: null, code: '', name: 'P', color: '#000000' })
    s.close()
    const before = fs.readFileSync(file)
    const s2 = await Store.open(file, WASM)
    expect(s2.getCatalog().projects).toHaveLength(1)
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    s2.close()
  })
})
