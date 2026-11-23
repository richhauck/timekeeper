import { beforeAll, describe, expect, it } from 'vitest'
import { timesFromInputs, withTimeInput } from '@shared/time'

// Local-time behavior depends on the zone; pin one with a daylight saving change.
// (US clocks fall back at 2:00 on Sunday, November 1, 2026.)
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})

const local = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

describe('withTimeInput', () => {
  it('sets the local time on the base day', () => {
    expect(local(withTimeInput('2026-10-31T14:00:00.000Z', '09:30')!)).toBe('10/31 09:30')
  })

  it('rejects malformed input', () => {
    for (const bad of ['', '9', '9:5', 'ab:cd', '09:30:00']) expect(withTimeInput('2026-10-31T14:00:00.000Z', bad)).toBeNull()
  })
})

describe('timesFromInputs', () => {
  const base = '2026-10-20T14:00:00.000Z' // Oct 20, 10:00 local

  it('keeps both times on the entry’s day', () => {
    const t = timesFromInputs(base, '09:00', '10:30')!
    expect([local(t.start), local(t.end)]).toEqual(['10/20 09:00', '10/20 10:30'])
  })

  it('moves an end earlier than the start to the next day, keeping its time', () => {
    const t = timesFromInputs(base, '21:00', '08:00')!
    expect([local(t.start), local(t.end)]).toEqual(['10/20 21:00', '10/21 08:00'])
    expect(Date.parse(t.end) - Date.parse(t.start)).toBe(11 * 3600_000)
  })

  it('keeps the wall-clock end time across a daylight saving change', () => {
    const t = timesFromInputs('2026-10-31T23:00:00.000Z', '21:00', '08:00')!
    expect([local(t.start), local(t.end)]).toEqual(['10/31 21:00', '11/1 08:00'])
    // Clocks fell back an hour overnight, so 21:00 to 08:00 is 12 real hours.
    expect(Date.parse(t.end) - Date.parse(t.start)).toBe(12 * 3600_000)
  })

  it('treats equal times as a zero-length entry, not a full day', () => {
    const t = timesFromInputs(base, '09:00', '09:00')!
    expect(t.end).toBe(t.start)
  })

  it('returns null when either input is incomplete', () => {
    expect(timesFromInputs(base, '', '10:00')).toBeNull()
    expect(timesFromInputs(base, '09:00', '1')).toBeNull()
  })
})
