import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import {
  DEFAULT_SETTINGS,
  type Catalog,
  type Client,
  type ClientInput,
  type Entry,
  type EntryInput,
  type EntryQuery,
  type Project,
  type ProjectInput,
  type Settings,
  type Tag
} from '@shared/types'

/**
 * SQLite storage, backed by sql.js (SQLite compiled to WebAssembly) so the app
 * needs no native modules on any platform. The whole database lives in memory
 * and is written to disk atomically after every change.
 */

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    code TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX projects_unique_label ON projects (lower(code), lower(name));
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE time_entries (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    start_utc TEXT NOT NULL,
    end_utc TEXT,
    idle_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX time_entries_start ON time_entries (start_utc);
  CREATE INDEX time_entries_end ON time_entries (end_utc);
  CREATE TABLE entry_tags (
    entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, tag_id)
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]

export class UserError extends Error {}

export class Store {
  private db!: Database
  private file = ''

  static async open(file: string, wasmPath: string): Promise<Store> {
    const store = new Store()
    const SQL = await initSqlJs({ wasmBinary: new Uint8Array(fs.readFileSync(wasmPath)).buffer as ArrayBuffer, useOldExtensionFunctions: false })
    store.file = file
    if (fs.existsSync(file)) {
      store.db = new SQL.Database(fs.readFileSync(file))
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      store.db = new SQL.Database()
    }
    store.db.run('PRAGMA foreign_keys = ON')
    store.migrate()
    return store
  }

  get path(): string {
    return this.file
  }

  private migrate(): void {
    const version = Number(this.scalar('PRAGMA user_version') ?? 0)
    if (version >= MIGRATIONS.length) return
    this.db.run('BEGIN')
    try {
      for (let v = version; v < MIGRATIONS.length; v++) this.db.run(MIGRATIONS[v])
      this.db.run(`PRAGMA user_version = ${MIGRATIONS.length}`)
      this.db.run('COMMIT')
    } catch (err) {
      this.db.run('ROLLBACK')
      throw err
    }
    this.save()
  }

  /** Write the database to disk atomically: a temp file, then a rename. */
  save(): void {
    if (!this.file) return
    const data = this.db.export()
    // export() resets PRAGMA foreign_keys on some builds; set it again.
    this.db.run('PRAGMA foreign_keys = ON')
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, this.file)
  }

  /** Copy the database to another file. */
  backupTo(target: string): void {
    this.save()
    fs.copyFileSync(this.file, target)
  }

  close(): void {
    this.save()
    this.db.close()
  }

  // ---------- low-level helpers ----------

  private all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  private get<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  private scalar(sql: string, params: SqlValue[] = []): SqlValue | undefined {
    const row = this.get(sql, params)
    return row ? Object.values(row)[0] : undefined
  }

  private run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params)
  }

  private lastId(): number {
    return Number(this.scalar('SELECT last_insert_rowid()'))
  }

  /** Run fn in a transaction and save once afterwards. */
  tx<T>(fn: () => T): T {
    this.db.run('BEGIN')
    try {
      const result = fn()
      this.db.run('COMMIT')
      this.save()
      return result
    } catch (err) {
      this.db.run('ROLLBACK')
      throw translateError(err)
    }
  }

  // ---------- settings ----------

  getSettings(): Settings {
    const rows = this.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const r of rows) {
      try {
        s[r.key] = JSON.parse(r.value)
      } catch {
        /* ignore corrupt value */
      }
    }
    return s as unknown as Settings
  }

  updateSettings(patch: Partial<Settings>): Settings {
    return this.tx(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS) || value === undefined) continue
        this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
          key,
          JSON.stringify(value)
        ])
      }
      return this.getSettings()
    })
  }

  /** Internal key-value storage that is not part of user settings. */
  getMeta(key: string): string | null {
    const v = this.scalar('SELECT value FROM settings WHERE key = ?', [`__${key}`])
    return typeof v === 'string' ? v : null
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [`__${key}`, value])
    this.save()
  }

  // ---------- catalog ----------

  getCatalog(): Catalog {
    const clients = this.all<{ id: number; name: string; archived: number; created_at: string }>(
      'SELECT * FROM clients ORDER BY name COLLATE NOCASE'
    ).map(toClient)
    const projects = this.all<ProjectRow>('SELECT * FROM projects ORDER BY lower(code), lower(name)').map(toProject)
    const tags = this.all<{ id: number; name: string; created_at: string }>('SELECT * FROM tags ORDER BY name COLLATE NOCASE').map(toTag)
    return { clients, projects, tags }
  }

  createClient(input: ClientInput): Client {
    const name = requireText(input.name, 'Client name')
    return this.tx(() => {
      this.run('INSERT INTO clients (name, created_at) VALUES (?, ?)', [name, nowIso()])
      return this.client(this.lastId())
    })
  }

  updateClient(id: number, patch: Partial<ClientInput & { archived: boolean }>): Client {
    return this.tx(() => {
      if (patch.name !== undefined) this.run('UPDATE clients SET name = ? WHERE id = ?', [requireText(patch.name, 'Client name'), id])
      if (patch.archived !== undefined) this.run('UPDATE clients SET archived = ? WHERE id = ?', [patch.archived ? 1 : 0, id])
      return this.client(id)
    })
  }

  deleteClient(id: number): boolean {
    return this.tx(() => {
      this.run('DELETE FROM clients WHERE id = ?', [id])
      return true
    })
  }

  private client(id: number): Client {
    const row = this.get<{ id: number; name: string; archived: number; created_at: string }>('SELECT * FROM clients WHERE id = ?', [id])
    if (!row) throw new UserError('That client no longer exists.')
    return toClient(row)
  }

  createProject(input: ProjectInput): Project {
    const name = requireText(input.name, 'Project name')
    return this.tx(() => {
      this.run('INSERT INTO projects (client_id, code, name, color, created_at) VALUES (?, ?, ?, ?, ?)', [
        input.clientId,
        input.code.trim(),
        name,
        normalizeColor(input.color),
        nowIso()
      ])
      return this.project(this.lastId())
    })
  }

  updateProject(id: number, patch: Partial<ProjectInput & { archived: boolean }>): Project {
    return this.tx(() => {
      if (patch.name !== undefined) this.run('UPDATE projects SET name = ? WHERE id = ?', [requireText(patch.name, 'Project name'), id])
      if (patch.code !== undefined) this.run('UPDATE projects SET code = ? WHERE id = ?', [patch.code.trim(), id])
      if (patch.color !== undefined) this.run('UPDATE projects SET color = ? WHERE id = ?', [normalizeColor(patch.color), id])
      if (patch.clientId !== undefined) this.run('UPDATE projects SET client_id = ? WHERE id = ?', [patch.clientId, id])
      if (patch.archived !== undefined) this.run('UPDATE projects SET archived = ? WHERE id = ?', [patch.archived ? 1 : 0, id])
      return this.project(id)
    })
  }

  deleteProject(id: number): boolean {
    return this.tx(() => {
      this.run('DELETE FROM projects WHERE id = ?', [id])
      return true
    })
  }

  countProjectEntries(id: number): number {
    return Number(this.scalar('SELECT COUNT(*) FROM time_entries WHERE project_id = ?', [id]) ?? 0)
  }

  countClientProjects(id: number): number {
    return Number(this.scalar('SELECT COUNT(*) FROM projects WHERE client_id = ?', [id]) ?? 0)
  }

  countTagEntries(id: number): number {
    return Number(this.scalar('SELECT COUNT(*) FROM entry_tags WHERE tag_id = ?', [id]) ?? 0)
  }

  project(id: number): Project {
    const row = this.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id])
    if (!row) throw new UserError('That project no longer exists.')
    return toProject(row)
  }

  createTag(nameIn: string): Tag {
    const name = requireText(nameIn, 'Tag name')
    const existing = this.get<{ id: number; name: string; created_at: string }>('SELECT * FROM tags WHERE name = ? COLLATE NOCASE', [name])
    if (existing) return toTag(existing)
    return this.tx(() => {
      this.run('INSERT INTO tags (name, created_at) VALUES (?, ?)', [name, nowIso()])
      return this.tag(this.lastId())
    })
  }

  renameTag(id: number, nameIn: string): Tag {
    const name = requireText(nameIn, 'Tag name')
    return this.tx(() => {
      this.run('UPDATE tags SET name = ? WHERE id = ?', [name, id])
      return this.tag(id)
    })
  }

  deleteTag(id: number): boolean {
    return this.tx(() => {
      this.run('DELETE FROM tags WHERE id = ?', [id])
      return true
    })
  }

  private tag(id: number): Tag {
    const row = this.get<{ id: number; name: string; created_at: string }>('SELECT * FROM tags WHERE id = ?', [id])
    if (!row) throw new UserError('That tag no longer exists.')
    return toTag(row)
  }

  // ---------- entries ----------

  listEntries(q: EntryQuery): Entry[] {
    const limit = Number.isInteger(q.limit) && q.limit! > 0 ? q.limit! : -1
    const rows = this.all<EntryRow>(
      `SELECT * FROM time_entries
       WHERE start_utc < ? AND (end_utc IS NULL OR end_utc >= ?)
       ORDER BY start_utc DESC
       LIMIT ?`,
      [q.to, q.from, limit]
    )
    return this.withTags(rows)
  }

  /** Entries whose start falls in [from, to). Used for timesheet export. */
  listEntriesStartingIn(q: EntryQuery): Entry[] {
    const rows = this.all<EntryRow>('SELECT * FROM time_entries WHERE start_utc >= ? AND start_utc < ? ORDER BY start_utc ASC', [q.from, q.to])
    return this.withTags(rows)
  }

  tagUsage(q: EntryQuery): Record<number, number> {
    const rows = this.all<{ tag_id: number; n: number }>(
      `SELECT et.tag_id AS tag_id, COUNT(*) AS n FROM entry_tags et
       JOIN time_entries e ON e.id = et.entry_id
       WHERE e.start_utc < ? AND (e.end_utc IS NULL OR e.end_utc >= ?)
       GROUP BY et.tag_id`,
      [q.to, q.from]
    )
    return Object.fromEntries(rows.map((r) => [r.tag_id, r.n]))
  }

  getRunning(): Entry | null {
    const row = this.get<EntryRow>('SELECT * FROM time_entries WHERE end_utc IS NULL ORDER BY start_utc DESC LIMIT 1')
    return row ? this.withTags([row])[0] : null
  }

  entry(id: number): Entry | null {
    const row = this.get<EntryRow>('SELECT * FROM time_entries WHERE id = ?', [id])
    return row ? this.withTags([row])[0] : null
  }

  /** Stop any running timer at `at` and start a new one. */
  startTimer(input: { projectId: number; description: string; tagIds: number[] }, at: string = nowIso()): Entry {
    this.project(input.projectId)
    return this.tx(() => {
      this.run('UPDATE time_entries SET end_utc = ?, updated_at = ? WHERE end_utc IS NULL', [at, at])
      this.insertEntry({ projectId: input.projectId, description: input.description, start: at, end: null, tagIds: input.tagIds })
      return this.entry(this.lastEntryId)!
    })
  }

  stopTimer(at: string = nowIso()): Entry | null {
    const running = this.getRunning()
    if (!running) return null
    return this.tx(() => {
      const end = at < running.start ? running.start : at
      this.run('UPDATE time_entries SET end_utc = ?, updated_at = ? WHERE id = ?', [end, nowIso(), running.id])
      return this.entry(running.id)
    })
  }

  createEntry(input: EntryInput): Entry {
    validateEntry(input)
    this.project(input.projectId)
    return this.tx(() => {
      this.insertEntry(input)
      return this.entry(this.lastEntryId)!
    })
  }

  /** Re-insert a deleted entry with its original id (used by Undo). */
  restoreEntry(e: Entry): Entry {
    return this.tx(() => {
      if (e.end === null) this.run('UPDATE time_entries SET end_utc = ? WHERE end_utc IS NULL', [nowIso()])
      this.run(
        'INSERT INTO time_entries (id, project_id, description, start_utc, end_utc, idle_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [e.id, e.projectId, e.description, e.start, e.end, e.idleSeconds, e.createdAt, nowIso()]
      )
      this.setTags(e.id, e.tagIds)
      return this.entry(e.id)!
    })
  }

  private lastEntryId = 0

  private insertEntry(input: EntryInput): void {
    const now = nowIso()
    this.run(
      'INSERT INTO time_entries (project_id, description, start_utc, end_utc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [input.projectId, input.description.trim(), input.start, input.end, now, now]
    )
    this.lastEntryId = this.lastId()
    this.setTags(this.lastEntryId, input.tagIds)
  }

  updateEntry(id: number, patch: Partial<EntryInput> & { idleSeconds?: number }): Entry {
    const current = this.entry(id)
    if (!current) throw new UserError('That entry no longer exists.')
    const next = { ...current, ...patch }
    validateEntry(next)
    if (patch.projectId !== undefined) this.project(patch.projectId)
    return this.tx(() => {
      this.run(
        'UPDATE time_entries SET project_id = ?, description = ?, start_utc = ?, end_utc = ?, idle_seconds = ?, updated_at = ? WHERE id = ?',
        [next.projectId, next.description.trim(), next.start, next.end, next.idleSeconds, nowIso(), id]
      )
      if (patch.tagIds) this.setTags(id, patch.tagIds)
      return this.entry(id)!
    })
  }

  deleteEntry(id: number): Entry | null {
    const current = this.entry(id)
    if (!current) return null
    this.tx(() => this.run('DELETE FROM time_entries WHERE id = ?', [id]))
    return current
  }

  private setTags(entryId: number, tagIds: number[]): void {
    this.run('DELETE FROM entry_tags WHERE entry_id = ?', [entryId])
    for (const tagId of [...new Set(tagIds)]) this.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, id FROM tags WHERE id = ?', [entryId, tagId])
  }

  private withTags(rows: EntryRow[]): Entry[] {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const tagRows = this.all<{ entry_id: number; tag_id: number }>(
      `SELECT entry_id, tag_id FROM entry_tags WHERE entry_id IN (${ids.map(() => '?').join(',')})`,
      ids
    )
    const map = new Map<number, number[]>()
    for (const t of tagRows) {
      const list = map.get(t.entry_id) ?? []
      list.push(t.tag_id)
      map.set(t.entry_id, list)
    }
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      description: r.description,
      start: r.start_utc,
      end: r.end_utc,
      idleSeconds: r.idle_seconds,
      tagIds: map.get(r.id) ?? [],
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }
}

interface ProjectRow {
  id: number
  client_id: number | null
  code: string
  name: string
  color: string
  archived: number
  created_at: string
}

interface EntryRow {
  id: number
  project_id: number
  description: string
  start_utc: string
  end_utc: string | null
  idle_seconds: number
  created_at: string
  updated_at: string
}

function toClient(r: { id: number; name: string; archived: number; created_at: string }): Client {
  return { id: r.id, name: r.name, archived: !!r.archived, createdAt: r.created_at }
}

function toProject(r: ProjectRow): Project {
  return { id: r.id, clientId: r.client_id, code: r.code, name: r.name, color: r.color, archived: !!r.archived, createdAt: r.created_at }
}

function toTag(r: { id: number; name: string; created_at: string }): Tag {
  return { id: r.id, name: r.name, createdAt: r.created_at }
}

function nowIso(): string {
  return new Date().toISOString()
}

function requireText(value: string, label: string): string {
  const v = (value ?? '').trim()
  if (!v) throw new UserError(`${label} can't be empty.`)
  return v
}

function normalizeColor(c: string): string {
  const v = (c ?? '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new UserError('Colors must be a hex value like #12877A.')
  return v.toUpperCase()
}

function validateEntry(e: { start: string; end: string | null }): void {
  if (Number.isNaN(Date.parse(e.start))) throw new UserError('The start time is not valid.')
  if (e.end !== null) {
    if (Number.isNaN(Date.parse(e.end))) throw new UserError('The end time is not valid.')
    if (e.end < e.start) throw new UserError('The end time must be after the start time.')
  }
}

function translateError(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : String(err)
  if (/UNIQUE constraint failed: clients\.name/i.test(msg)) return new UserError('A client with that name already exists.')
  if (/UNIQUE constraint failed: tags\.name/i.test(msg)) return new UserError('A tag with that name already exists.')
  if (/UNIQUE constraint failed: index 'projects_unique_label'|projects_unique_label/i.test(msg))
    return new UserError('A project with that code and name already exists.')
  return err
}
