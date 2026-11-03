import { describe, expect, it } from 'vitest'
import { QWEN3_4B_DIGEST, QWEN3_4B_MODEL, resolveLocalConfig } from '../server/coachAgent/local/config'
import { assertLocalTokenUsage, extractPlan, planRequest, reserveLocalContext } from '../server/coachAgent/local/planning'
import type { LocalPlanContext } from '../src/features/coachAgent/localProtocolV2'

const CONTEXT: LocalPlanContext = { protocol: 'coach-plan-v2', inputProjection: 'question-scope',
  question: '为什么深蹲评分低？', scope: { warmup: true, routine: true, historyLimit: 3 }, remainingCalls: 1 }

describe('one 8192-token local context includes complete input and reserved output', () => {
  it('admits the exact conservative total boundary and rejects one byte beyond before dispatch', () => {
    // 7168 input bytes + 512 template reserve + 512 output = 8192.
    expect(reserveLocalContext('x'.repeat(7168), 512)).toEqual({ inputTokens: 7680, reservedTokens: 8192 })
    expect(() => reserveLocalContext('x'.repeat(7169), 512)).toThrow('INPUT_TOKEN_LIMIT')
    expect(() => reserveLocalContext('x'.repeat(7168), 513)).toThrow('INPUT_TOKEN_LIMIT')
  })

  it('counts UTF-8 bytes, not UTF-16 characters, and reserves the configured output', () => {
    expect(reserveLocalContext('深蹲', 2048)).toEqual({ inputTokens: 518, reservedTokens: 2566 })
    expect(() => reserveLocalContext('深'.repeat(2389) + 'xx', 512)).toThrow('INPUT_TOKEN_LIMIT')
  })

  it.each(['simple-json', 'native-tools', 'structured-output'] as const)(
    '%s includes system, wire, tools or schema in its reservation', planningProtocol => {
      const config = resolveLocalConfig({ model: QWEN3_4B_MODEL, modelDigest: QWEN3_4B_DIGEST, planningProtocol })
      const request = planRequest(config, CONTEXT)
      const body = JSON.stringify(request)
      const full = reserveLocalContext(body, config.maxOutputTokens)
      const wireOnly = reserveLocalContext(JSON.stringify(CONTEXT), config.maxOutputTokens)
      expect(full.inputTokens).toBe(Buffer.byteLength(body, 'utf8') + 512)
      expect(full.reservedTokens - full.inputTokens).toBe(512)
      expect(full.inputTokens).toBeGreaterThan(wireOnly.inputTokens)
      expect(request.messages[0].role).toBe('system')
      if (planningProtocol === 'native-tools') {
        expect('tools' in request && request.tools).toHaveLength(3)
      }
      if (planningProtocol === 'structured-output') {
        expect('format' in request && request.format).toBeTypeOf('object')
      }
    })

  it('rejects actual combined usage beyond 8K even when each individual count fits its own bound', () => {
    expect(() => assertLocalTokenUsage({ prompt_eval_count: 7680, eval_count: 512 }, 8192, 512)).not.toThrow()
    expect(() => assertLocalTokenUsage({ prompt_eval_count: 7681, eval_count: 512 }, 8192, 512))
      .toThrow('INVALID_MODEL_RESPONSE')
  })

  it.each([
    { prompt_eval_count: -1, eval_count: 1 }, { prompt_eval_count: 1.5, eval_count: 1 },
    { prompt_eval_count: 1, eval_count: -1 }, { prompt_eval_count: 1, eval_count: 513 },
    { prompt_eval_count: 7681, eval_count: 1 }, { prompt_eval_count: '1', eval_count: 1 },
  ])('rejects malformed or over-reservation actual usage %j', usage => {
    expect(() => assertLocalTokenUsage(usage, 7680, 512)).toThrow('INVALID_MODEL_RESPONSE')
  })

  it.each(['simple-json', 'native-tools', 'structured-output'] as const)(
    '%s applies the combined actual-usage gate before accepting a valid candidate', planningProtocol => {
      const config = resolveLocalConfig({ model: QWEN3_4B_MODEL, modelDigest: QWEN3_4B_DIGEST, planningProtocol })
      const message = planningProtocol === 'native-tools'
        ? { role: 'assistant', content: '', tool_calls: [{ function: {
          name: 'read_scoring_evidence', arguments: { intent: 'explain' },
        } }] }
        : { role: 'assistant', content: '{"intent":"explain","tool":"read_scoring_evidence"}' }
      const envelope = { done: true, done_reason: 'stop', message, prompt_eval_count: 7680, eval_count: 512 }
      expect(extractPlan(envelope, CONTEXT, config, 8192)).toEqual({ intent: 'explain', tool: 'read_scoring_evidence' })
      expect(() => extractPlan({ ...envelope, prompt_eval_count: 7681 }, CONTEXT, config, 8192))
        .toThrow('INVALID_MODEL_RESPONSE')
    })
})
