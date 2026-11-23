import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildReport, filterEntries, periodDateKeys, periodRange, shiftPeriod } from '@shared/reports'
import { DEFAULT_SETTINGS, type Catalog, type Entry } from '@shared/types'

const catalog: Catalog = {
  clients: [{ id: 1, name: 'Acme Co.', archived: false, createdAt: '' }],
  projects: [
    { id: 10, clientId: 1, code: 'ACM-101', name: 'Website redesign', color: '#12877A', archived: false, createdAt: '' },
    { id: 11, clientId: null, code: '', name: 'Internal', color: '#B7860B', archived: false, createdAt: '' }
  ],
  tags: [
    { id: 100, name: 'design', createdAt: '' },
    { id: 101, name: 'meeting', createdAt: '' }
  ]
}

let nextId = 1
function entry(start: Date, minutes: number, projectId = 10, tagIds: number[] = [], description = ''): Entry {
  const end = new Date(start.getTime() + minutes * 60000)
  return { id: nextId++, projectId, description, start: start.toISOString(), end: end.toISOString(), idleSeconds: 0, tagIds, createdAt: '', updatedAt: '' }
}

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)

describe('buildReport', () => {
  it('totals rounded time by project, client and tag', () => {
    const entries = [
      entry(at(2026, 10, 31, 9, 15), 92, 10, [100]), // 1:32 -> 1:30
      entry(at(2026, 10, 31, 10, 50), 68, 10, [100, 101]), // 1:08 -> 1:15
      entry(at(2026, 10, 31, 12, 40), 23, 11, [101]) // 0:23 -> 0:30
    ]
    const r = buildReport(entries, catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31))
    expect(r.totalSeconds).toBe((90 + 75 + 30) * 60)
    expect(r.entryCount).toBe(3)
    expect(r.byProject[0]).toMatchObject({ id: 10, label: 'ACM-101 Website redesign', seconds: 165 * 60 })
    expect(r.byClient.find((c) => c.id === null)?.label).toBe('No client')
    expect(r.byTag.find((t) => t.id === 101)?.seconds).toBe(105 * 60)
  })

  it('splits an entry across midnight but keeps its rounded total', () => {
    // 23:00 to 01:08 = 128 min -> rounded 135 min; 60/128 before midnight.
    const e = entry(at(2026, 10, 30, 23, 0), 128)
    const d1 = buildReport([e], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 30))
    const d2 = buildReport([e], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31))
    expect(d1.totalSeconds + d2.totalSeconds).toBeCloseTo(135 * 60, 6)
    expect(d1.totalSeconds).toBeCloseTo(135 * 60 * (60 / 128), 6)
    const month = buildReport([e], catalog, DEFAULT_SETTINGS, 'month', at(2026, 10, 1))
    expect(month.buckets).toHaveLength(31)
    expect(month.buckets[29].seconds + month.buckets[30].seconds).toBeCloseTo(month.totalSeconds, 6)
  })

  it('builds 12 monthly buckets for a year', () => {
    const r = buildReport([entry(at(2026, 3, 4, 9), 60)], catalog, DEFAULT_SETTINGS, 'year', at(2026, 7, 1))
    expect(r.buckets).toHaveLength(12)
    expect(r.buckets[2].seconds).toBe(3600)
  })

  it('computes period ranges in local time', () => {
    const { from, to } = periodRange('month', at(2026, 2, 14))
    expect(from).toEqual(at(2026, 2, 1))
    expect(to).toEqual(at(2026, 3, 1))
  })
})

describe('filterEntries', () => {
  it('filters by client, project, tag and description', () => {
    const a = entry(at(2026, 1, 1, 9), 30, 10, [100], 'Pricing page wireframes')
    const b = entry(at(2026, 1, 1, 10), 30, 11, [101], 'Inbox')
    const all = [a, b]
    expect(filterEntries(all, catalog, { clientIds: [1], projectIds: [], tagIds: [], text: '' })).toEqual([a])
    expect(filterEntries(all, catalog, { clientIds: [], projectIds: [11], tagIds: [], text: '' })).toEqual([b])
    expect(filterEntries(all, catalog, { clientIds: [], projectIds: [], tagIds: [100], text: '' })).toEqual([a])
    expect(filterEntries(all, catalog, { clientIds: [], projectIds: [], tagIds: [], text: 'PRICING' })).toEqual([a])
  })
})

describe('buildReport: period boundaries', () => {
  it('counts an entry that ends exactly at midnight only on its own day', () => {
    const e = entry(at(2026, 10, 30, 23, 0), 60) // 23:00 to 00:00
    const own = buildReport([e], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 30))
    const next = buildReport([e], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31))
    expect(own).toMatchObject({ totalSeconds: 3600, entryCount: 1 })
    expect(next).toMatchObject({ totalSeconds: 0, entryCount: 0, byProject: [], byClient: [], byTag: [] })
  })

  it('does not count an entry that starts exactly when the period ends', () => {
    const e = entry(at(2026, 11, 1, 0, 0), 60)
    expect(buildReport([e], catalog, DEFAULT_SETTINGS, 'month', at(2026, 10, 1)).entryCount).toBe(0)
    expect(buildReport([e], catalog, DEFAULT_SETTINGS, 'month', at(2026, 11, 1)).entryCount).toBe(1)
  })

  it('counts a zero-length entry where it starts, once', () => {
    const e = entry(at(2026, 10, 31, 0, 0), 0)
    expect(buildReport([e], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 30)).entryCount).toBe(0)
    expect(buildReport([e], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31)).entryCount).toBe(1)
  })

  it('splits an entry across a year boundary', () => {
    const e = entry(at(2026, 12, 31, 23, 0), 120) // 2 h, half in each year
    const y1 = buildReport([e], catalog, DEFAULT_SETTINGS, 'year', at(2026, 6, 1))
    const y2 = buildReport([e], catalog, DEFAULT_SETTINGS, 'year', at(2027, 6, 1))
    expect(y1.totalSeconds).toBeCloseTo(3600, 6)
    expect(y2.totalSeconds).toBeCloseTo(3600, 6)
    expect(y1.buckets[11].seconds).toBeCloseTo(3600, 6)
    expect(y2.buckets[0].seconds).toBeCloseTo(3600, 6)
  })
})

describe('buildReport: rounding and running entries', () => {
  it('rounds each entry on its own, not the total', () => {
    // Two 7-minute entries: each rounds to 0 with 15-minute nearest rounding.
    const entries = [entry(at(2026, 10, 31, 9), 7), entry(at(2026, 10, 31, 10), 7)]
    const r = buildReport(entries, catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31))
    expect(r).toMatchObject({ totalSeconds: 0, entryCount: 2 })
    const up = buildReport(entries, catalog, { ...DEFAULT_SETTINGS, roundingMode: 'up' }, 'day', at(2026, 10, 31))
    expect(up.totalSeconds).toBe(30 * 60)
    const exact = buildReport(entries, catalog, { ...DEFAULT_SETTINGS, roundingMinutes: 0 }, 'day', at(2026, 10, 31))
    expect(exact.totalSeconds).toBe(14 * 60)
  })

  it('includes a running entry up to now', () => {
    const running: Entry = { ...entry(at(2026, 10, 31, 9), 0), end: null }
    const now = at(2026, 10, 31, 10, 20) // 80 min -> 1:15
    const r = buildReport([running], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31), now)
    expect(r).toMatchObject({ totalSeconds: 75 * 60, entryCount: 1 })
  })
})

describe('buildReport: buckets and breakdowns', () => {
  it('makes one bucket per local day, including leap days and daylight saving months', () => {
    expect(buildReport([], catalog, DEFAULT_SETTINGS, 'month', at(2028, 2, 10)).buckets).toHaveLength(29)
    const nov = buildReport([], catalog, DEFAULT_SETTINGS, 'month', at(2026, 11, 10)).buckets
    expect(nov).toHaveLength(30)
    expect(nov.map((b) => b.start.getDate())).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
  })

  it('has month buckets that add up to the total', () => {
    const entries = [entry(at(2026, 10, 1, 9), 95), entry(at(2026, 10, 14, 22), 240, 11), entry(at(2026, 10, 31, 23, 30), 60)]
    const r = buildReport(entries, catalog, DEFAULT_SETTINGS, 'month', at(2026, 10, 1))
    expect(r.buckets.reduce((s, b) => s + b.seconds, 0)).toBeCloseTo(r.totalSeconds, 6)
  })

  it('labels time whose project, client or tag is gone', () => {
    const r = buildReport([entry(at(2026, 10, 31, 9), 60, 99, [999])], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31))
    expect(r.byProject[0].label).toBe('Deleted project')
    expect(r.byClient[0].label).toBe('No client')
    expect(r.byTag[0].label).toBe('Deleted tag')
    const gone: Catalog = { ...catalog, clients: [] }
    expect(buildReport([entry(at(2026, 10, 31, 9), 60)], gone, DEFAULT_SETTINGS, 'day', at(2026, 10, 31)).byClient[0].label).toBe('Deleted client')
  })

  it('sorts breakdowns by time, then by name', () => {
    const entries = [entry(at(2026, 10, 31, 9), 60, 11), entry(at(2026, 10, 31, 11), 60, 10)]
    const r = buildReport(entries, catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31))
    expect(r.byProject.map((p) => p.label)).toEqual(['ACM-101 Website redesign', 'Internal'])
    const more = buildReport([...entries, entry(at(2026, 10, 31, 13), 30, 11)], catalog, DEFAULT_SETTINGS, 'day', at(2026, 10, 31))
    expect(more.byProject[0].label).toBe('Internal')
  })
})

describe('shiftPeriod', () => {
  it('moves by whole local periods', () => {
    expect(shiftPeriod('month', at(2026, 1, 31), 1)).toEqual(at(2026, 2, 1))
    expect(shiftPeriod('month', at(2026, 1, 15), -1)).toEqual(at(2025, 12, 1))
    expect(shiftPeriod('day', at(2026, 3, 8), 1)).toEqual(at(2026, 3, 9))
    expect(shiftPeriod('year', at(2026, 7, 4), 1)).toEqual(at(2027, 1, 1))
  })
})

describe('filterEntries: combinations', () => {
  const a = entry(at(2026, 1, 1, 9), 30, 10, [100], 'Pricing page')
  const b = entry(at(2026, 1, 1, 10), 30, 10, [101], 'Pricing call')
  const c = entry(at(2026, 1, 1, 11), 30, 11, [100, 101], 'Inbox')
  const none = { clientIds: [], projectIds: [], tagIds: [], text: '' }

  it('matches any of the chosen tags, and all of the different filters', () => {
    expect(filterEntries([a, b, c], catalog, { ...none, tagIds: [100, 101] })).toEqual([a, b, c])
    expect(filterEntries([a, b, c], catalog, { ...none, tagIds: [101], text: 'pricing' })).toEqual([b])
    expect(filterEntries([a, b, c], catalog, { ...none, clientIds: [1], tagIds: [100] })).toEqual([a])
  })

  it('leaves out projects with no client when filtering by client', () => {
    expect(filterEntries([a, c], catalog, { ...none, clientIds: [1] })).toEqual([a])
  })

  it('ignores surrounding spaces in the search text', () => {
    expect(filterEntries([a, b, c], catalog, { ...none, text: '  inbox ' })).toEqual([c])
  })
})

describe('periodDateKeys', () => {
  // Pin a zone with daylight saving: US clocks spring forward on March 8, 2026.
  let saved: string | undefined
  beforeAll(() => {
    saved = process.env.TZ
    process.env.TZ = 'America/New_York'
  })
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  })

  it('gives the inclusive local dates of a period', () => {
    expect(periodDateKeys('day', new Date(2026, 9, 31, 15))).toEqual({ from: '2026-10-31', to: '2026-10-31' })
    expect(periodDateKeys('month', new Date(2026, 1, 14))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodDateKeys('year', new Date(2026, 6, 4))).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('handles the 23-hour and 25-hour days of daylight saving changes', () => {
    expect(periodDateKeys('day', new Date(2026, 2, 8, 12))).toEqual({ from: '2026-03-08', to: '2026-03-08' })
    expect(periodDateKeys('day', new Date(2026, 10, 1, 12))).toEqual({ from: '2026-11-01', to: '2026-11-01' })
  })
})
