import { defineConfig } from 'vitest/config'

/**
 * Real local-model evaluations (V1.2). Not part of `pnpm test`: they need the local agent bridge and the pinned Qwen
 * model running. Run: npx vitest run -c vitest.llm-eval.config.ts
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/llm-eval/**/*.eval.ts'],
    testTimeout: 60 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
