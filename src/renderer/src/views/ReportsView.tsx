import { useEffect, useMemo, useState } from 'react'
import { buildReport, filterEntries, periodDateKeys, periodRange, shiftPeriod, type Breakdown, type Period } from '@shared/reports'
import { MONTHS_SHORT, formatHM, formatLongDate, formatMonth } from '@shared/time'
import type { Entry } from '@shared/types'
import { useData, useNow } from '../data'
import { ChevronLeft, ChevronRight, DownloadIcon } from '../components/Icons'
import { MultiSelect } from '../components/MultiSelect'
import { SearchInput } from '../components/SearchInput'
import { ExportDialog } from './ExportDialog'

export interface Filters {
  clientIds: number[]
  projectIds: number[]
  tagIds: number[]
  text: string
}

const FALLBACK_COLORS = ['#2457C5', '#D9692B', '#7A4FC9', '#12877A', '#B7860B', '#C93E77', '#4E8A2E', '#8A94A3']

export function ReportsView({ onGoToSettings }: { onGoToSettings(): void }) {
  const { catalog, settings, version, running } = useData()
  const [period, setPeriod] = useState<Period>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [filters, setFilters] = useState<Filters>({ clientIds: [], projectIds: [], tagIds: [], text: '' })
  const [entries, setEntries] = useState<Entry[]>([])
  const [exporting, setExporting] = useState(false)
  const { from, to } = periodRange(period, anchor)
  const now = useNow(30_000, !!running)

  useEffect(() => {
    let cancelled = false
    window.api.listEntries({ from: from.toISOString(), to: to.toISOString() }).then((list) => {
      if (!cancelled) setEntries(list)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.getTime(), to.getTime(), version])

  const report = useMemo(
    () => buildReport(filterEntries(entries, catalog, filters), catalog, settings, period, anchor, now),
    [entries, catalog, filters, settings, period, anchor, now]
  )

  const label = period === 'day' ? formatLongDate(anchor) : period === 'month' ? formatMonth(anchor) : String(anchor.getFullYear())
  const isCurrent = periodRange(period, new Date()).from.getTime() === from.getTime()

  const projectOptions = catalog.projects
    .filter((p) => !filters.clientIds.length || (p.clientId != null && filters.clientIds.includes(p.clientId)))
    .map((p) => ({ id: p.id, label: p.code ? `${p.code} ${p.name}` : p.name, color: p.color }))

  return (
    <main className="page">
      <header style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'center', gap: 16 }}>
        <div className="segmented" role="group" aria-label="Report period" style={{ justifySelf: 'start' }}>
          {(['day', 'month', 'year'] as Period[]).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button type="button" className="btn" style={{ width: 40, padding: 0 }} aria-label="Previous period" onClick={() => setAnchor((a) => shiftPeriod(period, a, -1))}>
            <ChevronLeft />
          </button>
          <span style={{ minWidth: 230, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>{label}</span>
          <button type="button" className="btn" style={{ width: 40, padding: 0 }} aria-label="Next period" onClick={() => setAnchor((a) => shiftPeriod(period, a, 1))}>
            <ChevronRight />
          </button>
          {!isCurrent && (
            <button type="button" className="btn sm" style={{ marginLeft: 6 }} onClick={() => setAnchor(new Date())}>
              {period === 'day' ? 'Today' : period === 'month' ? 'This month' : 'This year'}
            </button>
          )}
        </div>
        <button type="button" className="btn primary" style={{ justifySelf: 'end' }} onClick={() => setExporting(true)}>
          <DownloadIcon />
          Export to Excel
        </button>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span className="label" style={{ fontSize: 13 }}>
          Filter
        </span>
        <MultiSelect
          allLabel="All clients"
          noun="clients"
          options={catalog.clients.map((c) => ({ id: c.id, label: c.name }))}
          value={filters.clientIds}
          onChange={(clientIds) => setFilters((f) => ({ ...f, clientIds }))}
        />
        <MultiSelect allLabel="All projects" noun="projects" options={projectOptions} value={filters.projectIds} onChange={(projectIds) => setFilters((f) => ({ ...f, projectIds }))} />
        <MultiSelect
          allLabel="Any tag"
          noun="tags"
          options={catalog.tags.map((t) => ({ id: t.id, label: t.name }))}
          value={filters.tagIds}
          onChange={(tagIds) => setFilters((f) => ({ ...f, tagIds }))}
        />
        <SearchInput value={filters.text} onChange={(text) => setFilters((f) => ({ ...f, text }))} placeholder="Search descriptions" height={36} style={{ flex: '1 1 200px', maxWidth: 280 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Total hours
          </p>
          <p className="stat">{formatHM(report.totalSeconds)}</p>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Entries
          </p>
          <p className="stat" style={{ color: 'var(--text-2)' }}>
            {report.entryCount.toLocaleString('en-US')}
          </p>
        </div>
      </div>

      {period !== 'day' && (
        <section aria-labelledby="trend-h" className="card pad">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 id="trend-h">{period === 'year' ? 'Hours per month' : 'Hours per day'}</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Rounded hours
            </span>
          </div>
          <ColumnChart period={period} buckets={report.buckets} />
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, alignItems: 'stretch' }}>
        <section aria-labelledby="proj-h" className="card pad">
          <h2 id="proj-h" style={{ marginBottom: 16 }}>
            By project
          </h2>
          <ProjectBars items={report.byProject} total={report.totalSeconds} />
        </section>
        <section aria-labelledby="client-h" className="card pad">
          <h2 id="client-h" style={{ marginBottom: 16 }}>
            By client
          </h2>
          <ClientPie items={report.byClient} byProject={report.byProject} />
        </section>
        <section aria-labelledby="tag-h" className="card pad">
          <h2 id="tag-h">By tag</h2>
          <p className="muted" style={{ margin: '4px 0 8px', fontSize: 12 }}>
            An entry with several tags counts toward each one.
          </p>
          {report.byTag.length === 0 && <p className="muted">No tagged time in this period.</p>}
          {report.byTag.map((t) => (
            <div key={t.id ?? t.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <span className="chip">{t.label}</span>
              <span className="mono" style={{ fontWeight: 500 }}>
                {formatHM(t.seconds)}
              </span>
            </div>
          ))}
        </section>
      </div>

      {exporting && (
        <ExportDialog
          initialFrom={periodDateKeys(period, anchor).from}
          initialTo={periodDateKeys(period, anchor).to}
          initialFilters={filters}
          onClose={() => setExporting(false)}
          onGoToSettings={() => {
            setExporting(false)
            onGoToSettings()
          }}
        />
      )}
    </main>
  )
}

function ColumnChart({ period, buckets }: { period: Period; buckets: { start: Date; seconds: number }[] }) {
  const max = Math.max(8 * 3600 * (period === 'year' ? 20 : 1), ...buckets.map((b) => b.seconds))
  const gap = period === 'year' ? 16 : 4
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="columns" style={{ minWidth: 560, gap }} role="img" aria-label={buckets.map((b) => `${bucketLabel(period, b.start, true)}: ${formatHM(b.seconds)}`).join(', ')}>
        {buckets.map((b) => (
          <div className="col" key={b.start.getTime()} title={`${bucketLabel(period, b.start, true)}: ${formatHM(b.seconds)}`}>
            <div style={{ height: `${(b.seconds / max) * 190}px` }} />
          </div>
        ))}
      </div>
      <div style={{ minWidth: 560, display: 'flex', gap, paddingTop: 6 }}>
        {buckets.map((b, i) => (
          <span key={b.start.getTime()} className="muted" style={{ flex: '1 1 0', textAlign: 'center', fontSize: 11 }}>
            {period === 'year' || i % 7 === 0 || i === buckets.length - 1 ? bucketLabel(period, b.start, false) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function bucketLabel(period: Period, d: Date, long: boolean): string {
  if (period === 'year') return long ? formatMonth(d) : MONTHS_SHORT[d.getMonth()]
  return long ? `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}` : String(d.getDate())
}

function ProjectBars({ items, total }: { items: Breakdown[]; total: number }) {
  if (items.length === 0) return <p className="muted">No time in this period.</p>
  const max = Math.max(...items.map((i) => i.seconds))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {items.map((p) => (
        <div key={p.id ?? p.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="dot" style={{ background: p.color }} />
            <span className="ellipsis" style={{ flex: 1, fontSize: 14 }}>
              {p.label}
            </span>
            <span className="mono" style={{ fontWeight: 500 }}>
              {formatHM(p.seconds)}
            </span>
            <span className="muted" style={{ width: 40, textAlign: 'right', fontSize: 12 }}>
              {total ? Math.round((p.seconds / total) * 100) : 0}%
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(p.seconds / max) * 100}%`, background: p.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ClientPie({ items, byProject }: { items: Breakdown[]; byProject: Breakdown[] }) {
  const { projectById } = useData()
  const slices = items.filter((i) => i.seconds > 0)
  if (slices.length === 0) return <p className="muted">No time in this period.</p>
  const total = slices.reduce((s, i) => s + i.seconds, 0)

  // A client takes the color of its biggest project in this report.
  const colorFor = (clientId: number | null, index: number): string => {
    const top = byProject.find((p) => p.id != null && (projectById.get(p.id)?.clientId ?? null) === clientId)
    return top?.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
  }

  const pt = (a: number) => `${(80 + 76 * Math.cos(a)).toFixed(2)} ${(80 + 76 * Math.sin(a)).toFixed(2)}`
  let a0 = -Math.PI / 2
  const parts = slices.map((s, i) => {
    const a1 = a0 + (s.seconds / total) * 2 * Math.PI
    const d = slices.length === 1 ? '' : `M80 80 L${pt(a0)} A76 76 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)} Z`
    a0 = a1
    const pct = Math.round((s.seconds / total) * 100)
    return { ...s, d, color: colorFor(s.id, i), pct, tip: `${s.label}: ${formatHM(s.seconds)} (${pct}%)` }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label={`Hours by client: ${parts.map((p) => p.tip).join(', ')}`} style={{ flex: 'none' }}>
        {parts.map((p) =>
          p.d ? (
            <path key={p.id ?? 'none'} d={p.d} fill={p.color} stroke="var(--surface)" strokeWidth="2" strokeLinejoin="round">
              <title>{p.tip}</title>
            </path>
          ) : (
            <circle key={p.id ?? 'none'} cx="80" cy="80" r="76" fill={p.color}>
              <title>{p.tip}</title>
            </circle>
          )
        )}
      </svg>
      <div style={{ alignSelf: 'stretch', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {parts.map((p) => (
          <div key={p.id ?? 'none'} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, flex: 'none', background: p.color }} />
            <span className="ellipsis" style={{ flex: 1 }}>
              {p.label}
            </span>
            <span className="mono" style={{ fontWeight: 500 }}>
              {formatHM(p.seconds)}
            </span>
            <span className="muted" style={{ width: 36, textAlign: 'right', fontSize: 12 }}>
              {p.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
