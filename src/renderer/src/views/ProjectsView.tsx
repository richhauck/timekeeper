import { useEffect, useMemo, useState } from 'react'
import { projectLabel } from '@shared/reports'
import { roundForSettings } from '@shared/rounding'
import { addMonths, entrySeconds, formatHM, startOfMonth } from '@shared/time'
import type { Entry, Project } from '@shared/types'
import { errorMessage, useData } from '../data'
import { ColorPicker, PRESETS } from '../components/ColorPicker'
import { CloseIcon, PencilIcon } from '../components/Icons'
import { SearchInput } from '../components/SearchInput'
import { useToast } from '../components/Toast'

type Tab = 'projects' | 'clients' | 'tags'

export function ProjectsView() {
  const { catalog, version, settings } = useData()
  const [tab, setTab] = useState<Tab>('projects')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(0)
  const [monthEntries, setMonthEntries] = useState<Entry[]>([])
  const [tagCounts, setTagCounts] = useState<Record<number, number>>({})

  useEffect(() => {
    const from = startOfMonth(new Date())
    const q = { from: from.toISOString(), to: addMonths(from, 1).toISOString() }
    window.api.listEntries(q).then(setMonthEntries)
    window.api.tagUsage(q).then(setTagCounts)
  }, [version])

  const hoursByProject = useMemo(() => {
    const m = new Map<number, number>()
    for (const e of monthEntries) m.set(e.projectId, (m.get(e.projectId) ?? 0) + roundForSettings(entrySeconds(e.start, e.end), settings))
    return m
  }, [monthEntries, settings])

  const tabs: { id: Tab; label: string; count: number; add: string; search: string }[] = [
    { id: 'projects', label: 'Projects', count: catalog.projects.length, add: '+ New project', search: 'Search projects' },
    { id: 'clients', label: 'Clients', count: catalog.clients.length, add: '+ New client', search: 'Search clients' },
    { id: 'tags', label: 'Tags', count: catalog.tags.length, add: '+ New tag', search: 'Search tags' }
  ]
  const current = tabs.find((t) => t.id === tab)!

  return (
    <main className="page" style={{ gap: 16 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="segmented" role="tablist" aria-label="Manage">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id)
                setQuery('')
              }}
            >
              {t.label}
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                ({t.count})
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" style={{ height: 36 }} onClick={() => setAdding((n) => n + 1)}>
          {current.add}
        </button>
      </header>

      {tab === 'projects' && <ProjectsTab query={query} setQuery={setQuery} hours={hoursByProject} addSignal={adding} />}
      {tab === 'clients' && (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder={current.search} />
          <ClientsTab query={query} hours={hoursByProject} addSignal={adding} />
        </>
      )}
      {tab === 'tags' && (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder={current.search} />
          <TagsTab query={query} counts={tagCounts} addSignal={adding} />
        </>
      )}
    </main>
  )
}

// ---------------------------------------------------------------- projects

interface Draft {
  code: string
  name: string
  clientId: number | null
  color: string
}

function ProjectsTab({ query, setQuery, hours, addSignal }: { query: string; setQuery(q: string): void; hours: Map<number, number>; addSignal: number }) {
  const { catalog, clientById } = useData()
  const toast = useToast()
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>({ code: '', name: '', clientId: null, color: PRESETS[0][0] })

  const list = catalog.projects.filter((p) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    const client = p.clientId != null ? clientById.get(p.clientId)?.name ?? '' : ''
    return `${p.code} ${p.name} ${client}`.toLowerCase().includes(q)
  })

  const startNew = () => {
    setSelected('new')
    const used = new Set(catalog.projects.map((p) => p.color))
    setDraft({ code: '', name: '', clientId: null, color: PRESETS.find(([c]) => !used.has(c))?.[0] ?? PRESETS[0][0] })
  }

  useEffect(() => {
    if (addSignal) startNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal])

  // Select the first project, or start a new one when there are none.
  useEffect(() => {
    if (selected === 'new') return
    const p = selected != null ? catalog.projects.find((x) => x.id === selected) : undefined
    if (p) setDraft({ code: p.code, name: p.name, clientId: p.clientId, color: p.color })
    else if (catalog.projects.length) setSelected(catalog.projects[0].id)
    else startNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, catalog.projects])

  const project: Project | undefined = typeof selected === 'number' ? catalog.projects.find((p) => p.id === selected) : undefined
  const dirty = selected === 'new' || (project && (project.code !== draft.code || project.name !== draft.name || project.clientId !== draft.clientId || project.color !== draft.color))

  const save = async () => {
    try {
      if (selected === 'new') {
        const p = await window.api.createProject(draft)
        setSelected(p.id)
        toast(`Created ${projectLabel(p.code, p.name)}`)
      } else if (project) {
        await window.api.updateProject(project.id, draft)
        toast('Project saved')
      }
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const cancel = () => {
    if (project) setDraft({ code: project.code, name: project.name, clientId: project.clientId, color: project.color })
    else if (catalog.projects.length) setSelected(catalog.projects[0].id)
  }

  const archive = async () => {
    if (!project) return
    try {
      await window.api.updateProject(project.id, { archived: !project.archived })
      toast(project.archived ? 'Project restored' : 'Project archived. It stays in reports but leaves the timer.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const remove = async () => {
    if (!project) return
    try {
      if (await window.api.deleteProject(project.id)) {
        setSelected(null)
        toast('Project deleted')
      }
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const cols = 'minmax(0, 1fr) 150px 80px 84px'

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
      <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search projects" />
        <section aria-label="Projects" className="card" style={{ flex: 1, overflow: 'hidden' }}>
          <div className="table-head" style={{ gridTemplateColumns: cols, gap: 12, padding: '8px 16px' }}>
            <span>Project</span>
            <span>Client</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>This month</span>
          </div>
          {selected === 'new' && (
            <button
              type="button"
              className="list-row"
              style={{ gridTemplateColumns: cols }}
              aria-pressed
              aria-label="New project (unsaved)"
              onClick={() => document.getElementById('p-name')?.focus()}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span className="dot" style={{ background: draft.color }} />
                <span className="ellipsis">
                  {draft.code.trim() && <strong style={{ fontWeight: 600 }}>{draft.code} </strong>}
                  {draft.name.trim() ? draft.name : <span className="muted" style={{ fontStyle: 'italic' }}>New project</span>}
                </span>
              </span>
              <span className="ellipsis" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                {draft.clientId != null ? clientById.get(draft.clientId)?.name : 'No client'}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                Unsaved
              </span>
              <span className="mono muted" style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>
                {formatHM(0)}
              </span>
            </button>
          )}
          {list.map((p) => (
            <button key={p.id} type="button" className="list-row" style={{ gridTemplateColumns: cols }} aria-pressed={selected === p.id} onClick={() => setSelected(p.id)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span className="dot" style={{ background: p.color }} />
                <span className="ellipsis">
                  {p.code && <strong style={{ fontWeight: 600 }}>{p.code} </strong>}
                  {p.name}
                </span>
              </span>
              <span className="ellipsis" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                {p.clientId != null ? clientById.get(p.clientId)?.name : 'No client'}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {p.archived ? 'Archived' : 'Active'}
              </span>
              <span className="mono" style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>
                {formatHM(hours.get(p.id) ?? 0)}
              </span>
            </button>
          ))}
          {list.length === 0 && selected !== 'new' && <p className="empty">{catalog.projects.length ? 'No projects match your search.' : 'No projects yet. Create one on the right.'}</p>}
        </section>
      </div>

      <section aria-labelledby="edit-h" className="card" style={{ flex: '1 1 320px', maxWidth: 400, minWidth: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 id="edit-h" style={{ fontSize: 15 }}>
          {selected === 'new' ? 'New project' : 'Edit project'}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 10 }}>
          <div className="field" style={{ gap: 4 }}>
            <label className="label" htmlFor="p-code">
              Code
            </label>
            <input id="p-code" className="input" placeholder="ACM-101" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          </div>
          <div className="field" style={{ gap: 4 }}>
            <label className="label" htmlFor="p-name">
              Name
            </label>
            <input id="p-name" className="input" placeholder="Website redesign" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
        </div>
        <div className="field" style={{ gap: 4 }}>
          <label className="label" htmlFor="p-client">
            Client
          </label>
          <select
            id="p-client"
            className="select"
            value={draft.clientId ?? ''}
            onChange={(e) => setDraft({ ...draft, clientId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">No client</option>
            {catalog.clients
              .filter((c) => !c.archived || c.id === draft.clientId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field" style={{ gap: 8 }}>
          <span className="label">Color</span>
          <ColorPicker value={draft.color} onChange={(color) => setDraft((d) => ({ ...d, color }))} />
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {project && (
              <>
                <button type="button" className="btn link" style={{ height: 36, fontSize: 13 }} onClick={archive}>
                  {project.archived ? 'Restore' : 'Archive'}
                </button>
                <button type="button" className="btn link" style={{ height: 36, fontSize: 13, color: 'var(--danger)' }} onClick={remove}>
                  Delete
                </button>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" style={{ height: 36, fontSize: 13 }} disabled={!dirty || (selected === 'new' && !catalog.projects.length)} onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn primary" style={{ height: 36, fontSize: 13 }} disabled={!dirty || !draft.name.trim()} onClick={save}>
              {selected === 'new' ? 'Create project' : 'Save'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- clients

function ClientsTab({ query, hours, addSignal }: { query: string; hours: Map<number, number>; addSignal: number }) {
  const { catalog } = useData()
  const toast = useToast()
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    if (addSignal) {
      setEditing('new')
      setName('')
    }
  }, [addSignal])

  const list = catalog.clients.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
  const cols = 'minmax(0, 1fr) 110px 100px 220px'

  const commit = async () => {
    try {
      if (editing === 'new') {
        if (name.trim()) await window.api.createClient({ name })
      } else if (editing != null) {
        await window.api.updateClient(editing, { name })
      }
      setEditing(null)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const nameInput = (
    <input
      className="input"
      autoFocus
      aria-label="Client name"
      placeholder="Client name"
      value={name}
      style={{ height: 34 }}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(null)
      }}
    />
  )

  return (
    <section aria-label="Clients" className="card" style={{ overflow: 'hidden' }}>
      <div className="table-head" style={{ gridTemplateColumns: cols, gap: 12, padding: '8px 16px' }}>
        <span>Client</span>
        <span>Projects</span>
        <span style={{ textAlign: 'right' }}>This month</span>
        <span />
      </div>
      {editing === 'new' && (
        <div className="table-row" style={{ gridTemplateColumns: cols, gap: 12, padding: '6px 16px' }}>
          {nameInput}
          <span />
          <span />
          <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="btn sm primary" disabled={!name.trim()} onClick={commit}>
              Add client
            </button>
          </span>
        </div>
      )}
      {list.map((c) => {
        const projects = catalog.projects.filter((p) => p.clientId === c.id)
        const secs = projects.reduce((s, p) => s + (hours.get(p.id) ?? 0), 0)
        return (
          <div key={c.id} className="table-row" style={{ gridTemplateColumns: cols, gap: 12, padding: '6px 16px', minHeight: 46 }}>
            {editing === c.id ? (
              nameInput
            ) : (
              <span className="ellipsis" style={{ fontWeight: 500, color: c.archived ? 'var(--muted)' : undefined }}>
                {c.name}
                {c.archived ? ' (archived)' : ''}
              </span>
            )}
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </span>
            <span className="mono" style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>
              {formatHM(secs)}
            </span>
            <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              {editing === c.id ? (
                <>
                  <button type="button" className="btn sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn sm primary" onClick={commit}>
                    Save
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setEditing(c.id)
                      setName(c.name)
                    }}
                  >
                    Rename
                  </button>
                  <button type="button" className="btn sm" onClick={() => window.api.updateClient(c.id, { archived: !c.archived }).catch((err) => toast(errorMessage(err), { error: true }))}>
                    {c.archived ? 'Restore' : 'Archive'}
                  </button>
                  <button type="button" className="btn sm" style={{ color: 'var(--danger)' }} onClick={() => window.api.deleteClient(c.id).catch((err) => toast(errorMessage(err), { error: true }))}>
                    Delete
                  </button>
                </>
              )}
            </span>
          </div>
        )
      })}
      {list.length === 0 && editing !== 'new' && <p className="empty">{catalog.clients.length ? 'No clients match your search.' : 'No clients yet. Projects can belong to a client.'}</p>}
    </section>
  )
}

// ---------------------------------------------------------------- tags

function TagsTab({ query, counts, addSignal }: { query: string; counts: Record<number, number>; addSignal: number }) {
  const { catalog } = useData()
  const toast = useToast()
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    if (addSignal) {
      setEditing('new')
      setName('')
    }
  }, [addSignal])

  const list = catalog.tags.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()))

  const commit = async () => {
    try {
      if (editing === 'new') {
        if (name.trim()) await window.api.createTag(name)
      } else if (editing != null) {
        await window.api.renameTag(editing, name)
      }
      setEditing(null)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const input = (
    <input
      className="input"
      autoFocus
      aria-label="Tag name"
      placeholder="Tag name"
      value={name}
      style={{ height: 30, width: 160, fontSize: 13 }}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => (name.trim() ? commit() : setEditing(null))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setEditing(null)
      }}
    />
  )

  return (
    <section aria-label="Tags" className="card pad" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {editing === 'new' && input}
        {list.map((t) =>
          editing === t.id ? (
            <span key={t.id}>{input}</span>
          ) : (
            <span key={t.id} className="chip" style={{ height: 30, paddingRight: 4 }}>
              {t.name} <span className="muted">{counts[t.id] ?? 0}</span>
              <button
                type="button"
                aria-label={`Rename tag ${t.name}`}
                onClick={() => {
                  setEditing(t.id)
                  setName(t.name)
                }}
              >
                <PencilIcon />
              </button>
              <button type="button" aria-label={`Delete tag ${t.name}`} onClick={() => window.api.deleteTag(t.id).catch((err) => toast(errorMessage(err), { error: true }))}>
                <CloseIcon size={10} />
              </button>
            </span>
          )
        )}
        {list.length === 0 && editing !== 'new' && <span className="muted">{catalog.tags.length ? 'No tags match your search.' : 'No tags yet. Add them from the timer or here.'}</span>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Numbers show entries this month. Renaming a tag updates every past entry.
      </p>
    </section>
  )
}
