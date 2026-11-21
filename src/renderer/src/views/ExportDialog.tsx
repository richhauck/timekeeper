import { useEffect, useMemo, useState } from 'react'
import { describeRounding, roundForSettings } from '@shared/rounding'
import { decimalHours, entrySeconds, formatHM, parseDateKey } from '@shared/time'
import type { Entry, ExportRequest } from '@shared/types'
import { errorMessage, useData } from '../data'
import { CloseIcon, DownloadIcon } from '../components/Icons'
import { MultiSelect } from '../components/MultiSelect'
import { SearchInput } from '../components/SearchInput'
import { useToast } from '../components/Toast'
import type { Filters } from './ReportsView'

interface Props {
  initialFrom: string
  initialTo: string
  initialFilters: Filters
  onClose(): void
  onGoToSettings(): void
}

export function ExportDialog({ initialFrom, initialTo, initialFilters, onClose, onGoToSettings }: Props) {
  const { catalog, settings, projectById, clientById, tagById } = useData()
  const toast = useToast()
  const [req, setReq] = useState<ExportRequest>({ from: initialFrom, to: initialTo, ...initialFilters, includeEntries: true, includeSummary: true })
  const [preview, setPreview] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const valid = !!req.from && !!req.to && parseDateKey(req.from) <= parseDateKey(req.to)

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    const t = setTimeout(() => {
      window.api.previewExport(req).then((r) => !cancelled && setPreview(r.entries))
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [req, valid])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const total = useMemo(() => preview.reduce((s, e) => s + roundForSettings(entrySeconds(e.start, e.end), settings), 0), [preview, settings])

  const doExport = async () => {
    setBusy(true)
    try {
      const res = await window.api.exportExcel(req)
      if (res.saved) {
        toast(`Exported ${res.rows} ${res.rows === 1 ? 'entry' : 'entries'} to Excel`)
        onClose()
      }
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }

  const set = (patch: Partial<ExportRequest>) => setReq((r) => ({ ...r, ...patch }))
  const projectOptions = catalog.projects
    .filter((p) => !req.clientIds.length || (p.clientId != null && req.clientIds.includes(p.clientId)))
    .map((p) => ({ id: p.id, label: p.code ? `${p.code} ${p.name}` : p.name, color: p.color }))
  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--border-soft)', minWidth: 0 }
  const head: React.CSSProperties = { ...cell, fontWeight: 600, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="exp-title">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <h2 id="exp-title" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            Export timesheet to Excel
          </h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor="exp-from">
                  From
                </label>
                <input id="exp-from" type="date" className="input" value={req.from} onChange={(e) => set({ from: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor="exp-to">
                  To
                </label>
                <input id="exp-to" type="date" className="input" value={req.to} onChange={(e) => set({ to: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <span className="label">Description contains</span>
              <SearchInput value={req.text} onChange={(text) => set({ text })} placeholder="Any description" />
            </div>
            <div className="field">
              <span className="label">Clients</span>
              <MultiSelect allLabel="All clients" noun="clients" options={catalog.clients.map((c) => ({ id: c.id, label: c.name }))} value={req.clientIds} onChange={(clientIds) => set({ clientIds })} />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <span className="label">Projects</span>
                <MultiSelect allLabel="All projects" noun="projects" options={projectOptions} value={req.projectIds} onChange={(projectIds) => set({ projectIds })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <span className="label">Tags</span>
                <MultiSelect allLabel="Any tag" noun="tags" options={catalog.tags.map((t) => ({ id: t.id, label: t.name }))} value={req.tagIds} onChange={(tagIds) => set({ tagIds })} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', gap: 20 }}>
              <label className="checkbox">
                <input type="checkbox" checked={req.includeEntries} onChange={(e) => set({ includeEntries: e.target.checked })} />
                Entries sheet
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={req.includeSummary} onChange={(e) => set({ includeSummary: e.target.checked })} />
                Summary sheet by client and project
              </label>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {describeRounding(settings)} ·{' '}
              <button type="button" className="btn link" style={{ height: 'auto', fontSize: 13, color: 'var(--accent-strong)' }} onClick={onGoToSettings}>
                Change in Settings
              </button>
            </p>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Preview · Entries sheet</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {preview.length ? `First ${Math.min(4, preview.length)} of ${preview.length} rows` : 'No matching entries'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 100px 150px 120px minmax(0, 1fr) 64px 64px', fontSize: 12 }}>
              {['Date', 'Client', 'Project', 'Tags', 'Description', 'Hours', 'h:mm'].map((h, i) => (
                <span key={h} style={{ ...head, textAlign: i >= 5 ? 'right' : 'left' }}>
                  {h}
                </span>
              ))}
              {preview.slice(0, 4).map((e) => {
                const p = projectById.get(e.projectId)
                const rounded = roundForSettings(entrySeconds(e.start, e.end), settings)
                return [
                  new Date(e.start).toLocaleDateString('en-US'),
                  p?.clientId != null ? clientById.get(p.clientId)?.name ?? '' : '',
                  p ? (p.code ? `${p.code} ${p.name}` : p.name) : '',
                  e.tagIds.map((t) => tagById.get(t)?.name).filter(Boolean).join(', '),
                  e.description,
                  decimalHours(rounded).toFixed(2),
                  formatHM(rounded)
                ].map((v, i) => (
                  <span key={`${e.id}-${i}`} className={`ellipsis${i >= 5 ? ' mono' : ''}`} style={{ ...cell, textAlign: i >= 5 ? 'right' : 'left', color: i === 3 ? 'var(--muted)' : undefined }}>
                    {v}
                  </span>
                ))
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <p style={{ margin: 0, color: 'var(--text-2)' }}>
            <strong>
              {preview.length} {preview.length === 1 ? 'entry' : 'entries'}
            </strong>{' '}
            · {formatHM(total)} total
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={busy || !valid || preview.length === 0 || (!req.includeEntries && !req.includeSummary)} onClick={doExport}>
              <DownloadIcon />
              Export to Excel…
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
