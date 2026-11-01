import { describe, expect, it } from 'vitest'
import { setupProtocolDemo } from './support/coach-agent-protocol-http'
import { LOCAL_PLAN_SCHEMA } from '../src/features/coachAgent/localProtocolV2'
import { loadLocalCoachConfig } from '../server/coachAgent/local/index'

describe('Phase 1H protocol bridge: Fake HTTP only', () => {
  it.each(['B', 'C', 'D'] as const)('%s sends its actual protocol and binds facts only after Dispatcher', async protocol => {
    const demo = await setupProtocolDemo({ protocol, reply: () => ({ intent: 'explain', tool: 'read_scoring_evidence' }) })
    try {
      const answer = await demo.agent.run('为什么我这次深蹲评分不高？')
      expect(answer.status).toBe('answered')
      expect(answer.citations[0].score).toMatchObject({ value: 67, scoringVersion: 'scoring-v2.1' })
      expect(answer.citations[0].provenance.source).toBe('synthetic')
      expect(answer.citations[0].requestId).toBe(answer.calls[0].requestId)
      expect(answer.citations[0].recordRef).toBeTruthy()
      expect(demo.contexts).toHaveLength(1)
      const body = JSON.parse(demo.bodies[0])
      expect(body.keep_alive).toBe(0)
      expect(body.stream).toBe(false)
      if (protocol === 'C') {
        expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name))
          .toEqual(['read_scoring_evidence', 'read_history', 'decline'])
        expect(body.format).toBeUndefined()
      } else {
        expect(body.tools).toBeUndefined()
        expect(body.format).toEqual(protocol === 'D' ? LOCAL_PLAN_SCHEMA : 'json')
      }
      expect(demo.contexts[0]).toMatchObject({ protocol: 'coach-plan-v2', question: '为什么我这次深蹲评分不高？' })
      const projected = JSON.stringify(demo.contexts)
      for (const forbidden of ['synthetic-squat', 'requestId', 'evidenceId', 'recordRef', 'score', 'observations']) {
        expect(projected).not.toContain(forbidden)
      }
      expect(demo.paths.every(path => ['/api/tags', '/api/show', '/api/chat'].includes(path))).toBe(true)
      expect([...demo.raw.entries()]).toEqual(demo.before)
      expect(demo.storage.setItem).not.toHaveBeenCalled()
    } finally { await demo.close() }
  })

  it('native tools require the installed model capability, with no fallback or inference', async () => {
    const demo = await setupProtocolDemo({ protocol: 'C', capabilities: ['completion'] })
    try {
      expect((await demo.agent.run('深蹲评分为什么低？')).status).toBe('failed')
      expect(demo.contexts).toEqual([])
      expect(demo.storage.getItem).not.toHaveBeenCalled()
    } finally { await demo.close() }
  })

  const fn = { function: { name: 'read_scoring_evidence', arguments: { intent: 'explain' } } }
  it.each([
    { role: 'assistant', content: '你进步了', tool_calls: [fn] },
    { role: 'assistant', content: '', tool_calls: [fn, fn] },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_storage', arguments: { intent: 'explain' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_history', arguments: { intent: 'history', limit: 64 } } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_scoring_evidence', arguments: '{"intent":"explain"}' } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { ...fn.function, index: 1 } }] },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_scoring_evidence', arguments: { intent: 'explain', evidenceId: 'e1' } } }] },
    { role: 'assistant', content: '', tool_calls: [{ ...fn, requestId: 'r1' }] },
  ])('rejects ambiguous, forged or unsupported native output %# before reading storage', async message => {
    const demo = await setupProtocolDemo({ protocol: 'C', nativeEnvelope: {
      done: true, done_reason: 'stop', message, prompt_eval_count: 1, eval_count: 1,
    } })
    try {
      const answer = await demo.agent.run('为什么我这次深蹲评分不高？')
      expect(answer.status).toBe('failed')
      expect(answer.citations).toEqual([])
      expect(demo.storage.getItem).not.toHaveBeenCalled()
    } finally { await demo.close() }
  })

  it.each(['B', 'D'] as const)('%s does not trust format compliance on malformed JSON', async protocol => {
    const demo = await setupProtocolDemo({ protocol, modelContent: '{broken' })
    try {
      expect((await demo.agent.run('深蹲评分为什么低？')).status).toBe('failed')
      expect(demo.storage.getItem).not.toHaveBeenCalled()
    } finally { await demo.close() }
  })

  it('does not silently mix a v2 provider with a legacy bridge', async () => {
    const demo = await setupProtocolDemo({ protocol: 'B', config: { planningProtocol: 'provider-step-v1' } })
    try {
      expect((await demo.agent.run('深蹲评分为什么低？')).status).toBe('failed')
      expect(demo.contexts).toEqual([])
      expect(demo.storage.getItem).not.toHaveBeenCalled()
    } finally { await demo.close() }
  })

  it('selects experiments from explicit local launch configuration only', () => {
    expect(loadLocalCoachConfig({})).toHaveProperty('planningProtocol', undefined)
    expect(loadLocalCoachConfig({ LOCAL_COACH_PLANNING_PROTOCOL: 'structured-output' }))
      .toHaveProperty('planningProtocol', 'structured-output')
    expect(() => loadLocalCoachConfig({ LOCAL_COACH_PLANNING_PROTOCOL: 'auto' })).toThrow('INVALID_LOCAL_CONFIG')
  })
})
