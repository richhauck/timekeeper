export type RoundingMode = 'nearest' | 'up' | 'down'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  /** Rounding increment in minutes. 0 turns rounding off. */
  roundingMinutes: number
  roundingMode: RoundingMode
  idleThresholdMinutes: number
  sleepCountsAsIdle: boolean
  askOnReturn: boolean
  theme: Theme
  openAtLogin: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  roundingMinutes: 15,
  roundingMode: 'nearest',
  idleThresholdMinutes: 5,
  sleepCountsAsIdle: true,
  askOnReturn: true,
  theme: 'system',
  openAtLogin: false
}

export const ROUNDING_OPTIONS = [0, 1, 5, 6, 10, 15, 30] as const

export interface Client {
  id: number
  name: string
  archived: boolean
  createdAt: string
}

export interface Project {
  id: number
  clientId: number | null
  /** Short project code, e.g. ACM-101. May be empty. */
  code: string
  name: string
  /** Hex color, e.g. #12877A */
  color: string
  archived: boolean
  createdAt: string
}

export interface Tag {
  id: number
  name: string
  createdAt: string
}

export interface Entry {
  id: number
  projectId: number
  description: string
  /** ISO 8601 timestamp in UTC */
  start: string
  /** ISO 8601 timestamp in UTC; null while the timer is running */
  end: string | null
  /** Idle seconds the user chose to keep inside this entry */
  idleSeconds: number
  tagIds: number[]
  createdAt: string
  updatedAt: string
}

export interface EntryInput {
  projectId: number
  description: string
  start: string
  end: string | null
  tagIds: number[]
}

export interface ClientInput {
  name: string
}

export interface ProjectInput {
  clientId: number | null
  code: string
  name: string
  color: string
}

export interface Catalog {
  clients: Client[]
  projects: Project[]
  tags: Tag[]
}

export interface EntryQuery {
  /** Inclusive lower bound, ISO UTC. Entries that end after this are included. */
  from: string
  /** Exclusive upper bound, ISO UTC. Entries that start before this are included. */
  to: string
}

export type IdleChoice = 'keep' | 'discard' | 'discard-stop'

export interface IdlePrompt {
  entryId: number
  /** When the user went idle, ISO UTC */
  idleSince: string
  /** When the user came back, ISO UTC */
  returnedAt: string
  projectLabel: string
  projectColor: string
  description: string
}

export interface ExportRequest {
  /** Local date YYYY-MM-DD, inclusive */
  from: string
  /** Local date YYYY-MM-DD, inclusive */
  to: string
  clientIds: number[]
  projectIds: number[]
  tagIds: number[]
  text: string
  includeEntries: boolean
  includeSummary: boolean
}

export interface ExportResult {
  saved: boolean
  path?: string
  rows?: number
}

export interface AppInfo {
  dbPath: string
  platform: string
  idleDetectionAvailable: boolean
  idleNote?: string
  version: string
}

/** The API the preload script exposes to the renderer as window.api. */
export interface Api {
  getCatalog(): Promise<Catalog>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  getAppInfo(): Promise<AppInfo>

  createClient(input: ClientInput): Promise<Client>
  updateClient(id: number, patch: Partial<ClientInput & { archived: boolean }>): Promise<Client>
  deleteClient(id: number): Promise<boolean>

  createProject(input: ProjectInput): Promise<Project>
  updateProject(id: number, patch: Partial<ProjectInput & { archived: boolean }>): Promise<Project>
  deleteProject(id: number): Promise<boolean>

  createTag(name: string): Promise<Tag>
  renameTag(id: number, name: string): Promise<Tag>
  deleteTag(id: number): Promise<boolean>

  listEntries(query: EntryQuery): Promise<Entry[]>
  getRunning(): Promise<Entry | null>
  startTimer(input: { projectId: number; description: string; tagIds: number[] }): Promise<Entry>
  stopTimer(): Promise<Entry | null>
  updateRunning(patch: { projectId?: number; description?: string; tagIds?: number[] }): Promise<Entry | null>
  createEntry(input: EntryInput): Promise<Entry>
  updateEntry(id: number, patch: Partial<EntryInput>): Promise<Entry>
  deleteEntry(id: number): Promise<Entry | null>
  restoreEntry(entry: Entry): Promise<Entry>
  tagUsage(query: EntryQuery): Promise<Record<number, number>>

  exportExcel(request: ExportRequest): Promise<ExportResult>
  previewExport(request: ExportRequest): Promise<{ rows: number; entries: Entry[] }>
  backupDatabase(): Promise<{ saved: boolean; path?: string }>
  showDatabaseInFolder(): Promise<void>

  getIdlePrompt(): Promise<IdlePrompt | null>
  resolveIdle(choice: IdleChoice): Promise<void>

  onDataChanged(listener: () => void): () => void
  onIdlePrompt(listener: (prompt: IdlePrompt | null) => void): () => void
}
