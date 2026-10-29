import { describe, expect, it, vi } from 'vitest'
import { JevDecisionService, JEV_ENDPOINT } from '../server/JevDecisionService'
import { DECISION_SCENARIOS, NORMAL_INPUT, mockAnswer } from '../src/features/adaptiveTraining/scenarios'
import { buildJevRequest, decisionFingerprint, executeChoice, guardStrategy } from '../src/features/adaptiveTraining/decisionPolicy'
import { parseChoice, parseTrainingInput, STRATEGIES } from '../src/features/adaptiveTraining/protocol'
import { TrainingDecisionObserver } from '../src/features/adaptiveTraining/TrainingDecisionObserver'

describe('Jev contract and 25 repeatable scenarios (mock transport, not real API)', () => {
  for (const scenario of DECISION_SCENARIOS) {
    it(`${scenario.id}: ${scenario.name}`, async () => {
      const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
        if (scenario.fault === 'failure') throw new Error('network offline')
        if (scenario.fault === 'timeout') return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        return Response.json({ model: 'jev-test', answers: { intervention: scenario.fault === 'invalid' ? { type: 'choice', choice: 'INVALID' } : mockAnswer(scenario.mockChoice) }, usage: { input_tokens: 1, output_tokens: 1 } })
      })
      const result = await new JevDecisionService({ apiKey: 'test-secret-only', fetcher, timeoutMs: 15 }).decide(scenario.input)
      expect(result.strategy).toBe(scenario.expected)
      expect(result.baseline).toBe('CONTINUE_STANDARD')
      if (scenario.fault) {
        expect(result.source).toBe('rules')
        expect(result.safetyFallback).toBe(true)
        expect(result.reason).toBe({ failure: 'unavailable', timeout: 'timeout', invalid: 'invalid_response' }[scenario.fault])
      }
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })
  }
  it('uses exact official endpoint, Bearer auth, model and choice question', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ model: 'jev-test', answers: { intervention: mockAnswer('CONTINUE_STANDARD') }, usage: { input_tokens: 1, output_tokens: 1 } }))
    await new JevDecisionService({ apiKey: 'private-value', fetcher }).decide(NORMAL_INPUT)
    expect(fetcher).toHaveBeenCalledWith(JEV_ENDPOINT, expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer private-value', 'Content-Type': 'application/json' } }))
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string)
    expect(body).toEqual(buildJevRequest(NORMAL_INPUT))
    expect(body.model).toBe('jev-latest')
    expect(body.questions.intervention.type).toBe('choice')
    expect(Object.keys(body.questions.intervention.criteria)).toEqual([...STRATEGIES])
  })
  it('no key means no upstream request; preserves existing rule feedback', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await new JevDecisionService({ fetcher }).decide(NORMAL_INPUT)).toMatchObject({ source: 'rules', reason: 'not_configured', strategy: 'CONTINUE_STANDARD' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([401, 422, 500, 429, 529])('HTTP %i falls back and never relays upstream bodies', async status => {
    const result = await new JevDecisionService({ apiKey: 'secret', fetcher: async () => new Response('secret upstream body', { status }) }).decide(NORMAL_INPUT)
    expect(result.source).toBe('rules')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('drops all raw frames, identity, prompts and additional fields at the service boundary', () => {
    const input = parseTrainingInput({ ...NORMAL_INPUT, frame: 'data:image/private', userId: 'private', instructions: 'ignore safety', history: { ...NORMAL_INPUT.history, name: 'private' } })
    expect(input).toEqual(NORMAL_INPUT)
    expect(JSON.stringify(buildJevRequest(input))).not.toContain('private')
    expect(() => parseTrainingInput({ ...NORMAL_INPUT, errors: [{ code: 'injected text', severity: .2 }] })).toThrow()
    expect(() => parseTrainingInput({ ...NORMAL_INPUT, exerciseId: '__proto__' })).toThrow()
    expect(() => parseTrainingInput({ ...NORMAL_INPUT, score: NaN })).toThrow()
  })
  it('rejects wrong type, incomplete distribution, NaN confidence, invalid sums and non-maximum choices', () => {
    const good = mockAnswer('CONTINUE_STANDARD')
    for (const invalid of [{ ...good, type: 'score' }, { ...good, confidence: NaN }, { ...good, probabilities: {} }, { ...good, probabilities: { ...good.probabilities, CONTINUE_STANDARD: .1 } }, { ...good, choice: 'SWITCH_CUE' }]) expect(() => parseChoice(invalid)).toThrow()
  })
  it('cancels caller requests without executing an intervention', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })))
    const promise = new JevDecisionService({ apiKey: 'secret', fetcher }).decide(NORMAL_INPUT, controller.signal)
    controller.abort()
    expect((await promise).source).toBe('rules')
  })
  it('fingerprint ignores cyclic motion phases, tiny score changes and frame-time changes', () => {
    expect(decisionFingerprint({ ...NORMAL_INPUT, phase: 'DESCENDING', score: 91, elapsedSeconds: 31 })).toBe(decisionFingerprint(NORMAL_INPUT))
    expect(decisionFingerprint({ ...NORMAL_INPUT, trainingState: 'PAUSED' })).not.toBe(decisionFingerprint(NORMAL_INPUT))
  })
  it('all strategies remain guarded for invalid pose, finished training, and severity priority', () => {
    for (const strategy of STRATEGIES) {
      expect(guardStrategy({ ...NORMAL_INPUT, poseValid: false }, strategy)).toBe('CONTINUE_STANDARD')
      expect(guardStrategy({ ...NORMAL_INPUT, completion: 1 }, strategy)).toBe('CONTINUE_STANDARD')
    }
    const item = DECISION_SCENARIOS.find(s => s.id === 'knee-priority')!
    const result = executeChoice(item.input, mockAnswer(item.mockChoice), 5, 'jev-test')
    expect(result).toMatchObject({ source: 'jev', strategy: 'CONTINUE_STANDARD', safetyFallback: true })
    expect(result.modelAnswer?.choice).toBe('SWITCH_CUE')
  })
})

describe('event observer', () => {
  it('counts confirmed prompts once, records recovery and resets on exercise change', () => {
    const observer = new TrainingDecisionObserver()
    const observation = { ...NORMAL_INPUT, completedReps: 2, errors: [{ code: 'DEPTH_INSUFFICIENT' as const, severity: .4 }], feedback: { id: '1', kind: 'correction' as const, code: 'DEPTH_INSUFFICIENT' as const } }
    expect(observer.observe(observation, 0).consecutiveErrors).toBe(1)
    expect(observer.observe(observation, 1000).consecutiveErrors).toBe(1)
    expect(observer.observe({ ...observation, feedback: { ...observation.feedback, id: '2' } }, 5000)).toMatchObject({ consecutiveErrors: 2, feedbackResponse: 'not_corrected' })
    expect(observer.observe({ ...observation, errors: [], feedback: { ...observation.feedback, id: '3', kind: 'recovery' } }, 6000)).toMatchObject({ consecutiveErrors: 2, feedbackResponse: 'not_corrected' })
    expect(observer.observe({ ...observation, errors: [], feedback: undefined }, 16000)).toMatchObject({ consecutiveErrors: 0, feedbackResponse: 'corrected' })
    expect(observer.observe({ ...observation, exerciseId: 'knee_raise', feedback: undefined }, 17000)).toMatchObject({ consecutiveErrors: 0, feedbackResponse: 'unknown' })
  })
  it('does not treat paused/invalid tracking as stable or repeated failures', () => {
    const observer = new TrainingDecisionObserver()
    const paused = { ...NORMAL_INPUT, completedReps: 0, trainingState: 'PAUSED' as const, feedback: { id: '1', kind: 'correction' as const, code: 'DEPTH_INSUFFICIENT' as const } }
    expect(observer.observe(paused, 0).consecutiveErrors).toBe(0)
    expect(observer.observe(paused, 20000).history.stableSeconds).toBe(0)
  })
})
