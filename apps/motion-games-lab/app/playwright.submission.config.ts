import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Run the existing complete game suite against an already running, unpacked submission package.
// No fallback server: a wrong/missing package should fail visibly.
export default defineConfig({
  ...base,
  testDir: './e2e',
  outputDir: './test-results-submission',
  webServer: undefined,
  reporter: [['list'], ['json', { outputFile: './test-results-submission/results.json' }]],
  use: { ...base.use, baseURL: process.env.FP_GAMES_URL ?? 'http://localhost:5181' },
})
