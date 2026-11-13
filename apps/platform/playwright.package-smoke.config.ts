import { defineConfig, devices } from '@playwright/test'

/**
 * Competition package smoke test (NOT part of the default e2e run): drives an UNZIPPED package started with its own
 * launcher (start-formpilot.cmd → http://localhost:4175 + games on :5181). Checks what the visual suite does not:
 * the four routine demonstration videos really load, the games service answers, the workshop opens, and the AI Coach
 * free-text input degrades honestly when no local model bridge is running.
 * Run: FP_PACKAGE_URL=http://localhost:4175 pnpm exec playwright test -c playwright.package-smoke.config.ts
 */
export default defineConfig({
  testDir: './tests/package-smoke',
  testMatch: /.*\.pw\.ts$/,
  outputDir: './test-results-package-smoke',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 120_000,
  use: { baseURL: process.env.FP_PACKAGE_URL ?? 'http://localhost:4175', ...devices['Desktop Chrome'], channel: 'msedge', viewport: { width: 1440, height: 1000 } },
})
