import { roundForSettings } from './rounding'
import { addDays, addMonths, dateKey, startOfDay, startOfMonth } from './time'
import type { Catalog, Entry, Settings } from './types'

export type Period = 'day' | 'month' | 'year'

export interface Bucket {
  /** Local start of the bucket */
  start: Date
  seconds: number
}

export interface Breakdown {
  id: number | null
  label: string
  seconds: number
  color?: string
}

export interface Report {
  totalSeconds: number
  entryCount: number
  buckets: Bucket[]
  byProject: Breakdown[]
  byClient: Breakdown[]
  byTag: Breakdown[]
}

export interface RoundedEntry {
  entry: Entry
  exactSeconds: number
  roundedSeconds: number
}

/** Rounded duration for each entry, computed once per entry (never per day). */
export function roundEntries(entries: Entry[], settings: Settings, now: Date = new Date()): RoundedEntry[] {
  return entries.map((entry) => {
    const end = entry.end ? new Date(entry.end).getTime() : now.getTime()
    const exactSeconds = Math.max(0, Math.floor((end - new Date(entry.start).getTime()) / 1000))
    return { entry, exactSeconds, roundedSeconds: roundForSettings(exactSeconds, settings) }
  })
}

/**
 * Rounded seconds of an entry that fall inside [from, to).
 * An entry that crosses a boundary (midnight, a month end) is split in
 * proportion to its exact time on each side, so the pieces always add up to
 * the entry's rounded total.
 */
export function roundedSecondsWithin(r: RoundedEntry, from: Date, to: Date, now: Date = new Date()): number {
  const s = new Date(r.entry.start).getTime()
  const e = r.entry.end ? new Date(r.entry.end).getTime() : now.getTime()
  if (e <= s) {
    // Zero-length entry: count it where it starts.
    return s >= from.getTime() && s < to.getTime() ? r.roundedSeconds : 0
  }
  const overlap = Math.max(0, Math.min(e, to.getTime()) - Math.max(s, from.getTime()))
  if (overlap === 0) return 0
  return r.roundedSeconds * (overlap / (e - s))
}

export function periodRange(period: Period, anchor: Date): { from: Date; to: Date } {
  if (period === 'day') {
    const from = startOfDay(anchor)
    return { from, to: addDays(from, 1) }
  }
  if (period === 'month') {
    const from = startOfMonth(anchor)
    return { from, to: addMonths(from, 1) }
  }
  const from = new Date(anchor.getFullYear(), 0, 1)
  return { from, to: new Date(anchor.getFullYear() + 1, 0, 1) }
}

/**
 * The first and last local dates (YYYY-MM-DD, inclusive) of a period, as the
 * export dialog takes them. Steps back a calendar day from the end rather
 * than 24 hours, since days around daylight saving changes are 23 or 25 hours.
 */
export function periodDateKeys(period: Period, anchor: Date): { from: string; to: string } {
  const { from, to } = periodRange(period, anchor)
  return { from: dateKey(from), to: dateKey(addDays(to, -1)) }
}

export function shiftPeriod(period: Period, anchor: Date, step: number): Date {
  if (period === 'day') return addDays(anchor, step)
  if (period === 'month') return addMonths(startOfMonth(anchor), step)
  return new Date(anchor.getFullYear() + step, 0, 1)
}

export function buildReport(
  entries: Entry[],
  catalog: Catalog,
  settings: Settings,
  period: Period,
  anchor: Date,
  now: Date = new Date()
): Report {
  const { from, to } = periodRange(period, anchor)
  const rounded = roundEntries(entries, settings, now)

  const buckets: Bucket[] = []
  if (period === 'month') {
    for (let d = new Date(from); d < to; d = addDays(d, 1)) buckets.push({ start: d, seconds: 0 })
  } else if (period === 'year') {
    for (let d = new Date(from); d < to; d = addMonths(d, 1)) buckets.push({ start: d, seconds: 0 })
  }

  const projectById = new Map(catalog.projects.map((p) => [p.id, p]))
  const clientById = new Map(catalog.clients.map((c) => [c.id, c]))
  const tagById = new Map(catalog.tags.map((t) => [t.id, t]))

  const byProject = new Map<number, number>()
  const byClient = new Map<number | null, number>()
  const byTag = new Map<number, number>()
  let total = 0
  let count = 0

  for (const r of rounded) {
    const inRange = roundedSecondsWithin(r, from, to, now)
    if (inRange <= 0 && !overlaps(r.entry, from, to, now)) continue
    count += 1
    total += inRange
    byProject.set(r.entry.projectId, (byProject.get(r.entry.projectId) ?? 0) + inRange)
    const clientId = projectById.get(r.entry.projectId)?.clientId ?? null
    byClient.set(clientId, (byClient.get(clientId) ?? 0) + inRange)
    for (const tagId of r.entry.tagIds) byTag.set(tagId, (byTag.get(tagId) ?? 0) + inRange)

    for (let i = 0; i < buckets.length; i++) {
      const bStart = buckets[i].start
      const bEnd = i + 1 < buckets.length ? buckets[i + 1].start : to
      buckets[i].seconds += roundedSecondsWithin(r, bStart, bEnd, now)
    }
  }

  const sortDesc = (a: Breakdown, b: Breakdown) => b.seconds - a.seconds || a.label.localeCompare(b.label)

  return {
    totalSeconds: total,
    entryCount: count,
    buckets,
    byProject: [...byProject.entries()]
      .map(([id, seconds]) => {
        const p = projectById.get(id)
        return { id, seconds, label: p ? projectLabel(p.code, p.name) : 'Deleted project', color: p?.color }
      })
      .sort(sortDesc),
    byClient: [...byClient.entries()]
      .map(([id, seconds]) => ({ id, seconds, label: id === null ? 'No client' : clientById.get(id)?.name ?? 'Deleted client' }))
      .sort(sortDesc),
    byTag: [...byTag.entries()]
      .map(([id, seconds]) => ({ id, seconds, label: tagById.get(id)?.name ?? 'Deleted tag' }))
      .sort(sortDesc)
  }
}

/**
 * Whether an entry belongs in [from, to). Entries are half-open too, so one
 * that ends exactly at `from` (say, at midnight) belongs to the period before.
 * A zero-length entry belongs where it starts.
 */
function overlaps(entry: Entry, from: Date, to: Date, now: Date): boolean {
  const s = new Date(entry.start).getTime()
  const e = entry.end ? new Date(entry.end).getTime() : now.getTime()
  if (e <= s) return s >= from.getTime() && s < to.getTime()
  return s < to.getTime() && e > from.getTime()
}

export function projectLabel(code: string, name: string): string {
  return code ? `${code} ${name}` : name
}

/** Filter entries by client, project, tag and description text. Empty lists mean "all". */
export function filterEntries(
  entries: Entry[],
  catalog: Catalog,
  filter: { clientIds: number[]; projectIds: number[]; tagIds: number[]; text: string }
): Entry[] {
  const projectClient = new Map(catalog.projects.map((p) => [p.id, p.clientId]))
  const text = filter.text.trim().toLowerCase()
  return entries.filter((e) => {
    if (filter.projectIds.length && !filter.projectIds.includes(e.projectId)) return false
    if (filter.clientIds.length) {
      const c = projectClient.get(e.projectId) ?? null
      if (c === null || !filter.clientIds.includes(c)) return false
    }
    if (filter.tagIds.length && !e.tagIds.some((t) => filter.tagIds.includes(t))) return false
    if (text && !e.description.toLowerCase().includes(text)) return false
    return true
  })
}
