import type { CoachToolDispatcher, DispatchReceipt } from './dispatchTypes'
import { parseToolIntent } from './toolQuery'
import { coachFailure, receiptEvidence, renderCoachAnswer, type CoachAnswer } from './answer'
import { classifyCoachQuestion, freezeCoachValue, parseProviderStep, type CoachProvider, type ProviderContext } from './provider'

export interface CoachOrchestratorOptions {
  dispatcher: CoachToolDispatcher
  provider: CoachProvider
  maxTurns?: number
  /** Whole-run deadline, including planning, dispatch and answer selection. */
  timeoutMs?: number
}

export function createCoachOrchestrator(options: CoachOrchestratorOptions) {
  const { dispatcher, provider } = options
  const maxTurns = options.maxTurns ?? 4
  const timeoutMs = options.timeoutMs ?? 5_000
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 8
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid orchestrator budget')

  return Object.freeze({
    run(question: string, runOptions: { signal?: AbortSignal } = {}): Promise<CoachAnswer> {
      const receipts: DispatchReceipt[] = []
      if (provider.kind !== 'mock') return Promise.resolve(coachFailure(provider.id, receipts, 'PROVIDER_NOT_ALLOWED'))
      if (typeof question !== 'string' || !question.trim() || question.length > 4096) {
        return Promise.resolve(coachFailure(provider.id, receipts, 'INVALID_INPUT'))
      }
      return new Promise(resolve => {
        const controller = new AbortController()
        const deadline = performance.now() + timeoutMs
        let settled = false
        const timer: { value?: ReturnType<typeof setTimeout> } = {}
        const finish = (answer: CoachAnswer) => {
          if (settled) return
          settled = true
          if (timer.value !== undefined) clearTimeout(timer.value)
          runOptions.signal?.removeEventListener('abort', cancel)
          resolve(answer)
        }
        const cancel = () => {
          controller.abort()
          finish(coachFailure(provider.id, receipts, 'CANCELLED', 'cancelled'))
        }
        const expire = () => {
          controller.abort()
          finish(coachFailure(provider.id, receipts, 'TIMEOUT', 'timeout'))
        }
        const stopped = () => {
          if (!settled && performance.now() >= deadline) expire()
          return settled
        }
        if (runOptions.signal?.aborted) { cancel(); return }
        runOptions.signal?.addEventListener('abort', cancel, { once: true })
        timer.value = setTimeout(expire, timeoutMs)

        const work = async () => {
          for (let turn = 0; turn < maxTurns && !stopped(); turn += 1) {
            const context: ProviderContext = freezeCoachValue({ question,
              remainingCalls: dispatcher.remainingCalls(), observations: receipts.map(receipt => ({
                requestId: receipt.requestId, tool: receipt.tool, ok: receipt.ok,
                problemCode: receipt.problem?.code ?? null, comparisonGate: receipt.comparison?.gate ?? null,
                evidence: receiptEvidence(receipt).map(evidence => ({
                  evidenceId: evidence.id, sessionId: evidence.sessionId, subject: evidence.subject,
                  scoreKind: evidence.score.scoreKind, scoringVersion: evidence.score.scoringVersion,
                  source: evidence.provenance.source,
                })),
              })) })
            let raw: unknown
            try { raw = await provider.next(context, { signal: controller.signal }) }
            catch { if (!settled) finish(coachFailure(provider.id, receipts, 'PROVIDER_FAILURE')); return }
            // JavaScript cannot preempt a synchronous adapter. Reject output that exceeded
            // the monotonic deadline even if its microtask beats the timeout callback.
            if (stopped()) return
            let step: ReturnType<typeof parseProviderStep>
            try { step = parseProviderStep(raw) }
            catch { finish(coachFailure(provider.id, receipts, 'INVALID_PROVIDER_OUTPUT')); return }
            if (step.type === 'answer') {
              if (step.mode !== 'insufficient' && step.mode !== classifyCoachQuestion(question)) {
                finish(coachFailure(provider.id, receipts, 'INVALID_ANSWER_SCOPE')); return
              }
              try {
                const answer = renderCoachAnswer(provider.id, step.mode, step.evidenceRefs, receipts)
                if (!stopped()) finish(answer)
              }
              catch { finish(coachFailure(provider.id, receipts, 'INVALID_EVIDENCE_REFERENCE')) }
              return
            }
            // Validate a whole proposed batch before any read. A malformed later intent cannot
            // make an earlier intent take effect. Authorization remains exclusively in Dispatcher.
            const intents = step.calls.map(call => parseToolIntent(call))
            if (intents.some(intent => intent === null)) {
              finish(coachFailure(provider.id, receipts, 'INVALID_PROVIDER_OUTPUT')); return
            }
            for (const intent of intents) {
              if (stopped()) return
              let receipt: DispatchReceipt
              try { receipt = await dispatcher.dispatch(intent, { signal: controller.signal }) }
              catch { if (!settled) finish(coachFailure(provider.id, receipts, 'DISPATCHER_FAILURE')); return }
              if (stopped()) return
              if (!dispatcher.owns(receipt)) { finish(coachFailure(provider.id, receipts, 'UNTRUSTED_TOOL_RESULT')); return }
              receipts.push(receipt)
              if (receipt.problem?.code === 'CANCELLED' || receipt.problem?.code === 'TIMEOUT') {
                controller.abort()
                finish(coachFailure(provider.id, receipts, receipt.problem.code,
                  receipt.problem.code === 'CANCELLED' ? 'cancelled' : 'timeout'))
                return
              }
            }
          }
          if (!settled) finish(coachFailure(provider.id, receipts, 'TURN_BUDGET_EXCEEDED'))
        }
        // Application-injected adapters remain trusted code, but failures never expose their text.
        void work().catch(() => finish(coachFailure(provider.id, receipts, 'ORCHESTRATOR_FAILURE')))
      })
    },
  })
}
