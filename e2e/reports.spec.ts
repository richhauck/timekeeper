/// <reference lib="dom" />
// page.evaluate callbacks run in the renderer, so these files need browser types.
import type { Locator, Page } from '@playwright/test'
import { expect, nav, seedSample, test as base } from './fixtures'

const stat = (page: Page, label: string): Locator => page.locator('.card', { hasText: label }).locator('.stat')

/** Rows of a breakdown section as "label time", e.g. "ACM-101 Website redesign 2:45". */
async function rows(section: Locator, rowSelector: string): Promise<string[]> {
  const texts = await section.locator(rowSelector).allInnerTexts()
  return texts.map((t) => t.replace(/\s+/g, ' ').replace(/ \d+%$/, '').trim())
}

/** The app on the Reports view, with the sample data. */
const test = base.extend<{ reports: Page }>({
  reports: async ({ launch }, use) => {
    const t = await launch()
    await seedSample(t)
    await nav(t.page, 'Reports').click()
    await use(t.page)
  }
})

test('month report totals rounded time by project, client and tag', async ({ reports: page }) => {
  await expect(stat(page, 'Total hours')).toHaveText('3:15')
  await expect(stat(page, 'Entries')).toHaveText('3')

  const byProject = page.getByRole('region', { name: 'By project' })
  await expect(byProject).toContainText('ACM-101 Website redesign')
  expect(await rows(byProject, ':scope > div > div > div:first-child')).toEqual(['ACM-101 Website redesign 2:45', 'Internal 0:30'])

  const byClient = page.getByRole('region', { name: 'By client' })
  await expect(byClient.getByRole('img')).toHaveAccessibleName('Hours by client: Acme Co.: 2:45 (85%), No client: 0:30 (15%)')

  const byTag = page.getByRole('region', { name: 'By tag' })
  expect(await rows(byTag, ':scope > div')).toEqual(['design 2:45', 'meeting 1:45'])

  // The daily chart has the time on days 1 and 2.
  const chart = page.getByRole('region', { name: 'Hours per day' }).getByRole('img')
  await expect(chart).toHaveAccessibleName(/ 1: 2:45, \w+ 2: 0:30, /)
})

test('filters narrow the report', async ({ reports: page }) => {
  await page.getByPlaceholder('Search descriptions').fill('inbox')
  await expect(stat(page, 'Total hours')).toHaveText('0:30')
  await expect(stat(page, 'Entries')).toHaveText('1')
  await page.getByPlaceholder('Search descriptions').fill('')

  await page.getByRole('button', { name: 'Any tag' }).click()
  await page.getByRole('checkbox', { name: 'design' }).check()
  await expect(stat(page, 'Total hours')).toHaveText('2:45')
  await expect(page.getByRole('region', { name: 'By project' })).not.toContainText('Internal')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'All clients' }).click()
  await page.getByRole('checkbox', { name: 'Acme Co.' }).check()
  await expect(stat(page, 'Entries')).toHaveText('2')
})

test('year view and moving between periods', async ({ reports: page }) => {
  await page.getByRole('group', { name: 'Report period' }).getByRole('button', { name: 'Year' }).click()
  await expect(stat(page, 'Total hours')).toHaveText('3:15')
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  await expect(page.getByRole('region', { name: 'Hours per month' }).getByRole('img')).toHaveAccessibleName(new RegExp(`${month}: 3:15`))

  await page.getByRole('button', { name: 'Previous period' }).click()
  await expect(stat(page, 'Total hours')).toHaveText('0:00')
  await expect(page.getByRole('region', { name: 'By project' })).toContainText('No time in this period.')
  await page.getByRole('button', { name: 'This year' }).click()
  await expect(stat(page, 'Total hours')).toHaveText('3:15')
})

test('changing rounding in Settings updates the report', async ({ reports: page }) => {
  await nav(page, 'Settings').click()
  // The radio reflects the saved setting, so it turns on once the save lands.
  const up = page.getByRole('radio', { name: /Always up/ })
  await up.click()
  await expect(up).toBeChecked()
  await nav(page, 'Reports').click()
  // 1:32 -> 1:45, 1:08 -> 1:15, 0:23 -> 0:30
  await expect(stat(page, 'Total hours')).toHaveText('3:30')
})
