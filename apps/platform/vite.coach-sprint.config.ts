import { defineConfig, mergeConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import base from './vite.config'

// A separate build keeps the competition surface out of the shared application shell.
export default mergeConfig(base, defineConfig({
  build: {
    outDir: 'dist-coach-sprint',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        coachSprint: fileURLToPath(new URL('./coach-agent-sprint.html', import.meta.url)),
      },
    },
  },
}))
