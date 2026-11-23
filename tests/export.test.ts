import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildWorkbook, readableTextOn, selectExportEntries } from '../src/main/export'
import { DEFAULT_SETTINGS, type Catalog, type Entry, type ExportRequest } from '@shared/types'

const catalog: Catalog = {
  clients: [{ id: 1, name: 'Acme Co.', archived: false, createdAt: '' }],
  projects: [{ id: 10, clientId: 1, code: 'ACM-101', name: 'Website redesign', color: '#12877A', archived: false, createdAt: '' }],
  tags: [{ id: 100, name: 'design', createdAt: '' }]
}
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()
const entries: Entry[] = [
  { id: 1, projectId: 10, description: 'Wireframes', start: local(1, 9, 15), end: local(1, 10, 47), idleSeconds: 0, tagIds: [100], createdAt: '', updatedAt: '' },
  { id: 2, projectId: 10, description: 'Call', start: local(2, 10, 50), end: local(2, 11, 58), idleSeconds: 0, tagIds: [], createdAt: '', updatedAt: '' },
  { id: 3, projectId: 10, description: 'Outside', start: local(31, 23, 0), end: null, idleSeconds: 0, tagIds: [], createdAt: '', updatedAt: '' }
]
const req: ExportRequest = { from: '2026-10-01', to: '2026-10-31', clientIds: [], projectIds: [], tagIds: [], text: '', includeEntries: true, includeSummary: true }

describe('export', () => {
  it('selects finished entries in the date range', () => {
    expect(selectExportEntries(entries, catalog, req).map((e) => e.id)).toEqual([1, 2])
    expect(selectExportEntries(entries, catalog, { ...req, text: 'call' }).map((e) => e.id)).toEqual([2])
  })

  it('writes Entries and Summary sheets with rounded hours and formulas', async () => {
    const wb = buildWorkbook(selectExportEntries(entries, catalog, req), catalog, DEFAULT_SETTINGS, req)
    const ws = wb.getWorksheet('Entries')!
    expect(ws.getRow(1).values).toEqual([undefined, 'Date', 'Client', 'Project code', 'Project', 'Tags', 'Description', 'Start', 'End', 'Hours', 'h:mm'])
    expect(ws.getCell('I2').value).toBe(1.5)
    expect(ws.getCell('I3').value).toBe(1.25)
    expect(ws.getCell('E2').value).toBe('design')
    expect(ws.getCell('I4').value).toEqual({ formula: 'SUM(I2:I3)', result: 2.75 })
    const sum = wb.getWorksheet('Summary')!
    expect(sum.getCell('B2').value).toBe('ACM-101 Website redesign')
    expect((sum.getCell('C2').value as { formula: string }).formula).toContain('SUMIFS(Entries!I:I')
    const buf = await wb.xlsx.writeBuffer()
    expect(buf.byteLength).toBeGreaterThan(1000)
  })

  it('picks readable text on colored fills', () => {
    expect(readableTextOn('#12877A')).toBe('FFFFFFFF')
    expect(readableTextOn('#F5E663')).toBe('FF161A21')
  })
})

describe('export: choosing entries', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()
  const mk = (id: number, start: string, end: string | null): Entry => ({ id, projectId: 10, description: '', start, end, idleSeconds: 0, tagIds: [], createdAt: '', updatedAt: '' })
  const range = { ...req, from: '2026-10-05', to: '2026-10-06' }

  it('includes whole local days at both ends and nothing outside', () => {
    const list = [
      mk(1, at(4, 23, 59), at(5, 0, 30)), // starts the day before
      mk(2, at(5, 0, 0), at(5, 1, 0)), // first moment of the range
      mk(3, at(6, 23, 59), at(7, 0, 30)), // last minute of the range, runs past it
      mk(4, at(7, 0, 0), at(7, 1, 0)), // first moment after
      mk(5, at(6, 9, 0), null) // still running
    ]
    expect(selectExportEntries(list, catalog, range).map((e) => e.id)).toEqual([2, 3])
  })

  it('sorts by start time', () => {
    const list = [mk(1, at(6, 9), at(6, 10)), mk(2, at(5, 9), at(5, 10))]
    expect(selectExportEntries(list, catalog, range).map((e) => e.id)).toEqual([2, 1])
  })
})

describe('export: workbook layout', () => {
  const cat: Catalog = {
    clients: [
      { id: 1, name: 'Zeta Corp', archived: false, createdAt: '' },
      { id: 2, name: 'Acme Co.', archived: false, createdAt: '' }
    ],
    projects: [
      { id: 10, clientId: 1, code: 'ZET-1', name: 'App', color: '#2457C5', archived: false, createdAt: '' },
      { id: 11, clientId: 2, code: 'ACM-1', name: 'Site', color: '#F5E663', archived: false, createdAt: '' },
      { id: 12, clientId: 2, code: 'ACM-2', name: 'Brand', color: '#12877A', archived: false, createdAt: '' },
      { id: 13, clientId: null, code: '', name: 'Internal', color: '#B7860B', archived: false, createdAt: '' }
    ],
    tags: []
  }
  const t = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()
  const e = (id: number, projectId: number, d: number, h: number, minutes: number, description = ''): Entry => ({
    id, projectId, description, start: t(d, h), end: new Date(new Date(t(d, h)).getTime() + minutes * 60000).toISOString(),
    idleSeconds: 0, tagIds: [], createdAt: '', updatedAt: ''
  })
  const list = [e(1, 10, 1, 9, 60), e(2, 11, 1, 11, 30), e(3, 12, 2, 9, 120), e(4, 11, 2, 14, 45), e(5, 13, 3, 9, 15)]

  it('groups the summary by client (A to Z, no client last) with subtotals and a grand total', () => {
    const ws = buildWorkbook(list, cat, DEFAULT_SETTINGS, req).getWorksheet('Summary')!
    const col = (c: string) => Array.from({ length: ws.rowCount }, (_, i) => ws.getCell(`${c}${i + 1}`).value)
    expect(col('A').slice(0, 10)).toEqual([
      'Client', 'Acme Co.', 'Acme Co.', 'Acme Co. total', 'Zeta Corp', 'Zeta Corp total', 'No client', 'No client total', 'Total', null
    ])
    // Within a client, the biggest project comes first.
    expect(col('B').slice(1, 3)).toEqual(['ACM-2 Brand', 'ACM-1 Site'])
    expect(ws.getCell('C4').value).toMatchObject({ formula: 'SUM(C2:C3)' })
    expect(ws.getCell('C6').value).toMatchObject({ formula: 'SUM(C5:C5)' })
    expect(ws.getCell('C9').value).toMatchObject({ formula: 'C4+C6+C8' })
    expect(col('A').slice(10)).toEqual(['Dates: 2026-10-01 to 2026-10-31', 'Rounding: nearest 15 min per entry'])
  })

  it('stores totals with their values, so viewers that do not recalculate still show them', () => {
    const wb = buildWorkbook(list, cat, DEFAULT_SETTINGS, req)
    const entries = wb.getWorksheet('Entries')!
    // 1:00 + 0:30 + 2:00 + 0:45 + 0:15 = 4.5 hours
    expect(entries.getCell('I7').value).toMatchObject({ formula: 'SUM(I2:I6)', result: 4.5 })
    expect(entries.getCell('J7').value).toMatchObject({ formula: 'SUM(J2:J6)', result: 4.5 / 24 })
    const sum = wb.getWorksheet('Summary')!
    expect(sum.getCell('C4').value).toMatchObject({ result: 3.25 })
    expect(sum.getCell('C9').value).toMatchObject({ result: 4.5 })
    expect(wb.calcProperties.fullCalcOnLoad).toBe(true)
  })

  it('writes plain-text descriptions, as the preview shows them', () => {
    const md = [e(1, 10, 1, 9, 60, '**Wireframes** for _pricing_ page\n- see [spec](https://example.com)')]
    const ws = buildWorkbook(md, cat, DEFAULT_SETTINGS, req).getWorksheet('Entries')!
    expect(ws.getCell('F2').value).toBe('Wireframes for pricing page · see spec')
  })

  it('matches project names literally in summary formulas, even with wildcard characters', () => {
    const odd: Catalog = {
      ...cat,
      projects: [
        { id: 20, clientId: null, code: '', name: 'Design*', color: '#2457C5', archived: false, createdAt: '' },
        { id: 21, clientId: null, code: 'Q?', name: '~tilde "quoted"', color: '#2457C5', archived: false, createdAt: '' },
        { id: 22, clientId: null, code: '>5', name: '=Total', color: '#2457C5', archived: false, createdAt: '' }
      ]
    }
    const ws = buildWorkbook([e(1, 20, 1, 9, 60), e(2, 21, 1, 11, 60), e(3, 22, 1, 13, 60)], odd, DEFAULT_SETTINGS, req).getWorksheet('Summary')!
    const formulas = [2, 3, 4].map((r) => (ws.getCell(`C${r}`).value as { formula: string }).formula)
    expect(formulas).toContain('SUMIFS(Entries!I:I,Entries!C:C,"=",Entries!D:D,"=Design~*")')
    expect(formulas).toContain('SUMIFS(Entries!I:I,Entries!C:C,"=Q~?",Entries!D:D,"=~~tilde ""quoted""")')
    expect(formulas).toContain('SUMIFS(Entries!I:I,Entries!C:C,"=>5",Entries!D:D,"==Total")')
  })

  it('makes only the sheets asked for', () => {
    const only = (includeEntries: boolean, includeSummary: boolean) =>
      buildWorkbook(list, cat, DEFAULT_SETTINGS, { ...req, includeEntries, includeSummary }).worksheets.map((w) => w.name)
    expect(only(true, false)).toEqual(['Entries'])
    expect(only(false, true)).toEqual(['Summary'])
    // Nothing chosen still produces something useful.
    expect(only(false, false)).toEqual(['Entries'])
  })

  it('uses plain numbers in a summary without an Entries sheet to refer to', () => {
    const ws = buildWorkbook(list, cat, DEFAULT_SETTINGS, { ...req, includeEntries: false }).getWorksheet('Summary')!
    expect(ws.getCell('C2').value).toBe(2)
  })

  it('lists active filters at the bottom of the summary', () => {
    const filtered = { ...req, clientIds: [2], projectIds: [11], tagIds: [], text: ' call ' }
    const ws = buildWorkbook([list[1]], cat, DEFAULT_SETTINGS, filtered).getWorksheet('Summary')!
    expect(ws.getCell(`A${ws.rowCount}`).value).toBe('Clients: Acme Co. · Projects: ACM-1 Site · Description contains "call"')
  })

  it('writes a valid workbook for an empty export', async () => {
    const wb = buildWorkbook([], cat, DEFAULT_SETTINGS, req)
    expect(wb.getWorksheet('Entries')!.getCell('I2').value).toBe(0)
    expect(wb.getWorksheet('Summary')!.getCell('A2').value).toBe('Total')
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(await wb.xlsx.writeBuffer())
    expect(back.worksheets.map((w) => w.name)).toEqual(['Entries', 'Summary'])
  })

  it('survives a save and reload with local dates and times intact', async () => {
    const late = e(9, 10, 31, 23, 90) // 23:00 local on Oct 31 to 00:30 the next day
    const wb = buildWorkbook([late], cat, DEFAULT_SETTINGS, req)
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(await wb.xlsx.writeBuffer())
    const ws = back.getWorksheet('Entries')!
    // Excel dates have no zone: the cell holds the local calendar date.
    expect((ws.getCell('A2').value as Date).toISOString().slice(0, 10)).toBe('2026-10-31')
    // Time cells read back as dates on Excel's 1899-12-30 epoch; compare the fraction of a day.
    const dayFraction = (v: unknown) => ((v as Date).getTime() - Date.UTC(1899, 11, 30)) / 86400000
    expect(dayFraction(ws.getCell('G2').value)).toBeCloseTo(23 / 24, 9)
    expect(dayFraction(ws.getCell('H2').value)).toBeCloseTo(0.5 / 24, 9)
    expect(ws.getCell('I2').value).toBe(1.5)
    expect(ws.getCell('B2').value).toBe('Zeta Corp')
  })
})
