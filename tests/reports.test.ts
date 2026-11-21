import { describe, expect, it } from 'vitest'
import { buildReport, filterEntries, periodRange } from '@shared/reports'
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
