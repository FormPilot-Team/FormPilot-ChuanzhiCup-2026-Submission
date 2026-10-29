import { afterEach, describe, expect, it, vi } from 'vitest'
import { JevDecisionClient } from '../src/features/adaptiveTraining/JevDecisionClient'
import { NORMAL_INPUT, DECISION_SCENARIOS, mockAnswer } from '../src/features/adaptiveTraining/scenarios'
import { executeChoice } from '../src/features/adaptiveTraining/decisionPolicy'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('low frequency Jev client', () => {
  it('binds native browser fetch to globalThis instead of the client instance', async () => {
    vi.useFakeTimers()
    const nativeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(Response.json({ strategy: 'CONTINUE_STANDARD', baseline: 'CONTINUE_STANDARD', source: 'rules', reason: 'not_configured', latencyMs: 0, safetyFallback: true }))
    })
    vi.stubGlobal('fetch', nativeFetch)
    const onDecision = vi.fn()
    const client = new JevDecisionClient(onDecision)
    client.update(NORMAL_INPUT)
    await vi.advanceTimersByTimeAsync(1)
    expect(nativeFetch).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'not_configured' }))
    client.dispose()
  })
  it('deduplicates unchanged states, throttles changes and cancels expired requests', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const signals: AbortSignal[] = []
    const resolveRequests: ((r: Response) => void)[] = []
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      signals.push(options!.signal as AbortSignal)
      return new Promise(resolve => resolveRequests.push(resolve))
    })
    const onDecision = vi.fn()
    const client = new JevDecisionClient(onDecision, { fetcher, intervalMs: 10000 })
    client.update(NORMAL_INPUT)
    await vi.advanceTimersByTimeAsync(1)
    for (let frame = 0; frame < 100; frame++) client.update({ ...NORMAL_INPUT, score: 91, phase: 'DESCENDING' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const repeated = DECISION_SCENARIOS.find(s => s.id === 'switch')!.input
    client.update(repeated)
    expect(signals[0].aborted).toBe(true)
    resolveRequests[0](Response.json(executeChoice(NORMAL_INPUT, mockAnswer('CONTINUE_STANDARD'), 1, 'jev-test')))
    await vi.advanceTimersByTimeAsync(9999)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(onDecision.mock.calls.some(([d]) => d.source === 'jev')).toBe(false)
    resolveRequests[1](Response.json(executeChoice(repeated, mockAnswer('SWITCH_CUE'), 1, 'jev-test')))
    await vi.advanceTimersByTimeAsync(1)
    expect(onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ strategy: 'SWITCH_CUE', source: 'jev' }))
    client.update({ ...repeated, poseValid: false })
    expect(onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ strategy: 'CONTINUE_STANDARD', source: 'rules' }))
    client.dispose()
  })
  it('timeouts preserve rule feedback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const fetcher: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    const onDecision = vi.fn()
    const client = new JevDecisionClient(onDecision, { fetcher, timeoutMs: 50 })
    client.update(NORMAL_INPUT)
    await vi.advanceTimersByTimeAsync(51)
    expect(onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'timeout', strategy: 'CONTINUE_STANDARD' }))
    client.dispose()
  })
  it('illegal proxy results and network failure fall back', async () => {
    vi.useFakeTimers()
    for (const fetcher of [async () => Response.json({ strategy: 'DO_ANYTHING' }), async () => { throw new Error('offline') }]) {
      const onDecision = vi.fn()
      const client = new JevDecisionClient(onDecision, { fetcher })
      client.update(NORMAL_INPUT)
      await vi.advanceTimersByTimeAsync(1)
      expect(onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ strategy: 'CONTINUE_STANDARD', source: 'rules', safetyFallback: true }))
      client.dispose()
    }
  })
})
