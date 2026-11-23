import fs from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import { markdownToPlain } from '@shared/markdown'
import { projectLabel } from '@shared/reports'
import { entrySeconds, formatClock } from '@shared/time'
import type { AppInfo, Entry, ExportRequest, IdleChoice, IdlePrompt, Settings } from '@shared/types'
import { Store, UserError } from './db'
import { buildWorkbook, exportRange, selectExportEntries } from './export'
import { IdleMonitor } from './idle'
import { applyIdleChoice, lastSeenForRecovery, recordHeartbeat } from './session'

const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

let store: Store
let settings: Settings
let mainWindow: BrowserWindow | null = null
let promptWindow: BrowserWindow | null = null
let tray: Tray | null = null
let idle: IdleMonitor
let idleNotification: Notification | null = null
let quitting = false
/** Repeating timers, stopped on quit so none of them touches the closed database. */
const timers: ReturnType<typeof setInterval>[] = []
const every = (ms: number, fn: () => void): void => {
  timers.push(setInterval(fn, ms))
}
let trayHintShown = false

/**
 * Controls for end-to-end tests, present only when TIMEKEEPER_E2E is set.
 * Tests reach them through Playwright's app.evaluate() as
 * globalThis.__timekeeperTest. They fake the system idle time, run an idle
 * check on demand, move the idle monitor's clock forward (for sleep), and
 * record notifications instead of showing them.
 */
export interface TestHooks {
  idleSeconds: number | null
  clockOffsetMs: number
  notifications: { title: string; body: string }[]
  tickIdle(): void
}
const testHooks: TestHooks | null = process.env.TIMEKEEPER_E2E
  ? { idleSeconds: null, clockOffsetMs: 0, notifications: [], tickIdle: () => idle.tick() }
  : null
if (testHooks) Object.assign(globalThis, { __timekeeperTest: testHooks })

const appRoot = (): string => app.getAppPath()
const resource = (name: string): string => path.join(appRoot(), 'resources', name)

// ---------------------------------------------------------------- startup

// Tests run each app instance with its own data folder. The single-instance
// lock is tied to this folder, so test runs don't collide with each other or
// with a copy of the app you have open.
if (process.env.TIMEKEEPER_USER_DATA) app.setPath('userData', process.env.TIMEKEEPER_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox('Timekeeper could not start', String(err?.stack ?? err))
    app.exit(1)
  })
}

async function start(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId('com.timekeeper.app')

  const dbFile = process.env.TIMEKEEPER_DB ?? path.join(app.getPath('userData'), 'timekeeper.db')
  store = await Store.open(dbFile, path.join(appRoot(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'))
  settings = store.getSettings()
  applySettings(settings)

  // A timer may have been running when the app closed or crashed. Read the
  // last heartbeat before the new heartbeat below overwrites it.
  const lastSeen = lastSeenForRecovery(store)

  registerIpc()
  setupIdle()
  createTray()
  createMainWindow()
  startHeartbeat()

  if (lastSeen) idle.recoverFromGap(lastSeen)
}

app.on('before-quit', () => {
  quitting = true
  // A tick between closing the database and the process exiting would throw,
  // and Electron's error dialog for that keeps the app from quitting.
  for (const t of timers.splice(0)) clearInterval(t)
  // Quitting with the idle prompt open counts as Keep, as closing it does.
  // Answer it now, while the database is still open.
  if (store && idle?.currentPrompt) resolveIdle('keep')
  if (store) {
    recordHeartbeat(store)
    store.close()
  }
})

app.on('window-all-closed', () => {
  // Keep running in the tray; quitting happens from the tray or app menu.
  if (!tray) app.quit()
})

app.on('activate', () => showMainWindow())

// ---------------------------------------------------------------- windows

function preloadPath(): string {
  return path.join(__dirname, '../preload/index.js')
}

function loadRenderer(win: BrowserWindow, hash = ''): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) win.loadURL(devUrl + (hash ? `#${hash}` : ''))
  else win.loadFile(path.join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: 'Timekeeper',
    icon: resource('icon.png'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171C' : '#F4F5F7',
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow?.show()
  })
  mainWindow.on('close', (e) => {
    if (quitting || !tray) return
    e.preventDefault()
    mainWindow?.hide()
    if (!trayHintShown && !isMac && Notification.isSupported()) {
      trayHintShown = true
      new Notification({ title: 'Timekeeper is still running', body: 'Open it again from the tray icon. Quit from the tray menu.' }).show()
    }
  })
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(mainWindow)
}

function showMainWindow(): void {
  if (!mainWindow) createMainWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

function openPromptWindow(): void {
  if (promptWindow) {
    promptWindow.show()
    promptWindow.focus()
    return
  }
  promptWindow = new BrowserWindow({
    width: 480,
    height: 470,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    title: 'Welcome back',
    icon: resource('icon.png'),
    autoHideMenuBar: true,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C2027' : '#FFFFFF',
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  promptWindow.setAlwaysOnTop(true, 'floating')
  if (isMac) promptWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  promptWindow.once('ready-to-show', () => {
    promptWindow?.show()
    promptWindow?.focus()
  })
  promptWindow.on('closed', () => {
    promptWindow = null
    // Closing the prompt without choosing keeps the idle time.
    if (idle.currentPrompt && !quitting) resolveIdle('keep')
  })
  loadRenderer(promptWindow, '/idle')
}

function closePromptWindow(): void {
  const w = promptWindow
  promptWindow = null
  w?.destroy()
}

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

function dataChanged(): void {
  broadcast('data-changed')
  updateTray()
}

// ---------------------------------------------------------------- settings

function applySettings(s: Settings): void {
  nativeTheme.themeSource = s.theme
  if (!isLinux) {
    try {
      app.setLoginItemSettings({ openAtLogin: s.openAtLogin, args: ['--hidden'] })
    } catch {
      /* not supported here */
    }
  }
}

// ---------------------------------------------------------------- idle

function describeEntry(e: Entry): { label: string; color: string } {
  try {
    const p = store.project(e.projectId)
    return { label: projectLabel(p.code, p.name), color: p.color }
  } catch {
    return { label: 'Deleted project', color: '#8A94A3' }
  }
}

function idleDetectionAvailable(): { ok: boolean; note?: string } {
  if (isLinux && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)) {
    return {
      ok: false,
      note: "This desktop uses Wayland, which may not report idle time to apps. Idle detection might not work here; sleep and screen lock are still detected."
    }
  }
  return { ok: true }
}

function setupIdle(): void {
  idle = new IdleMonitor({
    getIdleSeconds: () => testHooks?.idleSeconds ?? powerMonitor.getSystemIdleTime(),
    getRunning: () => store.getRunning(),
    getSettings: () => settings,
    describeEntry,
    onIdle: ({ idleMinutes, label }) => showIdleNotification(idleMinutes, label),
    onReturn: (prompt) => {
      idleNotification?.close()
      broadcast('idle-prompt', prompt)
      openPromptWindow()
    },
    onCleared: () => {
      // Nothing left to decide (answered, timer stopped, or not asking):
      // close the prompt and the "still counting" notification.
      broadcast('idle-prompt', null)
      closePromptWindow()
      idleNotification?.close()
      idleNotification = null
    },
    now: () => Date.now() + (testHooks?.clockOffsetMs ?? 0)
  })

  let n = 0
  every(2000, () => {
    n += 1
    // Every 15 seconds normally; every 2 seconds while waiting for the user to come back.
    if (idle.watchingForReturn || n % 7 === 0) idle.tick()
  })

  powerMonitor.on('suspend', () => idle.suspend())
  powerMonitor.on('lock-screen', () => idle.suspend())
  powerMonitor.on('resume', () => idle.resume())
  powerMonitor.on('unlock-screen', () => idle.resume())
}

function showIdleNotification(minutes: number, label: string): void {
  const title = `You've been idle for ${minutes} minute${minutes === 1 ? '' : 's'}`
  const body = `Your timer for ${label} is still counting this time.`
  if (testHooks) {
    testHooks.notifications.push({ title, body })
    return
  }
  if (!Notification.isSupported()) return
  idleNotification?.close()
  const n = new Notification({
    title,
    body,
    // Action buttons are shown by macOS. On Windows and Linux, clicking the
    // notification opens the prompt window instead.
    actions: isMac
      ? [
          { type: 'button', text: 'Keep' },
          { type: 'button', text: 'Discard' },
          { type: 'button', text: 'Discard and stop' }
        ]
      : [],
    closeButtonText: 'Later',
    timeoutType: 'never'
  })
  n.on('action', (_e, index) => {
    const choice: IdleChoice = index === 0 ? 'keep' : index === 1 ? 'discard' : 'discard-stop'
    idle.forceReturn()
    if (idle.currentPrompt) resolveIdle(choice)
  })
  n.on('click', () => {
    idle.forceReturn()
    if (idle.currentPrompt) {
      broadcast('idle-prompt', idle.currentPrompt)
      openPromptWindow()
    } else {
      showMainWindow()
    }
  })
  n.show()
  idleNotification = n
}

function resolveIdle(choice: IdleChoice): void {
  const prompt = idle.takePrompt()
  closePromptWindow()
  idleNotification?.close()
  idleNotification = null
  if (!prompt) return
  applyIdleChoice(store, choice, prompt)
  dataChanged()
}

function startHeartbeat(): void {
  const beat = (): void => recordHeartbeat(store)
  beat()
  every(30_000, beat)
}

// ---------------------------------------------------------------- tray

function createTray(): void {
  try {
    const image = isMac ? nativeImage.createFromPath(resource('trayTemplate.png')) : nativeImage.createFromPath(resource('tray.png'))
    if (isMac) image.setTemplateImage(true)
    tray = new Tray(image)
    tray.setToolTip('Timekeeper')
    tray.on('click', () => {
      if (!isMac) showMainWindow()
    })
    updateTray()
    every(1000, updateTrayClock)
  } catch {
    tray = null
  }
}

function updateTrayClock(): void {
  if (!tray) return
  const running = store.getRunning()
  const text = running ? formatClock(entrySeconds(running.start, null)) : ''
  if (isMac) tray.setTitle(running ? ` ${text.slice(0, 5)}` : '')
  tray.setToolTip(running ? `Timekeeper: ${describeEntry(running).label} · ${text}` : 'Timekeeper: no timer running')
}

let trayRunningState: boolean | null = null

function updateTray(): void {
  if (!tray) return
  const running = store.getRunning()
  if (!isMac && trayRunningState !== !!running) {
    trayRunningState = !!running
    tray.setImage(nativeImage.createFromPath(resource(running ? 'tray-running.png' : 'tray.png')))
  }
  const catalog = store.getCatalog()
  const active = catalog.projects.filter((p) => !p.archived)
  const template: MenuItemConstructorOptions[] = []
  if (running) {
    template.push({ label: `Tracking ${describeEntry(running).label}`, enabled: false })
    const desc = markdownToPlain(running.description)
    if (desc) template.push({ label: desc.length > 60 ? `${desc.slice(0, 59)}…` : desc, enabled: false })
    template.push({
      label: 'Stop timer',
      click: () => {
        store.stopTimer()
        dataChanged()
      }
    })
  } else {
    template.push({ label: 'No timer running', enabled: false })
  }
  template.push({
    label: running ? 'Switch to project' : 'Start timer on',
    enabled: active.length > 0,
    submenu: active.map((p) => ({
      label: projectLabel(p.code, p.name),
      click: () => {
        store.startTimer({ projectId: p.id, description: running?.projectId === p.id ? running.description : '', tagIds: [] })
        dataChanged()
      }
    }))
  })
  template.push({ type: 'separator' }, { label: 'Open Timekeeper', click: () => showMainWindow() }, { type: 'separator' })
  template.push({
    label: 'Quit Timekeeper',
    click: () => {
      quitting = true
      app.quit()
    }
  })
  tray.setContextMenu(Menu.buildFromTemplate(template))
  updateTrayClock()
}

// ---------------------------------------------------------------- IPC

type Handler = (...args: never[]) => unknown

function handle(channel: string, fn: Handler, changes = false): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      const value = await (fn as (...a: unknown[]) => unknown)(...args)
      if (changes) dataChanged()
      return { ok: true, value }
    } catch (err) {
      const message = err instanceof UserError ? err.message : `Something went wrong: ${err instanceof Error ? err.message : String(err)}`
      if (!(err instanceof UserError)) console.error(err)
      return { ok: false, error: message }
    }
  })
}

async function confirm(message: string, detail: string, action: string): Promise<boolean> {
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
  const opts = { type: 'warning' as const, buttons: [action, 'Cancel'], defaultId: 1, cancelId: 1, message, detail }
  const res = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts)
  return res.response === 0
}

function registerIpc(): void {
  handle('getCatalog', () => store.getCatalog())
  handle('getSettings', () => settings)
  handle('updateSettings', (patch: Partial<Settings>) => {
    settings = store.updateSettings(patch)
    applySettings(settings)
    return settings
  }, true)
  handle('getAppInfo', (): AppInfo => {
    const avail = idleDetectionAvailable()
    return { dbPath: store.path, platform: process.platform, idleDetectionAvailable: avail.ok, idleNote: avail.note, version: app.getVersion() }
  })

  handle('createClient', (input: { name: string }) => store.createClient(input), true)
  handle('updateClient', (id: number, patch: { name?: string; archived?: boolean }) => store.updateClient(id, patch), true)
  handle('deleteClient', async (id: number) => {
    const n = store.countClientProjects(id)
    if (n > 0) {
      const ok = await confirm('Delete this client?', `${n} project${n === 1 ? '' : 's'} will be kept and left without a client.`, 'Delete client')
      if (!ok) return false
    }
    return store.deleteClient(id)
  }, true)

  handle('createProject', (input) => store.createProject(input as never), true)
  handle('updateProject', (id: number, patch) => store.updateProject(id, patch as never), true)
  handle('deleteProject', async (id: number) => {
    const n = store.countProjectEntries(id)
    if (n > 0) {
      const ok = await confirm(
        'Delete this project and its time?',
        `${n} time entr${n === 1 ? 'y' : 'ies'} will be deleted too. This can't be undone. To hide the project but keep its time, archive it instead.`,
        'Delete project'
      )
      if (!ok) return false
    }
    return store.deleteProject(id)
  }, true)

  handle('createTag', (name: string) => store.createTag(name), true)
  handle('renameTag', (id: number, name: string) => store.renameTag(id, name), true)
  handle('deleteTag', async (id: number) => {
    const n = store.countTagEntries(id)
    if (n > 0) {
      const ok = await confirm('Delete this tag?', `It will be removed from ${n} entr${n === 1 ? 'y' : 'ies'}. The entries themselves stay.`, 'Delete tag')
      if (!ok) return false
    }
    return store.deleteTag(id)
  }, true)

  handle('listEntries', (q) => store.listEntries(q as never))
  handle('tagUsage', (q) => store.tagUsage(q as never))
  handle('getRunning', () => store.getRunning())
  handle('startTimer', (input) => {
    idle.reset()
    const e = store.startTimer(input as never)
    store.setMeta('lastSeen', String(Date.now()))
    return e
  }, true)
  handle('stopTimer', () => {
    idle.reset()
    return store.stopTimer()
  }, true)
  handle('updateRunning', (patch: { projectId?: number; description?: string; tagIds?: number[] }) => {
    const running = store.getRunning()
    return running ? store.updateEntry(running.id, patch) : null
  }, true)
  handle('createEntry', (input) => store.createEntry(input as never), true)
  handle('updateEntry', (id: number, patch) => store.updateEntry(id, patch as never), true)
  handle('deleteEntry', (id: number) => store.deleteEntry(id), true)
  handle('restoreEntry', (entry: Entry) => store.restoreEntry(entry), true)

  handle('previewExport', (req: ExportRequest) => {
    const entries = selectExportEntries(store.listEntriesStartingIn(exportRange(req)), store.getCatalog(), req)
    return { rows: entries.length, entries }
  })
  handle('exportExcel', async (req: ExportRequest) => {
    const catalog = store.getCatalog()
    const entries = selectExportEntries(store.listEntriesStartingIn(exportRange(req)), catalog, req)
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow
    const opts = {
      title: 'Export timesheet',
      defaultPath: path.join(app.getPath('documents'), `Timesheet ${req.from} to ${req.to}.xlsx`),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    }
    const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { saved: false }
    const file = res.filePath.toLowerCase().endsWith('.xlsx') ? res.filePath : `${res.filePath}.xlsx`
    await buildWorkbook(entries, catalog, settings, req).xlsx.writeFile(file)
    shell.showItemInFolder(file)
    return { saved: true, path: file, rows: entries.length }
  })
  handle('backupDatabase', async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow
    const opts = { title: 'Back up database', defaultPath: path.join(app.getPath('documents'), `timekeeper-backup-${stamp}.db`) }
    const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { saved: false }
    store.backupTo(res.filePath)
    return { saved: true, path: res.filePath }
  })
  handle('showDatabaseInFolder', () => {
    if (fs.existsSync(store.path)) shell.showItemInFolder(store.path)
  })

  handle('getIdlePrompt', (): IdlePrompt | null => idle.currentPrompt)
  handle('resolveIdle', (choice: IdleChoice) => resolveIdle(choice))
}
