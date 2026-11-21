import { contextBridge, ipcRenderer } from 'electron'
import type { Api, IdlePrompt } from '@shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; value: T } | { ok: false; error: string }
  if (!res.ok) throw new Error(res.error)
  return res.value
}

const methods = [
  'getCatalog', 'getSettings', 'updateSettings', 'getAppInfo',
  'createClient', 'updateClient', 'deleteClient',
  'createProject', 'updateProject', 'deleteProject',
  'createTag', 'renameTag', 'deleteTag',
  'listEntries', 'getRunning', 'startTimer', 'stopTimer', 'updateRunning',
  'createEntry', 'updateEntry', 'deleteEntry', 'restoreEntry', 'tagUsage',
  'exportExcel', 'previewExport', 'backupDatabase', 'showDatabaseInFolder',
  'getIdlePrompt', 'resolveIdle'
] as const

const api = Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => call(m, ...args)])) as unknown as Api

api.onDataChanged = (listener) => {
  const fn = (): void => listener()
  ipcRenderer.on('data-changed', fn)
  return () => ipcRenderer.removeListener('data-changed', fn)
}

api.onIdlePrompt = (listener) => {
  const fn = (_e: unknown, prompt: IdlePrompt | null): void => listener(prompt)
  ipcRenderer.on('idle-prompt', fn)
  return () => ipcRenderer.removeListener('idle-prompt', fn)
}

contextBridge.exposeInMainWorld('api', api)
