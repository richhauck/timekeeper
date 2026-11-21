import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/db'

const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm')
let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-'))
  file = path.join(dir, 'test.db')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('Store', () => {
  it('persists clients, projects, tags and entries across reopen', async () => {
    const s = await Store.open(file, WASM)
    const c = s.createClient({ name: 'Acme Co.' })
    const p = s.createProject({ clientId: c.id, code: 'ACM-101', name: 'Website redesign', color: '#12877a' })
    expect(p.color).toBe('#12877A')
    const t = s.createTag('design')
    const e = s.startTimer({ projectId: p.id, description: 'Wireframes', tagIds: [t.id] }, '2026-10-31T13:00:00.000Z')
    expect(s.getRunning()?.id).toBe(e.id)
    s.close()

    const s2 = await Store.open(file, WASM)
    const running = s2.getRunning()
    expect(running).toMatchObject({ description: 'Wireframes', tagIds: [t.id], end: null })
    expect(s2.getCatalog().projects[0].clientId).toBe(c.id)
    s2.close()
  })

  it('starting a timer stops the running one', async () => {
    const s = await Store.open(file, WASM)
    const p = s.createProject({ clientId: null, code: '', name: 'Internal', color: '#B7860B' })
    const a = s.startTimer({ projectId: p.id, description: 'A', tagIds: [] }, '2026-10-31T13:00:00.000Z')
    s.startTimer({ projectId: p.id, description: 'B', tagIds: [] }, '2026-10-31T14:00:00.000Z')
    expect(s.entry(a.id)?.end).toBe('2026-10-31T14:00:00.000Z')
    expect(s.getRunning()?.description).toBe('B')
  })

  it('rejects duplicates and bad input with readable messages', async () => {
    const s = await Store.open(file, WASM)
    s.createClient({ name: 'Acme' })
    expect(() => s.createClient({ name: 'acme' })).toThrow('A client with that name already exists.')
    expect(() => s.createProject({ clientId: null, code: '', name: '  ', color: '#000000' })).toThrow("can't be empty")
    expect(() => s.createProject({ clientId: null, code: '', name: 'X', color: 'red' })).toThrow('hex')
    const p = s.createProject({ clientId: null, code: 'X-1', name: 'X', color: '#000000' })
    expect(() => s.createProject({ clientId: null, code: 'x-1', name: 'x', color: '#000000' })).toThrow('already exists')
    expect(() =>
      s.createEntry({ projectId: p.id, description: '', start: '2026-10-31T14:00:00.000Z', end: '2026-10-31T13:00:00.000Z', tagIds: [] })
    ).toThrow('after the start')
  })

  it('deletes and restores an entry with its tags (undo)', async () => {
    const s = await Store.open(file, WASM)
    const p = s.createProject({ clientId: null, code: '', name: 'Internal', color: '#B7860B' })
    const t = s.createTag('admin')
    const e = s.createEntry({ projectId: p.id, description: 'Inbox', start: '2026-10-31T12:40:00.000Z', end: '2026-10-31T13:03:00.000Z', tagIds: [t.id] })
    const removed = s.deleteEntry(e.id)!
    expect(s.entry(e.id)).toBeNull()
    const back = s.restoreEntry(removed)
    expect(back).toMatchObject({ id: e.id, description: 'Inbox', tagIds: [t.id] })
  })

  it('cascades: deleting a project deletes its entries; deleting a client keeps projects', async () => {
    const s = await Store.open(file, WASM)
    const c = s.createClient({ name: 'Acme' })
    const p = s.createProject({ clientId: c.id, code: '', name: 'Site', color: '#12877A' })
    s.createEntry({ projectId: p.id, description: '', start: '2026-10-31T12:00:00.000Z', end: '2026-10-31T13:00:00.000Z', tagIds: [] })
    s.deleteClient(c.id)
    expect(s.project(p.id).clientId).toBeNull()
    expect(s.countProjectEntries(p.id)).toBe(1)
    s.deleteProject(p.id)
    expect(s.listEntries({ from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' })).toHaveLength(0)
  })

  it('stores settings and lists entries overlapping a range', async () => {
    const s = await Store.open(file, WASM)
    expect(s.getSettings().roundingMinutes).toBe(15)
    expect(s.updateSettings({ roundingMinutes: 6, roundingMode: 'up' })).toMatchObject({ roundingMinutes: 6, roundingMode: 'up' })
    const p = s.createProject({ clientId: null, code: '', name: 'P', color: '#000000' })
    s.createEntry({ projectId: p.id, description: 'overnight', start: '2026-10-30T23:00:00.000Z', end: '2026-10-31T01:00:00.000Z', tagIds: [] })
    s.createEntry({ projectId: p.id, description: 'before', start: '2026-10-29T10:00:00.000Z', end: '2026-10-29T11:00:00.000Z', tagIds: [] })
    const day = s.listEntries({ from: '2026-10-31T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' })
    expect(day.map((e) => e.description)).toEqual(['overnight'])
  })
})
