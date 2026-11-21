import { describe, expect, it, vi } from 'vitest'
import { IdleMonitor, planIdleChoice } from '../src/main/idle'
import { DEFAULT_SETTINGS, type Entry, type IdlePrompt, type Settings } from '@shared/types'

function setup(overrides: Partial<Settings> = {}) {
  let now = Date.parse('2026-10-31T14:00:00.000Z')
  let idleSeconds = 0
  let running: Entry | null = {
    id: 7, projectId: 1, description: 'Hero layout', start: '2026-10-31T13:00:00.000Z', end: null,
    idleSeconds: 0, tagIds: [], createdAt: '', updatedAt: ''
  }
  const onIdle = vi.fn()
  const onReturn = vi.fn()
  const onCleared = vi.fn()
  const settings = { ...DEFAULT_SETTINGS, ...overrides }
  const m = new IdleMonitor({
    getIdleSeconds: () => idleSeconds,
    getRunning: () => running,
    getSettings: () => settings,
    describeEntry: () => ({ label: 'ACM-101 Website redesign', color: '#12877A' }),
    onIdle, onReturn, onCleared,
    now: () => now
  })
  return {
    m, onIdle, onReturn, onCleared,
    advance(sec: number, idle: number) { now += sec * 1000; idleSeconds = idle },
    stop() { running = null },
    get now() { return now }
  }
}

describe('IdleMonitor', () => {
  it('notifies past the threshold and prompts on return', () => {
    const t = setup()
    t.advance(60, 60)
    t.m.tick()
    expect(t.onIdle).not.toHaveBeenCalled()
    t.advance(240, 300)
    t.m.tick()
    expect(t.onIdle).toHaveBeenCalledWith(expect.objectContaining({ idleMinutes: 5, label: 'ACM-101 Website redesign' }))
    t.advance(120, 420)
    t.m.tick()
    expect(t.onReturn).not.toHaveBeenCalled()
    t.advance(2, 1)
    t.m.tick()
    const prompt = t.onReturn.mock.calls[0][0] as IdlePrompt
    expect(prompt.idleSince).toBe('2026-10-31T14:00:00.000Z')
    expect(prompt.entryId).toBe(7)
    expect(t.m.currentPrompt).toEqual(prompt)
  })

  it('keeps idle time without asking when askOnReturn is off', () => {
    const t = setup({ askOnReturn: false })
    t.advance(300, 300)
    t.m.tick()
    t.advance(2, 0)
    t.m.tick()
    expect(t.onReturn).not.toHaveBeenCalled()
    expect(t.m.currentPrompt).toBeNull()
  })

  it('treats sleep longer than the threshold as idle', () => {
    const t = setup()
    t.m.suspend()
    t.advance(3600, 0)
    t.m.resume()
    expect(t.onReturn).toHaveBeenCalledTimes(1)
    expect((t.onReturn.mock.calls[0][0] as IdlePrompt).idleSince).toBe('2026-10-31T14:00:00.000Z')
  })

  it('ignores short sleeps and sleep when the setting is off', () => {
    const t = setup()
    t.m.suspend()
    t.advance(60, 0)
    t.m.resume()
    expect(t.onReturn).not.toHaveBeenCalled()
    const u = setup({ sleepCountsAsIdle: false })
    u.m.suspend()
    u.advance(3600, 0)
    u.m.resume()
    expect(u.onReturn).not.toHaveBeenCalled()
  })

  it('recovers a gap after the app was closed with a timer running', () => {
    const t = setup()
    const lastSeen = t.now
    t.advance(7200, 0)
    t.m.recoverFromGap(lastSeen)
    expect((t.onReturn.mock.calls[0][0] as IdlePrompt).idleSince).toBe(new Date(lastSeen).toISOString())
  })

  it('clears when the timer stops', () => {
    const t = setup()
    t.advance(300, 300)
    t.m.tick()
    t.stop()
    t.m.tick()
    expect(t.m.watchingForReturn).toBe(false)
  })
})

describe('planIdleChoice', () => {
  const running: Entry = { id: 7, projectId: 1, description: '', start: '2026-10-31T13:00:00.000Z', end: null, idleSeconds: 0, tagIds: [], createdAt: '', updatedAt: '' }
  const prompt: IdlePrompt = { entryId: 7, idleSince: '2026-10-31T14:14:00.000Z', returnedAt: '2026-10-31T14:21:00.000Z', projectLabel: '', projectColor: '', description: '' }
  it('maps choices to an end time and an optional restart', () => {
    expect(planIdleChoice('keep', prompt, running, 'now')).toBeNull()
    expect(planIdleChoice('discard', prompt, running, '2026-10-31T14:21:05.000Z')).toEqual({ endAt: prompt.idleSince, restartAt: '2026-10-31T14:21:05.000Z' })
    expect(planIdleChoice('discard-stop', prompt, running, 'x')).toEqual({ endAt: prompt.idleSince, restartAt: null })
    expect(planIdleChoice('discard', prompt, { ...running, id: 8 }, 'x')).toBeNull()
  })
})
