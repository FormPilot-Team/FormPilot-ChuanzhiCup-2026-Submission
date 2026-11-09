import { defineConfig, devices } from '@playwright/test'

/**
 * Web V1 visual evidence: the production competition build (`competition:build` + `competition:preview` on :4175)
 * captured at the four review viewports. Run on demand, not part of `test:e2e`:
 *   pnpm competition:build
 *   WEB_V1_SHOTS=<folder> npx playwright test -c playwright.web-v1-visual.config.ts
 */
export default defineConfig({
  testDir: './tests/visual-web-v1',
  // Own artifacts folder: Playwright empties outputDir at start, which must never race the main e2e run.
  outputDir: './test-results-web-v1-visual',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:4175', ...devices['Desktop Chrome'], channel: 'msedge' },
  webServer: {
    command: 'npm run competition:preview',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: true,
  },
})
