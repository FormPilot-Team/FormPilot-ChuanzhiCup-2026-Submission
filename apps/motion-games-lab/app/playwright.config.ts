import { defineConfig } from '@playwright/test'

// System Edge (Chromium) is used: no browser download. Production build served by `vite preview`.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../docs/desktop-release/e2e-results.json' }]],
  use: {
    channel: 'msedge',
    baseURL: 'http://127.0.0.1:5181',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
