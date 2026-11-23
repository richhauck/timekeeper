import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the built app (out/) through Playwright's Electron
 * support. Run `npm run test:e2e`, which builds first.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // Each test launches its own app window; keep CI machines from being swamped.
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
