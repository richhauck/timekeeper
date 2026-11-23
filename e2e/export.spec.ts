/// <reference lib="dom" />
// page.evaluate callbacks run in the renderer, so these files need browser types.
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, lastDayOfThisMonth, nav, seedSample, test as base, thisMonthKey } from './fixtures'

/**
 * Replace the native Save dialog with one that answers `filePath` (or Cancel
 * when null), and stop the app revealing the file in Finder or Explorer.
 */
async function stubSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog, shell }, filePath) => {
    const answer = async () => (filePath ? { canceled: false, filePath } : { canceled: true, filePath: undefined })
    dialog.showSaveDialog = answer as typeof dialog.showSaveDialog
    shell.showItemInFolder = () => {}
  }, filePath)
}

async function readWorkbook(file: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb
}

const test = base.extend<{ app: { app: ElectronApplication; page: Page } }>({
  app: async ({ launch }, use) => {
    const t = await launch()
    await seedSample(t)
    await nav(t.page, 'Reports').click()
    await use(t)
  }
})

const footer = (page: Page) => page.getByRole('dialog').locator('p', { hasText: /total$/ })

test('exports the month to a workbook with entries and a summary', async ({ app: { app, page }, dataDir }) => {
  // No extension: the app should add .xlsx.
  const chosen = path.join(dataDir, 'October timesheet')
  await stubSaveDialog(app, chosen)

  await page.getByRole('button', { name: 'Export to Excel' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export timesheet to Excel' })
  // The dialog starts with the report's period.
  await expect(dialog.getByLabel('From')).toHaveValue(thisMonthKey(1))
  await expect(dialog.getByLabel('To')).toHaveValue(thisMonthKey(lastDayOfThisMonth()))
  await expect(footer(page)).toHaveText('3 entries · 3:15 total')
  // The preview shows descriptions as plain text.
  await expect(dialog.getByText('Wireframes for pricing', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Export to Excel…' }).click()
  await expect(page.getByRole('status')).toHaveText(/Exported 3 entries to Excel/)
  await expect(dialog).toBeHidden()

  const file = `${chosen}.xlsx`
  expect(fs.existsSync(file)).toBe(true)
  const wb = await readWorkbook(file)
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Entries', 'Summary'])

  const entries = wb.getWorksheet('Entries')!
  const rowsOf = (col: string) => [2, 3, 4].map((r) => entries.getCell(`${col}${r}`).value)
  expect(rowsOf('F')).toEqual(['Wireframes for pricing', 'Design review', 'Inbox'])
  expect(rowsOf('I')).toEqual([1.5, 1.25, 0.5])
  expect(rowsOf('B')).toEqual(['Acme Co.', 'Acme Co.', ''])
  expect(entries.getCell('I5').value).toMatchObject({ formula: 'SUM(I2:I4)', result: 3.25 })

  const summary = wb.getWorksheet('Summary')!
  const summaryRows = Array.from({ length: 6 }, (_, i) => summary.getRow(i + 1).values as unknown[]).map((v) => v.slice(1, 3))
  expect(summaryRows).toEqual([
    ['Client', 'Project'],
    ['Acme Co.', 'ACM-101 Website redesign'],
    ['Acme Co. total'],
    ['No client', 'Internal'],
    ['No client total'],
    ['Total']
  ])
  expect(summary.getCell('C6').value).toMatchObject({ result: 3.25 })
})

test('takes the report’s filters along and respects sheet choices', async ({ app: { app, page }, dataDir }) => {
  const file = path.join(dataDir, 'inbox.xlsx')
  await stubSaveDialog(app, file)

  await page.getByPlaceholder('Search descriptions').fill('inbox')
  await page.getByRole('button', { name: 'Export to Excel' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export timesheet to Excel' })
  await expect(dialog.getByPlaceholder('Any description')).toHaveValue('inbox')
  await expect(footer(page)).toHaveText('1 entry · 0:30 total')

  await dialog.getByRole('checkbox', { name: 'Summary sheet by client and project' }).uncheck()
  await dialog.getByRole('button', { name: 'Export to Excel…' }).click()
  await expect(page.getByRole('status')).toHaveText(/Exported 1 entry to Excel/)

  const wb = await readWorkbook(file)
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Entries'])
  expect(wb.getWorksheet('Entries')!.getCell('F2').value).toBe('Inbox')
})

test('cancelling the save dialog writes nothing and keeps the export dialog open', async ({ app: { app, page }, dataDir }) => {
  await stubSaveDialog(app, null)
  await page.getByRole('button', { name: 'Export to Excel' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export timesheet to Excel' })
  await expect(footer(page)).toHaveText('3 entries · 3:15 total')
  await dialog.getByRole('button', { name: 'Export to Excel…' }).click()

  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Export to Excel…' })).toBeEnabled()
  await expect(page.getByRole('status')).toHaveCount(0)
  expect(fs.readdirSync(dataDir).filter((f) => f.endsWith('.xlsx'))).toEqual([])
})

test('blocks an export with an empty or backwards date range', async ({ app: { page } }) => {
  await page.getByRole('button', { name: 'Export to Excel' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export timesheet to Excel' })
  const exportButton = dialog.getByRole('button', { name: 'Export to Excel…' })
  await expect(exportButton).toBeEnabled()

  // A range with no entries in it.
  await dialog.getByLabel('From').fill('2001-01-01')
  await dialog.getByLabel('To').fill('2001-01-31')
  await expect(dialog.getByText('No matching entries')).toBeVisible()
  await expect(exportButton).toBeDisabled()

  // To before From.
  await dialog.getByLabel('From').fill(thisMonthKey(2))
  await dialog.getByLabel('To').fill(thisMonthKey(1))
  await expect(exportButton).toBeDisabled()

  // Neither sheet chosen.
  await dialog.getByLabel('To').fill(thisMonthKey(lastDayOfThisMonth()))
  await dialog.getByRole('checkbox', { name: 'Entries sheet' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Summary sheet by client and project' }).uncheck()
  await expect(exportButton).toBeDisabled()
})
