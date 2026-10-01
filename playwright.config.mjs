import { defineConfig } from '@playwright/test'

delete process.env.NO_COLOR
process.env.FORCE_COLOR = '0'

export default defineConfig({
  testDir: './test',
  testMatch: '*.test.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [['line'], ['json', { outputFile: '.artifacts/acceptance-report.json' }]],
  outputDir: '.artifacts/playwright',
  use: {
    actionTimeout: 12_000,
    browserName: 'chromium',
    headless: true,
    navigationTimeout: 12_000,
    trace: 'retain-on-failure'
  }
})
