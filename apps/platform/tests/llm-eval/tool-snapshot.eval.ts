import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { executeAgentTool } from '../../src/features/coachLlm/tools'
import type { AgentToolCall } from '../../src/features/coachLlm/protocol'
import { SYNTHETIC_ONLY, toolContext, type ContextOptions } from './fixtures'

/**
 * Deterministic tool outputs for the agent-eval record/recommendation cases (same TEST FIXTURES, same code). Used by the
 * factual-error review to compare each model sentence with exactly what the model was given. No model involved.
 */
const CASES: Array<{ id: string; call: AgentToolCall; context?: ContextOptions }> = [
  { id: 'rec-today', call: { name: 'recommend_training', arguments: {} } },
  { id: 'last-warmup', call: { name: 'read_last_training', arguments: { kind: 'warmup' } } },
  { id: 'last-routine', call: { name: 'read_last_training', arguments: { kind: 'routine' } } },
  { id: 'progress-warmup', call: { name: 'compare_recent_training', arguments: { kind: 'warmup' } } },
  { id: 'progress-routine', call: { name: 'compare_recent_training', arguments: { kind: 'routine' } } },
  { id: 'progress-synthetic', call: { name: 'compare_recent_training', arguments: { kind: 'warmup' } }, context: { warmup: SYNTHETIC_ONLY } },
]

describe('tool output snapshots for the factual review', () => {
  it('writes the exact tool content each record case gives the model', async () => {
    const out = process.env.FP_EVAL_OUT ?? 'test-results/llm-eval'
    const rows = []
    for (const testCase of CASES) {
      const result = await executeAgentTool(testCase.call, toolContext(testCase.context))
      rows.push({ id: testCase.id, call: testCase.call, ok: result.ok, content: JSON.parse(result.content) as unknown, evidence: result.evidence })
    }
    // Decision runtime status behind recommend_training for the eval profile (M1/M2 ACTIVE, competition settings).
    for (const [id, options] of [['decision-runtime', {}], ['decision-runtime-profile-only', { consent: false }]] as const) {
      const decision = toolContext(options).recommend()
      rows.push({ id, call: null, ok: true, content: decision && { decisionOrigin: decision.decisionOrigin, fallbackReason: decision.fallbackReason, abstainReason: decision.abstainReason, outOfDistributionFeatures: decision.outOfDistributionFeatures, model: decision.model?.id ?? null, confidence: decision.confidence, top: decision.ranking.slice(0, 3) }, evidence: [] })
    }
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'tool-snapshots.json'), JSON.stringify({ data: 'TEST FIXTURES', rows }, null, 2))
    expect(rows).toHaveLength(CASES.length + 2)
  })
})
