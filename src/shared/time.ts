/** Local-time helpers. All storage is UTC ISO strings; these work in the user's time zone. */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1)
}

export function addYears(d: Date, n: number): Date {
  return new Date(d.getFullYear() + n, 0, 1)
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** YYYY-MM-DD in local time */
export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse YYYY-MM-DD as local midnight */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** "h:mm" from seconds, e.g. 4500 -> "1:15". Large values keep growing hours: "147:00". */
export function formatHM(seconds: number): string {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h.toLocaleString('en-US')}:${String(m).padStart(2, '0')}`
}

/** "hh:mm:ss" stopwatch display */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':')
}

/** Decimal hours with two places, e.g. 4500 -> 1.25 */
export function decimalHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

/** "HH:MM" (24 h, local) for <input type="time"> */
export function toTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Apply "HH:MM" to the local date of a base timestamp and return ISO UTC. */
export function withTimeInput(baseIso: string, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const d = new Date(baseIso)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.toISOString()
}

export function entrySeconds(start: string, end: string | null, now: Date = new Date()): number {
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : now.getTime()
  return Math.max(0, Math.floor((e - s) / 1000))
}

export function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))

export function formatLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatMonth(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
