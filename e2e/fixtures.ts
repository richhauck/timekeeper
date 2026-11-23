/// <reference lib="dom" />
// page.evaluate callbacks run in the renderer, so these files need browser types.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from '@playwright/test'
import type { Api } from '../src/shared/types'

const ROOT = path.resolve(__dirname, '..')

export interface RunningApp {
  app: ElectronApplication
  page: Page
}

interface Fixtures {
  /** A temp folder holding this test's database and app data. */
  dataDir: string
  /** Launch (or relaunch) the app against `dataDir`. */
  launch(): Promise<RunningApp>
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  dataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timekeeper-e2e-'))
    await use(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  },

  launch: async ({ dataDir }, use) => {
    const open: ElectronApplication[] = []
    await use(async () => {
      const env: Record<string, string> = {}
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
      // Some shells (and editor terminals) set this, which makes Electron act like plain Node.
      delete env.ELECTRON_RUN_AS_NODE
      // Always load the built renderer, never a dev server.
      delete env.ELECTRON_RENDERER_URL
      env.TIMEKEEPER_DB = path.join(dataDir, 'timekeeper.db')
      env.TIMEKEEPER_USER_DATA = path.join(dataDir, 'userData')

      const app = await electron.launch({ args: [ROOT], cwd: ROOT, env })
      open.push(app)
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
      return { app, page }
    })
    for (const app of open) await quit(app)
  }
})

export { expect }

/**
 * Quit the app the way the tray's Quit does. Closing the window alone only
 * hides it to the tray, so the process would never exit. Falls back to
 * killing the process if it doesn't exit in time.
 */
const quitted = new WeakSet<ElectronApplication>()

export async function quit(app: ElectronApplication): Promise<void> {
  if (quitted.has(app)) return
  quitted.add(app)
  const proc = app.process()
  if (proc.exitCode !== null) return
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  const done = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5_000))])
  if (!done) {
    console.warn(`[e2e] app did not exit after quit(); killing it (${base.info().title})`)
    proc.kill('SIGKILL')
  }
  await app.close().catch(() => {})
}

/** Seed a client-free project through the app's own API and return its id. */
export async function seedProject(t: RunningApp, code = 'ACM-101', name = 'Website redesign'): Promise<number> {
  return t.page.evaluate(
    async ([code, name]) => (await (window as unknown as { api: Api }).api.createProject({ clientId: null, code, name, color: '#12877A' })).id,
    [code, name] as const
  )
}

/** Local time today at hh:mm, as an ISO string. */
export function todayAt(hh: number, mm: number): string {
  const d = new Date()
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}

export function nav(page: Page, name: 'Timer' | 'Reports' | 'Projects' | 'Settings') {
  return page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true })
}

/**
 * A small, known data set in the current month (days 1 and 2), with the
 * default rounding of 15 minutes to the nearest:
 *
 *   Day 1  09:00-10:32  ACM-101 Website redesign (Acme Co.)  design           1:32 -> 1:30
 *   Day 1  11:00-12:08  ACM-101 Website redesign (Acme Co.)  design, meeting  1:08 -> 1:15
 *   Day 2  09:00-09:23  Internal (no client)                 meeting          0:23 -> 0:30
 *
 * Totals: 3:15 over 3 entries. Acme 2:45, no client 0:30. design 2:45, meeting 1:45.
 */
export async function seedSample(t: RunningApp): Promise<void> {
  const now = new Date()
  const day = (d: number, h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), d, h, m).toISOString()
  await t.page.evaluate(async (times) => {
    const api = (window as unknown as { api: Api }).api
    const acme = await api.createClient({ name: 'Acme Co.' })
    const site = await api.createProject({ clientId: acme.id, code: 'ACM-101', name: 'Website redesign', color: '#12877A' })
    const internal = await api.createProject({ clientId: null, code: '', name: 'Internal', color: '#B7860B' })
    const design = await api.createTag('design')
    const meeting = await api.createTag('meeting')
    await api.createEntry({ projectId: site.id, description: '**Wireframes** for pricing', start: times[0], end: times[1], tagIds: [design.id] })
    await api.createEntry({ projectId: site.id, description: 'Design review', start: times[2], end: times[3], tagIds: [design.id, meeting.id] })
    await api.createEntry({ projectId: internal.id, description: 'Inbox', start: times[4], end: times[5], tagIds: [meeting.id] })
  }, [day(1, 9, 0), day(1, 10, 32), day(1, 11, 0), day(1, 12, 8), day(2, 9, 0), day(2, 9, 23)])
}

/** YYYY-MM-DD for a day of the current month. */
export function thisMonthKey(d: number): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function lastDayOfThisMonth(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
}
