import { classifyCoachQuestion, type CoachProvider, type ProviderContext } from './provider'

export interface MockCoachOptions {
  /** Trusted composition configuration; never inferred from arbitrary model or user IDs. */
  warmupSessionId?: string
  routineSessionId?: string
  historyLimit?: number
}

/** Rules and fixtures only: no LLM, network, camera, secret, training mutation or inference. */
export function createMockCoachProvider(options: MockCoachOptions = {}): CoachProvider {
  const configuration = { ...options }
  const historyLimit = configuration.historyLimit ?? 3
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 64) throw new Error('Invalid mock history limit')
  return Object.freeze({
    kind: 'mock' as const,
    id: 'deterministic-coach-mock-v1',
    async next(context: ProviderContext) {
      const mode = classifyCoachQuestion(context.question)
      if (mode === 'insufficient') return { type: 'answer', mode, evidenceRefs: [] }
      const sessionId = mode === 'routine' ? configuration.routineSessionId : configuration.warmupSessionId
      if (!sessionId) return { type: 'answer', mode: 'insufficient', evidenceRefs: [] }
      if (!context.observations.length) return { type: 'tools', calls: [{
        tool: mode === 'history' ? 'read_history' : 'read_scoring_evidence',
        query: mode === 'routine'
          ? { kind: 'routine', sessionId, subject: { kind: 'routine', id: 'baduanjin' } }
          : { kind: 'warmup', sessionId, subject: { kind: 'exercise', id: 'squat' },
            ...(mode === 'history' ? { limit: historyLimit } : {}) },
      }] }
      const last = context.observations[context.observations.length - 1]
      return { type: 'answer', mode, evidenceRefs: last.evidence.map(item => ({
        requestId: last.requestId, evidenceId: item.evidenceId,
      })) }
    },
  })
}
