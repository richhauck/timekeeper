/// <reference lib="dom" />
// page.evaluate callbacks run in the renderer, so these files need browser types.
import type { Api } from '../src/shared/types'
import { expect, nav, quit, seedProject, test, todayAt } from './fixtures'

type WithApi = { api: Api }

test('first run: create a project, track time with a tag, see the entry', async ({ launch }) => {
  const { page } = await launch()

  // A new user lands on Projects, since a timer needs a project.
  await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible()
  await page.getByLabel('Code').fill('ACM-101')
  await page.getByLabel('Name').fill('Website redesign')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('region', { name: 'Projects' }).getByText('Website redesign')).toBeVisible()

  await nav(page, 'Timer').click()
  const timer = page.getByRole('region', { name: 'Timer' })
  await expect(timer.getByLabel(/^Project/)).toHaveValue(/\d+/)
  await timer.getByLabel('What are you working on?').fill('Wireframes')
  const tagInput = timer.getByLabel('Add tags')
  await tagInput.fill('design')
  await tagInput.press('Enter')
  await expect(timer.getByRole('button', { name: 'Remove tag design' })).toBeVisible()

  await timer.getByRole('button', { name: 'Start' }).click()
  await expect(timer.getByRole('button', { name: 'Stop' })).toBeVisible()
  // The clock is ticking.
  await expect(timer.getByText(/^00:00:0[1-9]$/)).toBeVisible({ timeout: 4_000 })

  // Other views show the running timer in the nav bar.
  await nav(page, 'Reports').click()
  await expect(page.getByRole('button', { name: /ACM-101 Website redesign/ })).toBeVisible()
  await nav(page, 'Timer').click()

  await timer.getByRole('button', { name: 'Stop' }).click()
  await expect(timer.getByRole('button', { name: 'Start' })).toBeVisible()
  const today = page.getByRole('group', { name: 'Today' })
  await expect(today.getByText('Wireframes')).toBeVisible()
  await expect(today.getByRole('button', { name: 'Remove tag design' })).toBeVisible()
  // The timer bar clears for the next task.
  await expect(timer.getByLabel('What are you working on?')).toHaveValue('')
})

test('edits an entry’s times, including one that runs past midnight', async ({ launch }) => {
  const t = await launch()
  const { page } = t
  const projectId = await seedProject(t)
  await page.evaluate(
    ([projectId, start, end]) =>
      (window as unknown as WithApi).api.createEntry({ projectId, description: 'Design review', start, end, tagIds: [] }),
    [projectId, todayAt(10, 0), todayAt(11, 0)] as const
  )
  await nav(page, 'Timer').click()

  const row = page.getByRole('group', { name: 'Today' }).locator('.table-row', { hasText: 'Design review' })
  await expect(row.getByText('1:00', { exact: true })).toBeVisible()

  // Each field saves on blur. Wait for the save before the next edit: the row
  // reloads from the database when it lands, as it does for a person tabbing across.
  await row.getByLabel('Start time').fill('09:00')
  await row.getByLabel('Start time').blur()
  await expect(row.getByText('2:00', { exact: true })).toBeVisible()
  await row.getByLabel('End time').fill('10:30')
  await row.getByLabel('End time').blur()
  await expect(row.getByText('1:30', { exact: true })).toBeVisible()

  // An end earlier than the start means the entry ends the next day.
  await row.getByLabel('End time').fill('08:00')
  await row.getByLabel('End time').blur()
  await expect(row.getByText('23:00', { exact: true })).toBeVisible()

  // The change was saved, not just shown.
  const saved = await page.evaluate(() => (window as unknown as WithApi).api.listEntries({ from: new Date(0).toISOString(), to: '9999-12-31T00:00:00.000Z' }))
  expect(Date.parse(saved[0].end!) - Date.parse(saved[0].start)).toBe(23 * 3600 * 1000)
})

test('undo brings back a deleted entry, even after starting a new timer', async ({ launch }) => {
  const t = await launch()
  const { page } = t
  const projectId = await seedProject(t)
  await page.evaluate(
    ([projectId, start, end]) =>
      (window as unknown as WithApi).api.createEntry({ projectId, description: 'Client call', start, end, tagIds: [] }),
    [projectId, todayAt(9, 0), todayAt(9, 45)] as const
  )
  await nav(page, 'Timer').click()

  const today = page.getByRole('group', { name: 'Today' })
  await today.locator('.table-row', { hasText: 'Client call' }).getByRole('button', { name: 'Delete entry' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Entry deleted' })
  await expect(toast).toBeVisible()
  await expect(page.getByText('No entries yet')).toBeVisible()

  // Start a timer before undoing: this used to reuse the deleted entry's id and make Undo fail.
  const timer = page.getByRole('region', { name: 'Timer' })
  await timer.getByRole('button', { name: 'Start' }).click()
  await expect(timer.getByRole('button', { name: 'Stop' })).toBeVisible()

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(today.getByText('Client call')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /went wrong|constraint/i })).toHaveCount(0)
  // The new timer is still running.
  await expect(timer.getByRole('button', { name: 'Stop' })).toBeVisible()
})

test('a running timer survives quitting and relaunching', async ({ launch }) => {
  const first = await launch()
  await seedProject(first)
  await nav(first.page, 'Timer').click()
  const timer1 = first.page.getByRole('region', { name: 'Timer' })
  await timer1.getByLabel('What are you working on?').fill('Long task')
  await timer1.getByRole('button', { name: 'Start' }).click()
  await expect(timer1.getByRole('button', { name: 'Stop' })).toBeVisible()
  await quit(first.app)

  const second = await launch()
  // With a project in the database the app opens on the timer.
  const timer2 = second.page.getByRole('region', { name: 'Timer' })
  await expect(timer2.getByRole('button', { name: 'Stop' })).toBeVisible()
  await expect(timer2.getByLabel('What are you working on?')).toHaveValue('Long task')
  await expect(timer2.getByText(/^00:00:\d\d$/)).not.toHaveText('00:00:00')
})
