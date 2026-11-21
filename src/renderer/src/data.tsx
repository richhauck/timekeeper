import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { projectLabel } from '@shared/reports'
import { DEFAULT_SETTINGS, type Catalog, type Client, type Entry, type Project, type Settings, type Tag } from '@shared/types'

interface DataState {
  ready: boolean
  catalog: Catalog
  settings: Settings
  running: Entry | null
  /** Increments whenever the main process reports a change; views refetch on it. */
  version: number
  refresh(): Promise<void>
  projectById: Map<number, Project>
  clientById: Map<number, Client>
  tagById: Map<number, Tag>
  labelFor(projectId: number): string
}

const Ctx = createContext<DataState | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [catalog, setCatalog] = useState<Catalog>({ clients: [], projects: [], tags: [] })
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [running, setRunning] = useState<Entry | null>(null)
  const [version, setVersion] = useState(0)

  const refresh = useCallback(async () => {
    const [c, s, r] = await Promise.all([window.api.getCatalog(), window.api.getSettings(), window.api.getRunning()])
    setCatalog(c)
    setSettings(s)
    setRunning(r)
    setVersion((v) => v + 1)
    setReady(true)
  }, [])

  useEffect(() => {
    refresh()
    return window.api.onDataChanged(() => {
      refresh()
    })
  }, [refresh])

  const value = useMemo<DataState>(() => {
    const projectById = new Map(catalog.projects.map((p) => [p.id, p]))
    return {
      ready,
      catalog,
      settings,
      running,
      version,
      refresh,
      projectById,
      clientById: new Map(catalog.clients.map((c) => [c.id, c])),
      tagById: new Map(catalog.tags.map((t) => [t.id, t])),
      labelFor: (id) => {
        const p = projectById.get(id)
        return p ? projectLabel(p.code, p.name) : 'Deleted project'
      }
    }
  }, [ready, catalog, settings, running, version, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}

/** Re-render every `ms` milliseconds (for running clocks). */
export function useNow(ms = 1000, active = true): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms, active])
  return now
}

/** Turn tag names into ids, creating tags that don't exist yet. */
export async function tagIdsForNames(names: string[], tags: Tag[]): Promise<number[]> {
  const ids: number[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
    ids.push(existing ? existing.id : (await window.api.createTag(name)).id)
  }
  return [...new Set(ids)]
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
