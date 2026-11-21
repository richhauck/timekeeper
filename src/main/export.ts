import ExcelJS from 'exceljs'
import { describeRounding } from '@shared/rounding'
import { filterEntries, projectLabel, roundEntries } from '@shared/reports'
import { addDays, decimalHours, parseDateKey } from '@shared/time'
import type { Catalog, Entry, ExportRequest, Settings } from '@shared/types'

/** Entries for an export: those that start within the requested local dates, filtered. */
export function selectExportEntries(all: Entry[], catalog: Catalog, req: ExportRequest): Entry[] {
  const from = parseDateKey(req.from).getTime()
  const to = addDays(parseDateKey(req.to), 1).getTime()
  const inRange = all.filter((e) => {
    const s = new Date(e.start).getTime()
    return s >= from && s < to && e.end !== null
  })
  return filterEntries(inRange, catalog, req).sort((a, b) => a.start.localeCompare(b.start))
}

export function exportRange(req: ExportRequest): { from: string; to: string } {
  return { from: parseDateKey(req.from).toISOString(), to: addDays(parseDateKey(req.to), 1).toISOString() }
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F2F5' } }

export function buildWorkbook(entries: Entry[], catalog: Catalog, settings: Settings, req: ExportRequest): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Timekeeper'
  wb.created = new Date()

  const projectById = new Map(catalog.projects.map((p) => [p.id, p]))
  const clientById = new Map(catalog.clients.map((c) => [c.id, c]))
  const tagById = new Map(catalog.tags.map((t) => [t.id, t]))
  const rounded = roundEntries(entries, settings)

  const includeEntries = req.includeEntries || !req.includeSummary

  if (includeEntries) {
    const ws = wb.addWorksheet('Entries', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = [
      { header: 'Date', key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'Client', key: 'client', width: 18 },
      { header: 'Project code', key: 'code', width: 14 },
      { header: 'Project', key: 'project', width: 26 },
      { header: 'Tags', key: 'tags', width: 22 },
      { header: 'Description', key: 'description', width: 44 },
      { header: 'Start', key: 'start', width: 10, style: { numFmt: 'h:mm AM/PM' } },
      { header: 'End', key: 'end', width: 10, style: { numFmt: 'h:mm AM/PM' } },
      { header: 'Hours', key: 'hours', width: 9, style: { numFmt: '0.00' } },
      { header: 'h:mm', key: 'hm', width: 9, style: { numFmt: '[h]:mm' } }
    ]
    styleHeader(ws.getRow(1))
    for (const r of rounded) {
      const p = projectById.get(r.entry.projectId)
      const client = p?.clientId != null ? clientById.get(p.clientId)?.name ?? '' : ''
      const start = new Date(r.entry.start)
      const end = new Date(r.entry.end ?? r.entry.start)
      ws.addRow({
        date: excelLocalDate(start),
        client,
        code: p?.code ?? '',
        project: p?.name ?? 'Deleted project',
        tags: r.entry.tagIds.map((id) => tagById.get(id)?.name).filter(Boolean).join(', '),
        description: r.entry.description,
        start: excelLocalTime(start),
        end: excelLocalTime(end),
        hours: decimalHours(r.roundedSeconds),
        hm: r.roundedSeconds / 86400
      })
    }
    const last = ws.rowCount
    const totalRow = ws.addRow({ description: 'Total' })
    totalRow.getCell('hours').value = last >= 2 ? { formula: `SUM(I2:I${last})` } : 0
    totalRow.getCell('hm').value = last >= 2 ? { formula: `SUM(J2:J${last})` } : 0
    totalRow.font = { bold: true }
    ws.autoFilter = { from: 'A1', to: `J${Math.max(1, last)}` }
  }

  if (req.includeSummary) {
    const ws = wb.addWorksheet('Summary')
    ws.columns = [
      { header: 'Client', key: 'client', width: 22 },
      { header: 'Project', key: 'project', width: 32 },
      { header: 'Hours', key: 'hours', width: 10, style: { numFmt: '0.00' } }
    ]
    styleHeader(ws.getRow(1))

    // Group rounded seconds by client, then project.
    const groups = new Map<string, Map<number, number>>()
    for (const r of rounded) {
      const p = projectById.get(r.entry.projectId)
      const client = p?.clientId != null ? clientById.get(p.clientId)?.name ?? 'No client' : 'No client'
      const byProject = groups.get(client) ?? new Map<number, number>()
      byProject.set(r.entry.projectId, (byProject.get(r.entry.projectId) ?? 0) + r.roundedSeconds)
      groups.set(client, byProject)
    }

    const subtotalCells: string[] = []
    for (const client of [...groups.keys()].sort((a, b) => (a === 'No client' ? 1 : b === 'No client' ? -1 : a.localeCompare(b)))) {
      const byProject = groups.get(client)!
      const first = ws.rowCount + 1
      for (const [projectId, seconds] of [...byProject.entries()].sort((a, b) => b[1] - a[1])) {
        const p = projectById.get(projectId)
        const label = p ? projectLabel(p.code, p.name) : 'Deleted project'
        const row = ws.addRow({ client, project: label })
        if (includeEntries && p) {
          // Live formula against the Entries sheet so edits there flow through.
          row.getCell('hours').value = {
            formula: `SUMIFS(Entries!I:I,Entries!C:C,${xlString(p.code)},Entries!D:D,${xlString(p.name)})`,
            result: decimalHours(seconds)
          }
        } else {
          row.getCell('hours').value = decimalHours(seconds)
        }
        if (p) {
          const argb = 'FF' + p.color.replace('#', '').toUpperCase()
          row.getCell('project').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
          row.getCell('project').font = { color: { argb: readableTextOn(p.color) } }
        }
      }
      const lastRow = ws.rowCount
      const sub = ws.addRow({ client: `${client} total` })
      sub.getCell('hours').value = { formula: `SUM(C${first}:C${lastRow})` }
      sub.font = { bold: true }
      subtotalCells.push(`C${sub.number}`)
    }
    const grand = ws.addRow({ client: 'Total' })
    grand.getCell('hours').value = subtotalCells.length ? { formula: subtotalCells.join('+') } : 0
    grand.font = { bold: true }

    ws.addRow({})
    ws.addRow({ client: `Dates: ${req.from} to ${req.to}` })
    ws.addRow({ client: describeRounding(settings) })
    const filters = describeFilters(req, catalog)
    if (filters) ws.addRow({ client: filters })
  }

  return wb
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true }
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCDD2DA' } } }
  })
}

/** Excel stores dates without a time zone, so write the local wall-clock date. */
function excelLocalDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

/** A time-of-day as a fraction of a day, in local time. */
function excelLocalTime(d: Date): number {
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400
}

function xlString(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

/** Black or white text, whichever reads better on the given fill. */
export function readableTextOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b))
  return lum > 0.4 ? 'FF161A21' : 'FFFFFFFF'
}

function lin(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function describeFilters(req: ExportRequest, catalog: Catalog): string {
  const parts: string[] = []
  if (req.clientIds.length) parts.push('Clients: ' + req.clientIds.map((id) => catalog.clients.find((c) => c.id === id)?.name).filter(Boolean).join(', '))
  if (req.projectIds.length)
    parts.push(
      'Projects: ' +
        req.projectIds
          .map((id) => catalog.projects.find((p) => p.id === id))
          .filter(Boolean)
          .map((p) => projectLabel(p!.code, p!.name))
          .join(', ')
    )
  if (req.tagIds.length) parts.push('Tags: ' + req.tagIds.map((id) => catalog.tags.find((t) => t.id === id)?.name).filter(Boolean).join(', '))
  if (req.text.trim()) parts.push(`Description contains "${req.text.trim()}"`)
  return parts.join(' · ')
}
