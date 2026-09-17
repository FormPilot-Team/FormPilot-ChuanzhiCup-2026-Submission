import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // MediaPipe/WebGL cases share one local GPU; serialize them to avoid cross-test inference starvation.
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'edge', use: { ...devices['Desktop Chrome'], channel: 'msedge', viewport: { width: 1600, height: 1000 } } },
  ],
})
