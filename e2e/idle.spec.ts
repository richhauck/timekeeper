/// <reference lib="dom" />
// page.evaluate callbacks run in the renderer, so these files need browser types.
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs from 'sql.js'
import type { ElectronApplication, Page } from '@playwright/test'
import type { Api, Entry, Settings } from '../src/shared/types'
import type { TestHooks } from '../src/main/index'
import { expect, nav, quit, seedProject, test, type RunningApp } from './fixtures'

type WithApi = { api: Api }
const MIN = 60_000

// ---------------------------------------------------------------- helpers

/** Change the app's test controls in the main process. */
function hooks(app: ElectronApplication, patch: Partial<Pick<TestHooks, 'idleSeconds' | 'clockOffsetMs'>>, tick = false): Promise<void> {
  return app.evaluate((_electron, [patch, tick]) => {
    const h = (globalThis as unknown as { __timekeeperTest: TestHooks }).__timekeeperTest
    Object.assign(h, patch)
    if (tick) h.tickIdle()
  }, [patch, tick] as const)
}

function notifications(app: ElectronApplication): Promise<{ title: string; body: string }[]> {
  return app.evaluate(() => (globalThis as unknown as { __timekeeperTest: TestHooks }).__timekeeperTest.notifications)
}

function powerEvent(app: ElectronApplication, event: 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen'): Promise<void> {
  return app.evaluate(({ powerMonitor }, event) => {
    powerMonitor.emit(event)
  }, event)
}

/** The system reports `seconds` of idle time, and the app checks. */
const goIdle = (app: ElectronApplication, seconds: number) => hooks(app, { idleSeconds: seconds }, true)
/** The user is active again, and the app checks. */
const comeBack = (app: ElectronApplication) => hooks(app, { idleSeconds: 0 }, true)

/** The "Welcome back" prompt window, once it is open. */
async function promptWindow(app: ElectronApplication): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(() => (found = app.windows().find((w) => !w.isClosed() && w.url().includes('#/idle'))), { message: 'idle prompt window to open' })
    .toBeTruthy()
  await found!.getByRole('heading', { name: /You were away/ }).waitFor()
  return found!
}

async function expectNoPromptWindow(app: ElectronApplication): Promise<void> {
  // Give the app a moment to (wrongly) open one.
  await new Promise((r) => setTimeout(r, 400))
  expect(app.windows().filter((w) => !w.isClosed() && w.url().includes('#/idle'))).toHaveLength(0)
}

/** A running timer that started `minutesAgo`, with a description and a tag. */
async function startRunning(t: RunningApp, minutesAgo: number): Promise<Entry> {
  const projectId = await seedProject(t)
  const entry = await t.page.evaluate(
    async ([projectId, start]) => {
      const api = (window as unknown as WithApi).api
      const tag = await api.createTag('design')
      return api.createEntry({ projectId, description: 'Wireframes', start, end: null, tagIds: [tag.id] })
    },
    [projectId, new Date(Date.now() - minutesAgo * MIN).toISOString()] as const
  )
  await nav(t.page, 'Timer').click()
  await expect(t.page.getByRole('region', { name: 'Timer' }).getByRole('button', { name: 'Stop' })).toBeVisible()
  return entry
}

const allEntries = (page: Page): Promise<Entry[]> =>
  page.evaluate(() => (window as unknown as WithApi).api.listEntries({ from: new Date(0).toISOString(), to: '9999-12-31T00:00:00.000Z' }))
const running = (page: Page): Promise<Entry | null> => page.evaluate(() => (window as unknown as WithApi).api.getRunning())
const updateSettings = (page: Page, patch: Partial<Settings>) => page.evaluate((patch) => (window as unknown as WithApi).api.updateSettings(patch), patch)

/** Assert a timestamp is within a few seconds of `msAgo` before now. */
function expectAgo(iso: string | null, msAgo: number): void {
  expect(iso).not.toBeNull()
  expect(Math.abs(Date.now() - msAgo - Date.parse(iso!))).toBeLessThan(10_000)
}

// ---------------------------------------------------------------- idle while the timer runs

test('notifies after the threshold, then asks on return; Discard trims and keeps the timer running', async ({ launch }) => {
  const t = await launch()
  const entry = await startRunning(t, 30)

  // Below the 5-minute default threshold: nothing happens.
  await goIdle(t.app, 4 * 60)
  expect(await notifications(t.app)).toEqual([])

  await goIdle(t.app, 10 * 60)
  expect(await notifications(t.app)).toEqual([
    { title: "You've been idle for 10 minutes", body: 'Your timer for ACM-101 Website redesign is still counting this time.' }
  ])

  await comeBack(t.app)
  const prompt = await promptWindow(t.app)
  await expect(prompt.getByRole('heading')).toHaveText('You were away for 10 minutes')
  await expect(prompt.getByText('ACM-101 Website redesign · Wireframes')).toBeVisible()

  await prompt.getByRole('button', { name: /Discard idle time/ }).click()
  await expect.poll(() => prompt.isClosed()).toBe(true)

  // The old entry ends when idle began; an identical one runs from now.
  const [now, before] = await allEntries(t.page)
  expect(before).toMatchObject({ id: entry.id, description: 'Wireframes', tagIds: entry.tagIds })
  expectAgo(before.end, 10 * MIN)
  expect(now).toMatchObject({ end: null, description: 'Wireframes', projectId: entry.projectId, tagIds: entry.tagIds })
  expectAgo(now.start, 0)
  await expect(t.page.getByRole('region', { name: 'Timer' }).getByRole('button', { name: 'Stop' })).toBeVisible()
})

test('Keep counts the idle time and changes nothing else', async ({ launch }) => {
  const t = await launch()
  const entry = await startRunning(t, 30)
  await goIdle(t.app, 10 * 60)
  await comeBack(t.app)
  const prompt = await promptWindow(t.app)
  await prompt.getByRole('button', { name: /Keep idle time/ }).click()
  await expect.poll(() => prompt.isClosed()).toBe(true)

  const r = await running(t.page)
  expect(r).toMatchObject({ id: entry.id, start: entry.start, end: null })
  expect(Math.abs(r!.idleSeconds - 600)).toBeLessThanOrEqual(5)
  expect(await allEntries(t.page)).toHaveLength(1)
})

test('Discard and stop trims the entry and stops the timer', async ({ launch }) => {
  const t = await launch()
  const entry = await startRunning(t, 30)
  await goIdle(t.app, 10 * 60)
  await comeBack(t.app)
  const prompt = await promptWindow(t.app)
  await prompt.getByRole('button', { name: /Discard and stop/ }).click()
  await expect.poll(() => prompt.isClosed()).toBe(true)

  expect(await running(t.page)).toBeNull()
  const [only] = await allEntries(t.page)
  expect(only.id).toBe(entry.id)
  expectAgo(only.end, 10 * MIN)
  await expect(t.page.getByRole('region', { name: 'Timer' }).getByRole('button', { name: 'Start' })).toBeVisible()
})

test('closing the prompt without choosing keeps the idle time', async ({ launch }) => {
  const t = await launch()
  const entry = await startRunning(t, 30)
  await goIdle(t.app, 10 * 60)
  await comeBack(t.app)
  const prompt = await promptWindow(t.app)
  await prompt.close()

  await expect.poll(async () => (await running(t.page))?.idleSeconds ?? 0).toBeGreaterThanOrEqual(595)
  expect((await running(t.page))?.id).toBe(entry.id)
})

test('stopping the timer while the prompt is open closes the prompt', async ({ launch }) => {
  const t = await launch()
  await startRunning(t, 30)
  await goIdle(t.app, 10 * 60)
  await comeBack(t.app)
  const prompt = await promptWindow(t.app)

  await t.page.getByRole('region', { name: 'Timer' }).getByRole('button', { name: 'Stop' }).click()
  await expect.poll(() => prompt.isClosed(), { message: 'prompt window to close' }).toBe(true)
  // The idle stretch stays in the stopped entry: nothing was trimmed.
  const [only] = await allEntries(t.page)
  expectAgo(only.end, 0)
})

test('with "ask when I come back" off, idle time is kept without a prompt', async ({ launch }) => {
  const t = await launch()
  const entry = await startRunning(t, 30)
  await updateSettings(t.page, { askOnReturn: false })
  await goIdle(t.app, 10 * 60)
  expect(await notifications(t.app)).toHaveLength(1)
  await comeBack(t.app)
  await expectNoPromptWindow(t.app)
  expect(await running(t.page)).toMatchObject({ id: entry.id, start: entry.start })
})

test('no idle checks run while no timer is running', async ({ launch }) => {
  const t = await launch()
  await seedProject(t)
  await goIdle(t.app, 60 * 60)
  await comeBack(t.app)
  expect(await notifications(t.app)).toEqual([])
  await expectNoPromptWindow(t.app)
})

// ---------------------------------------------------------------- sleep and screen lock

test('sleep longer than the threshold asks on wake', async ({ launch }) => {
  const t = await launch()
  const entry = await startRunning(t, 30)
  await powerEvent(t.app, 'suspend')
  // An hour passes while asleep.
  await hooks(t.app, { clockOffsetMs: 60 * MIN })
  await powerEvent(t.app, 'resume')

  const prompt = await promptWindow(t.app)
  await expect(prompt.getByRole('heading')).toHaveText('You were away for 60 minutes')
  await prompt.getByRole('button', { name: /Discard and stop/ }).click()
  await expect.poll(() => prompt.isClosed()).toBe(true)
  const [only] = await allEntries(t.page)
  expect(only.id).toBe(entry.id)
  // Trimmed back to when the computer went to sleep, i.e. about now.
  expectAgo(only.end, 0)
})

test('screen lock counts too, and the setting turns it off', async ({ launch }) => {
  const t = await launch()
  await startRunning(t, 30)
  await updateSettings(t.page, { sleepCountsAsIdle: false })
  await powerEvent(t.app, 'lock-screen')
  await hooks(t.app, { clockOffsetMs: 60 * MIN })
  await powerEvent(t.app, 'unlock-screen')
  await expectNoPromptWindow(t.app)

  await updateSettings(t.page, { sleepCountsAsIdle: true })
  await powerEvent(t.app, 'lock-screen')
  await hooks(t.app, { clockOffsetMs: 120 * MIN })
  await powerEvent(t.app, 'unlock-screen')
  const prompt = await promptWindow(t.app)
  await expect(prompt.getByRole('heading')).toHaveText('You were away for 60 minutes')
})

// ---------------------------------------------------------------- app closed while the timer ran

test('after the app was closed with a timer running, asks about the gap on the next launch', async ({ launch, dataDir }) => {
  const first = await launch()
  const entry = await startRunning(first, 30)
  await quit(first.app)

  // Pretend the app was last seen two hours ago, with the entry started three hours ago.
  const lastSeen = Date.now() - 120 * MIN
  const dbFile = path.join(dataDir, 'timekeeper.db')
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer as ArrayBuffer, useOldExtensionFunctions: false })
  const db = new SQL.Database(fs.readFileSync(dbFile))
  db.run("UPDATE settings SET value = ? WHERE key = '__lastSeen'", [String(lastSeen)])
  db.run('UPDATE time_entries SET start_utc = ? WHERE id = ?', [new Date(Date.now() - 180 * MIN).toISOString(), entry.id])
  expect(db.getRowsModified()).toBe(1)
  fs.writeFileSync(dbFile, db.export())
  db.close()

  const second = await launch()
  const prompt = await promptWindow(second.app)
  await expect(prompt.getByRole('heading')).toHaveText('You were away for 120 minutes')
  await prompt.getByRole('button', { name: /Discard and stop/ }).click()
  await expect.poll(() => prompt.isClosed()).toBe(true)

  const [only] = await allEntries(second.page)
  expect(only.end).toBe(new Date(lastSeen).toISOString())
  expect(await running(second.page)).toBeNull()
})

test('a clean relaunch soon after quitting does not ask', async ({ launch }) => {
  const first = await launch()
  await startRunning(first, 30)
  await quit(first.app)
  const second = await launch()
  await expectNoPromptWindow(second.app)
  expect(await running(second.page)).not.toBeNull()
})

test('quitting with the prompt open keeps the idle time and exits promptly', async ({ launch }) => {
  const first = await launch()
  const entry = await startRunning(first, 30)
  await goIdle(first.app, 10 * 60)
  await comeBack(first.app)
  await promptWindow(first.app)

  const proc = first.app.process()
  const exited = new Promise<boolean>((r) => proc.once('exit', () => r(true)))
  await first.app.evaluate(({ app }) => app.quit()).catch(() => {})
  expect(await Promise.race([exited, new Promise<boolean>((r) => setTimeout(() => r(false), 3_000))])).toBe(true)

  const second = await launch()
  const r = await running(second.page)
  expect(r?.id).toBe(entry.id)
  expect(Math.abs(r!.idleSeconds - 600)).toBeLessThanOrEqual(5)
})
