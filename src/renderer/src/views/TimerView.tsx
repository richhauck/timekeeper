import { useEffect, useMemo, useState } from 'react'
import { roundForSettings } from '@shared/rounding'
import { addDays, dateKey, entrySeconds, formatClock, formatHM, formatLongDate, timesFromInputs, toTimeInput } from '@shared/time'
import type { Entry } from '@shared/types'
import { errorMessage, tagIdsForNames, useData, useNow } from '../data'
import { GripIcon, PlayIcon, StopIcon, TrashIcon } from '../components/Icons'
import { ProjectSelect } from '../components/ProjectSelect'
import { TagInput } from '../components/TagInput'
import { AutoTextarea, DescriptionField } from '../components/DescriptionInput'
import { useToast } from '../components/Toast'

export function TimerView({ onGoToProjects }: { onGoToProjects(): void }) {
  const { catalog } = useData()
  const hasProjects = catalog.projects.some((p) => !p.archived)
  return (
    <main className="page">
      {hasProjects ? (
        <TimerBar />
      ) : (
        <section className="card pad" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2>Create a project to start tracking</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>Time is always tracked against a project. Add one with a name, a code and a color.</p>
          </div>
          <button type="button" className="btn primary" onClick={onGoToProjects}>
            Go to Projects
          </button>
        </section>
      )}
      <EntriesSection />
    </main>
  )
}

// ---------------------------------------------------------------- timer bar

function TimerBar() {
  const { running, catalog, tagById, settings } = useData()
  const toast = useToast()
  const now = useNow(1000, !!running)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const runningId = running?.id ?? null

  // Mirror the running entry; when idle, default to the most recently used project.
  useEffect(() => {
    if (running) {
      setProjectId(running.projectId)
      setDescription(running.description)
      setTags(running.tagIds.map((id) => tagById.get(id)?.name).filter((n): n is string => !!n))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningId, running?.projectId, running?.description, running?.tagIds.join(',')])

  useEffect(() => {
    if (projectId == null || !catalog.projects.some((p) => p.id === projectId && !p.archived)) {
      if (running) return
      window.api
        .listEntries({ from: addDays(new Date(), -60).toISOString(), to: addDays(new Date(), 1).toISOString() })
        .then((list) => {
          const recent = list.find((e) => catalog.projects.some((p) => p.id === e.projectId && !p.archived))
          setProjectId(recent?.projectId ?? catalog.projects.find((p) => !p.archived)?.id ?? null)
        })
    }
  }, [catalog.projects, projectId, running])

  const update = async (patch: { projectId?: number; description?: string; tagIds?: number[] }) => {
    if (!running) return
    try {
      await window.api.updateRunning(patch)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const toggle = async () => {
    setBusy(true)
    try {
      if (running) {
        await window.api.stopTimer()
        setDescription('')
        setTags([])
      } else {
        if (projectId == null) return
        const tagIds = await tagIdsForNames(tags, catalog.tags)
        await window.api.startTimer({ projectId, description, tagIds })
      }
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }

  const elapsed = running ? entrySeconds(running.start, null, now) : 0
  const project = projectId != null ? catalog.projects.find((p) => p.id === projectId) : undefined
  const client = project?.clientId != null ? catalog.clients.find((c) => c.id === project.clientId)?.name : undefined

  return (
    <section aria-label="Timer" className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '0 1 320px' }}>
          <label className="label" htmlFor="timer-project">
            Project{client ? ` · ${client}` : ''}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="dot" style={{ background: project?.color ?? 'var(--border)' }} />
            <ProjectSelect
              id="timer-project"
              value={projectId}
              className="select"
              style={{ flex: 1, height: 44 }}
              onChange={(id) => {
                setProjectId(id)
                update({ projectId: id })
              }}
            />
          </div>
        </div>
        <div className="field" style={{ flex: '1 1 320px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <label className="label" htmlFor="timer-desc">
              What are you working on?
            </label>
            <span id="timer-desc-hint" className="muted" style={{ fontSize: 12 }}>
              Markdown · Shift+Enter for a new line
            </span>
          </div>
          <AutoTextarea
            id="timer-desc"
            className="input lg textarea"
            placeholder="Describe the work"
            aria-describedby="timer-desc-hint"
            value={description}
            onChange={setDescription}
            onBlur={() => running && description !== running.description && update({ description })}
            onSubmit={() => {
              if (running) update({ description })
              else toggle()
            }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <TagInput
          value={tags}
          onChange={async (names) => {
            setTags(names)
            if (running) {
              try {
                await update({ tagIds: await tagIdsForNames(names, catalog.tags) })
              } catch (err) {
                toast(errorMessage(err), { error: true })
              }
            }
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <p className="mono" aria-live="off" style={{ margin: 0, fontSize: 36, fontWeight: 500, letterSpacing: -0.5, color: running ? 'var(--text)' : 'var(--muted)' }}>
              {formatClock(elapsed)}
            </p>
            {running && settings.roundingMinutes > 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Counts as {formatHM(roundForSettings(elapsed, settings))}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn"
            disabled={busy || (!running && projectId == null)}
            onClick={toggle}
            style={{
              minWidth: 120,
              height: 48,
              border: 'none',
              borderRadius: 10,
              background: running ? 'var(--danger-btn)' : 'var(--start-btn)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600
            }}
          >
            {running ? <StopIcon /> : <PlayIcon />}
            {running ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- entries

type ColKey = 'time' | 'project' | 'desc' | 'dur'

const PAGE_SIZE = 50
const EARLIEST = new Date(0).toISOString()
const LATEST = '9999-12-31T00:00:00.000Z'

function dayLabel(d: Date): string {
  const key = dateKey(d)
  if (key === dateKey(new Date())) return 'Today'
  if (key === dateKey(addDays(new Date(), -1))) return 'Yesterday'
  return formatLongDate(d)
}

const COLS: Record<ColKey, { label: string; width: string; right?: boolean }> = {
  time: { label: 'Time', width: '260px' },
  project: { label: 'Project', width: 'minmax(200px, 1.1fr)' },
  desc: { label: 'Description and tags', width: 'minmax(240px, 2fr)' },
  dur: { label: 'Duration', width: '96px', right: true }
}

function EntriesSection() {
  const { version, settings, running, catalog } = useData()
  const toast = useToast()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [entries, setEntries] = useState<Entry[]>([])
  const [order, setOrder] = useState<ColKey[]>(['time', 'project', 'desc', 'dur'])
  const [dragging, setDragging] = useState<ColKey | null>(null)
  const [over, setOver] = useState<ColKey | null>(null)

  useEffect(() => {
    let cancelled = false
    // Fetch one extra so the running entry (filtered out below) doesn't shrink the page.
    window.api.listEntries({ from: EARLIEST, to: LATEST, limit: limit + 1 }).then((list) => {
      if (!cancelled) setEntries(list)
    })
    return () => {
      cancelled = true
    }
  }, [limit, version])

  const finished = useMemo(() => entries.filter((e) => e.end !== null && e.id !== running?.id).slice(0, limit), [entries, running?.id, limit])
  const hasMore = entries.length > limit
  const groups = useMemo(() => {
    const out: { key: string; label: string; entries: Entry[]; total: number }[] = []
    for (const e of finished) {
      const d = new Date(e.start)
      const key = dateKey(d)
      let g = out[out.length - 1]
      if (!g || g.key !== key) {
        g = { key, label: dayLabel(d), entries: [], total: 0 }
        out.push(g)
      }
      g.entries.push(e)
      g.total += roundForSettings(entrySeconds(e.start, e.end), settings)
    }
    return out
  }, [finished, settings])

  const move = (from: number, to: number) => {
    const next = order.slice()
    const [k] = next.splice(from, 1)
    next.splice(to, 0, k)
    setOrder(next)
  }

  const remove = async (e: Entry) => {
    try {
      const removed = await window.api.deleteEntry(e.id)
      if (!removed) return
      toast('Entry deleted', {
        action: {
          label: 'Undo',
          run: () => window.api.restoreEntry(removed).catch((err) => toast(errorMessage(err), { error: true }))
        }
      })
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const addManual = async () => {
    const projectId = finished[0]?.projectId ?? running?.projectId ?? catalog.projects.find((p) => !p.archived)?.id
    if (projectId == null) {
      toast('Create a project first.', { error: true })
      return
    }
    const end = new Date()
    end.setSeconds(0, 0)
    const start = new Date(end.getTime() - 30 * 60000)
    try {
      await window.api.createEntry({ projectId, description: '', start: start.toISOString(), end: end.toISOString(), tagIds: [] })
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const gridCols = order.map((k) => COLS[k].width).join(' ') + ' 44px'

  return (
    <section aria-labelledby="entries-h" className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 id="entries-h" className="h2">
            Latest entries
          </h2>
        </div>
        <button type="button" className="btn" style={{ height: 36, fontSize: 13 }} onClick={addManual}>
          + Add entry manually
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 864 }}>
          <div className="table-head" style={{ gridTemplateColumns: gridCols }}>
            {order.map((k, i) => {
              const from = dragging ? order.indexOf(dragging) : -1
              const cls = ['col-handle']
              if (dragging === k) cls.push('dragging')
              if (dragging && dragging !== k && over === k) cls.push(from < i ? 'drop-after' : 'drop-before')
              return (
                <button
                  key={k}
                  type="button"
                  draggable
                  className={cls.join(' ')}
                  style={{ justifyContent: COLS[k].right ? 'flex-end' : 'flex-start' }}
                  title="Drag to reorder"
                  aria-label={`${COLS[k].label} column, position ${i + 1} of ${order.length}. Drag, or press the left and right arrow keys, to move it.`}
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', k)
                    ev.dataTransfer.effectAllowed = 'move'
                    setDragging(k)
                  }}
                  onDragOver={(ev) => {
                    ev.preventDefault()
                    if (over !== k) setOver(k)
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault()
                    if (dragging && from !== i) move(from, i)
                    setDragging(null)
                    setOver(null)
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setOver(null)
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'ArrowLeft' && i > 0) {
                      ev.preventDefault()
                      move(i, i - 1)
                    }
                    if (ev.key === 'ArrowRight' && i < order.length - 1) {
                      ev.preventDefault()
                      move(i, i + 1)
                    }
                  }}
                >
                  <GripIcon />
                  <span>{COLS[k].label}</span>
                </button>
              )
            })}
            <span />
          </div>
          {groups.map((g) => (
            <div key={g.key} role="group" aria-label={g.label}>
              <div className="day-head">
                <span>{g.label}</span>
                <span className="mono">{formatHM(g.total)}</span>
              </div>
              {g.entries.map((e) => (
                <EntryRow key={e.id} entry={e} order={order} gridCols={gridCols} onDelete={() => remove(e)} />
              ))}
            </div>
          ))}
          {finished.length === 0 && (
            <p className="empty" style={{ margin: 0 }}>
              No entries yet. Start the timer or add one manually.
            </p>
          )}
          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
              <button type="button" className="btn sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                Show more
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function EntryRow({ entry, order, gridCols, onDelete }: { entry: Entry; order: ColKey[]; gridCols: string; onDelete(): void }) {
  const { settings, catalog, tagById, projectById, clientById } = useData()
  const toast = useToast()
  const [start, setStart] = useState(toTimeInput(entry.start))
  const [end, setEnd] = useState(toTimeInput(entry.end!))
  // Pick up saved changes, including ones made elsewhere.
  useEffect(() => {
    setStart(toTimeInput(entry.start))
    setEnd(toTimeInput(entry.end!))
  }, [entry.updatedAt, entry.description, entry.start, entry.end])

  const save = async (patch: Parameters<typeof window.api.updateEntry>[1]) => {
    try {
      await window.api.updateEntry(entry.id, patch)
    } catch (err) {
      toast(errorMessage(err), { error: true })
      setStart(toTimeInput(entry.start))
      setEnd(toTimeInput(entry.end!))
    }
  }

  const saveTimes = (nextStart: string, nextEnd: string) => {
    const times = timesFromInputs(entry.start, nextStart, nextEnd)
    if (!times) return
    if (times.start === entry.start && times.end === entry.end) return
    save(times)
  }

  const project = projectById.get(entry.projectId)
  const client = project?.clientId != null ? clientById.get(project.clientId)?.name : 'No client'
  const tags = entry.tagIds.map((id) => tagById.get(id)?.name).filter((n): n is string => !!n)
  const seconds = entrySeconds(entry.start, entry.end)

  const cell = (k: ColKey) => {
    switch (k) {
      case 'time':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <input
              type="time"
              className="inl mono"
              aria-label="Start time"
              value={start}
              style={{ width: 120, flex: 'none', height: 32, padding: '0 4px', fontSize: 13, color: 'var(--text-2)' }}
              onChange={(e) => setStart(e.target.value)}
              onBlur={() => saveTimes(start, end)}
            />
            <span aria-hidden="true" className="muted">
              –
            </span>
            <input
              type="time"
              className="inl mono"
              aria-label="End time"
              value={end}
              style={{ width: 120, flex: 'none', height: 32, padding: '0 4px', fontSize: 13, color: 'var(--text-2)' }}
              onChange={(e) => setEnd(e.target.value)}
              onBlur={() => saveTimes(start, end)}
            />
          </div>
        )
      case 'project':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span className="dot" style={{ background: project?.color ?? 'var(--border)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <ProjectSelect
                className="inl"
                ariaLabel="Project"
                value={entry.projectId}
                style={{ width: '100%', height: 30, padding: '0 4px', fontSize: 14, fontWeight: 600 }}
                onChange={(id) => save({ projectId: id })}
              />
              <div className="muted" style={{ fontSize: 12, paddingLeft: 5 }}>
                {client}
              </div>
            </div>
          </div>
        )
      case 'desc':
        return (
          <div style={{ minWidth: 0 }}>
            <DescriptionField ariaLabel="Description" placeholder="Add a description" value={entry.description} onSave={(description) => save({ description })} />
            <div style={{ paddingLeft: 2 }}>
              <TagInput compact value={tags} onChange={async (names) => save({ tagIds: await tagIdsForNames(names, catalog.tags) })} />
            </div>
          </div>
        )
      case 'dur':
        return (
          <div className="mono" style={{ fontSize: 15, fontWeight: 500 }}>
            {formatHM(roundForSettings(seconds, settings))}
          </div>
        )
    }
  }

  return (
    <div className="table-row" style={{ gridTemplateColumns: gridCols }}>
      {order.map((k) => (
        <div key={k} style={{ minWidth: 0, textAlign: COLS[k].right ? 'right' : 'left' }}>
          {cell(k)}
        </div>
      ))}
      <button type="button" className="icon-btn del" aria-label="Delete entry" title="Delete entry" onClick={onDelete}>
        <TrashIcon />
      </button>
    </div>
  )
}
