import { defineConfig, devices } from '@playwright/test'

/**
 * Web V1.2 real-model UI evidence (NOT part of the default e2e run): drives the AI Coach chat against the real local
 * agent bridge + Qwen model and saves screenshots. Requires the bridge on 127.0.0.1:4321 with origin
 * http://127.0.0.1:4173 allowed. Run: pnpm exec playwright test -c playwright.llm-demo.config.ts
 */
export default defineConfig({
  testDir: './tests/llm-eval',
  testMatch: /.*\.pw\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 240_000,
  // FP_LLM_DEMO_URL: run against an already running build instead (e.g. the competition package on http://localhost:4175
  // with its ai-coach-local bridge); no dev server is started then.
  use: { baseURL: process.env.FP_LLM_DEMO_URL ?? 'http://127.0.0.1:4173', trace: 'off' },
  ...(process.env.FP_LLM_DEMO_URL ? {} : { webServer: { command: 'pnpm dev --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: true } }),
  projects: [{ name: 'edge', use: { ...devices['Desktop Chrome'], channel: 'msedge', viewport: { width: 1440, height: 1000 } } }],
})
