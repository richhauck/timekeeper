import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/main/db'
import { IdleMonitor } from '../src/main/idle'
import { applyIdleChoice, lastSeenForRecovery, recordHeartbeat } from '../src/main/session'
import { DEFAULT_SETTINGS, type Entry, type IdlePrompt } from '@shared/types'

const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm')
const START = '2026-10-31T13:00:00.000Z'
const IDLE_SINCE = '2026-10-31T14:00:00.000Z'
const RETURNED = '2026-10-31T14:20:00.000Z'
const NOW = new Date('2026-10-31T14:20:05.000Z')

let dir: string
let file: string
let store: Store
let projectId: number
let tagId: number

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-session-'))
  file = path.join(dir, 'test.db')
  store = await Store.open(file, WASM)
  const client = store.createClient({ name: 'Acme Co.' })
  projectId = store.createProject({ clientId: client.id, code: 'ACM-101', name: 'Website redesign', color: '#12877A' }).id
  tagId = store.createTag('design').id
})

afterEach(() => {
  try {
    store.close()
  } catch {
    // already closed by the test
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

function startAt(start = START): Entry {
  return store.startTimer({ projectId, description: 'Wireframes', tagIds: [tagId] }, start)
}

function promptFor(entry: Entry, idleSince = IDLE_SINCE, returnedAt = RETURNED): IdlePrompt {
  return { entryId: entry.id, idleSince, returnedAt, projectLabel: 'ACM-101 Website redesign', projectColor: '#12877A', description: entry.description }
}

function allEntries(): Entry[] {
  return store.listEntries({ from: '2026-10-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' })
}

describe('applyIdleChoice: keep', () => {
  it('keeps the timer running and records the idle stretch', () => {
    const e = startAt()
    applyIdleChoice(store, 'keep', promptFor(e), NOW)
    expect(store.getRunning()).toMatchObject({ id: e.id, end: null, idleSeconds: 20 * 60 })
  })

  it('adds to idle time already recorded', () => {
    const e = startAt()
    applyIdleChoice(store, 'keep', promptFor(e), NOW)
    applyIdleChoice(store, 'keep', promptFor(e, '2026-10-31T15:00:00.000Z', '2026-10-31T15:05:00.000Z'), NOW)
    expect(store.getRunning()?.idleSeconds).toBe(25 * 60)
  })

  it('never records negative idle time', () => {
    const e = startAt()
    applyIdleChoice(store, 'keep', promptFor(e, RETURNED, IDLE_SINCE), NOW)
    expect(store.getRunning()?.idleSeconds).toBe(0)
  })

  it('leaves a different running entry alone', () => {
    const first = startAt()
    const second = startAt('2026-10-31T14:30:00.000Z')
    applyIdleChoice(store, 'keep', promptFor(first), NOW)
    expect(store.getRunning()).toMatchObject({ id: second.id, idleSeconds: 0 })
    expect(store.entry(first.id)?.idleSeconds).toBe(0)
  })
})

describe('applyIdleChoice: discard', () => {
  it('ends the entry when idle began and restarts an identical one now', () => {
    const e = startAt()
    applyIdleChoice(store, 'discard', promptFor(e), NOW)

    expect(store.entry(e.id)).toMatchObject({ start: START, end: IDLE_SINCE })
    const running = store.getRunning()
    expect(running).toMatchObject({ projectId, description: 'Wireframes', tagIds: [tagId], start: NOW.toISOString(), end: null })
    expect(running?.id).not.toBe(e.id)
    expect(allEntries()).toHaveLength(2)
  })

  it('drops the entry if less than a minute of work came before idle', () => {
    const e = startAt()
    applyIdleChoice(store, 'discard', promptFor(e, '2026-10-31T13:00:59.000Z'), NOW)
    expect(allEntries().map((x) => x.start)).toEqual([NOW.toISOString()])
    expect(store.getRunning()).toMatchObject({ start: NOW.toISOString() })
  })

  it('keeps an entry with exactly a minute of work', () => {
    const e = startAt()
    applyIdleChoice(store, 'discard', promptFor(e, '2026-10-31T13:01:00.000Z'), NOW)
    expect(store.entry(e.id)?.end).toBe('2026-10-31T13:01:00.000Z')
  })

  it('treats idle that began before the entry as no work at all', () => {
    const e = startAt()
    applyIdleChoice(store, 'discard', promptFor(e, '2026-10-31T12:00:00.000Z'), NOW)
    expect(allEntries().map((x) => x.start)).toEqual([NOW.toISOString()])
  })

  it('does nothing if the prompt is for an entry that is no longer running', () => {
    const first = startAt()
    const second = startAt('2026-10-31T14:30:00.000Z')
    applyIdleChoice(store, 'discard', promptFor(first), NOW)
    expect(store.getRunning()?.id).toBe(second.id)
    expect(store.entry(first.id)?.end).toBe('2026-10-31T14:30:00.000Z')
    expect(allEntries()).toHaveLength(2)
  })

  it('does nothing if no timer is running', () => {
    const e = startAt()
    store.stopTimer('2026-10-31T14:10:00.000Z')
    applyIdleChoice(store, 'discard', promptFor(e), NOW)
    expect(store.getRunning()).toBeNull()
    expect(store.entry(e.id)?.end).toBe('2026-10-31T14:10:00.000Z')
  })

  it('saves the result to disk', async () => {
    const e = startAt()
    applyIdleChoice(store, 'discard', promptFor(e), NOW)
    store.close()
    store = await Store.open(file, WASM)
    expect(store.entry(e.id)?.end).toBe(IDLE_SINCE)
    expect(store.getRunning()?.start).toBe(NOW.toISOString())
  })
})

describe('applyIdleChoice: discard and stop', () => {
  it('ends the entry when idle began and leaves no timer running', () => {
    const e = startAt()
    applyIdleChoice(store, 'discard-stop', promptFor(e), NOW)
    expect(store.entry(e.id)).toMatchObject({ end: IDLE_SINCE, tagIds: [tagId] })
    expect(store.getRunning()).toBeNull()
    expect(allEntries()).toHaveLength(1)
  })

  it('drops a near-empty entry and leaves nothing behind', () => {
    const e = startAt()
    applyIdleChoice(store, 'discard-stop', promptFor(e, '2026-10-31T13:00:10.000Z'), NOW)
    expect(allEntries()).toHaveLength(0)
    expect(store.getRunning()).toBeNull()
  })
})

describe('heartbeat and crash recovery', () => {
  it('records a heartbeat only while a timer runs', () => {
    recordHeartbeat(store, 1000)
    expect(store.getMeta('lastSeen')).toBeNull()
    startAt()
    recordHeartbeat(store, 2000)
    expect(store.getMeta('lastSeen')).toBe('2000')
  })

  it('finds the last heartbeat after a crash (no clean close)', async () => {
    startAt()
    recordHeartbeat(store, 5000)
    // Simulate a crash: open the file again without closing this store.
    const after = await Store.open(file, WASM)
    expect(lastSeenForRecovery(after)).toBe(5000)
  })

  it('has nothing to recover without a running timer or a usable heartbeat', () => {
    const e = startAt()
    expect(lastSeenForRecovery(store)).toBeNull()
    store.setMeta('lastSeen', 'garbage')
    expect(lastSeenForRecovery(store)).toBeNull()
    recordHeartbeat(store, 5000)
    store.stopTimer()
    expect(lastSeenForRecovery(store)).toBeNull()
    expect(store.entry(e.id)?.end).not.toBeNull()
  })

  it('turns the gap into an idle prompt that can be discarded', () => {
    const e = startAt()
    const lastSeen = Date.parse('2026-10-31T14:00:00.000Z')
    recordHeartbeat(store, lastSeen)

    let now = Date.parse('2026-10-31T16:00:00.000Z')
    const onReturn = vi.fn()
    const monitor = new IdleMonitor({
      getIdleSeconds: () => 0,
      getRunning: () => store.getRunning(),
      getSettings: () => DEFAULT_SETTINGS,
      describeEntry: () => ({ label: 'ACM-101 Website redesign', color: '#12877A' }),
      onIdle: vi.fn(),
      onReturn,
      onCleared: vi.fn(),
      now: () => now
    })

    monitor.recoverFromGap(lastSeenForRecovery(store)!)
    expect(onReturn).toHaveBeenCalledTimes(1)
    const prompt = monitor.takePrompt()!
    expect(prompt).toMatchObject({ entryId: e.id, idleSince: '2026-10-31T14:00:00.000Z', returnedAt: '2026-10-31T16:00:00.000Z' })

    applyIdleChoice(store, 'discard-stop', prompt, new Date(now))
    expect(store.entry(e.id)?.end).toBe('2026-10-31T14:00:00.000Z')
    expect(store.getRunning()).toBeNull()
  })
})
