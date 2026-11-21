import { describe, expect, it } from 'vitest'
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
    expect(ws.getCell('I4').value).toEqual({ formula: 'SUM(I2:I3)' })
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
