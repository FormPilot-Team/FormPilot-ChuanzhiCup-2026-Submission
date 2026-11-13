import { defineConfig, devices } from '@playwright/test'

/**
 * Public AI Coach demo, REAL MODEL check (NOT part of the default e2e run). Opens a running demo gateway — local
 * (default http://127.0.0.1:4330, `pnpm demo:build` + `pnpm demo:gateway`) or a public HTTPS address given in
 * FP_DEMO_URL — asks the four competition questions and saves the transcript and screenshots to FP_EVIDENCE_DIR.
 * Run: pnpm exec playwright test -c playwright.public-demo.config.ts
 */
export default defineConfig({
  testDir: './tests/public-demo',
  testMatch: /.*\.pw\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 300_000,
  use: { baseURL: process.env.FP_DEMO_URL ?? 'http://127.0.0.1:4330', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'msedge', viewport: { width: 1440, height: 1000 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'msedge' } },
  ],
})
