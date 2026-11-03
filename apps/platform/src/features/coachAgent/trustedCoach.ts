import { createQuestionAdmission, type AdmissionClosed, type AdmissionDecision, type QuestionTicket } from './questionAdmission'
import { createCoachOrchestrator } from './orchestrator'
import { freezeCoachValue, parseLocalProviderPlan, type CoachProvider, type ProviderContext } from './provider'
import type { CoachToolDispatcher } from './dispatchTypes'
import type { CoachAnswer } from './answer'
import type { LocalPlanContext } from './localProtocolV2'
import type { AdmittedLocalCoachProvider } from './localProvider'

export interface TrustedCoachOptions {
  /** All capabilities come from trusted composition, never request JSON or a browser global. */
  enabled?: boolean
  consent?: boolean
  /** Separate opt-in; admitting a question never grants model execution. */
  inferenceEnabled?: boolean
  resourcesConfirmed?: boolean
  provider: AdmittedLocalCoachProvider
  dispatcher: CoachToolDispatcher
  scope: LocalPlanContext['scope']
  maxRequests?: number
  timeoutMs?: number
  ttlMs?: number
  now?: () => number
}

export type TrustedCoachResult = AdmissionClosed | Readonly<{
  status: 'completed'
  answer: CoachAnswer
}>

const stopped = (code: string): AdmissionClosed => Object.freeze({ status: 'denied', code })

/** Minimal non-UI composition adapter. It never builds readers or changes their authorization.
 * Identity/account/path fields stay in the caller's private sidecar; do not pass them here.
 * Bind a new instance to each immutable provider/Dispatcher/record-selection configuration.
 * Keep this instance private: exported functions/types are not UI/IPC authentication proofs.
 * Construction and preparation perform no network/model calls. Every execution opt-in defaults off.
 */
export function createTrustedCoach(options: TrustedCoachOptions) {
  const { provider, dispatcher } = options
  if (provider.kind !== 'local' || provider.protocol !== 'intent-v2' || typeof provider.nextAdmitted !== 'function') throw new Error('TRUSTED_LOCAL_V2_REQUIRED')
  for (const value of [options.enabled, options.consent, options.inferenceEnabled, options.resourcesConfirmed]) {
    if (value !== undefined && typeof value !== 'boolean') throw new Error('INVALID_TRUSTED_COACH_CONFIGURATION')
  }
  const executionEnabled = options.inferenceEnabled === true && options.resourcesConfirmed === true
  const timeoutMs = options.timeoutMs ?? 5_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('INVALID_TRUSTED_COACH_CONFIGURATION')
  const admission = createQuestionAdmission({
    enabled: options.enabled, consent: options.consent, scope: options.scope,
    remainingCalls: options.maxRequests ?? 1, ttlMs: options.ttlMs, now: options.now,
  })
  let disposed = false
  const finishPreparation = (capture: ReturnType<typeof admission.hostCaptureSelection>): AdmissionDecision =>
    capture.status === 'captured' ? admission.assess(capture.capture) : capture
  return Object.freeze({
    prepareSelection(input: unknown): AdmissionDecision {
      if (disposed) return stopped('DISPOSED')
      return finishPreparation(admission.hostCaptureSelection(input))
    },
    prepareQuestion(input: unknown): AdmissionDecision {
      if (disposed) return stopped('DISPOSED')
      return finishPreparation(admission.hostCaptureQuestion(input))
    },
    clarify(..._untrusted: unknown[]): AdmissionClosed {
      // Never inspect, log, reflect or retain mixed input, including malicious objects.
      void _untrusted
      return admission.mixed()
    },
    cancel(): void { admission.invalidate() },
    dispose(): void { disposed = true; admission.hostUpdate({ enabled: false, consent: false }) },
    async execute(ticket: QuestionTicket, runOptions: { signal?: AbortSignal } = {}): Promise<TrustedCoachResult> {
      if (disposed) return stopped('DISPOSED')
      if (!executionEnabled) { admission.invalidate(); return Object.freeze({ status: 'disabled', code: 'INFERENCE_DISABLED' }) }
      if (runOptions.signal?.aborted) { admission.invalidate(); return stopped('CANCELLED') }
      const admitted = admission.consume(ticket)
      if (admitted.status !== 'admitted') return admitted
      const signal = runOptions.signal ? AbortSignal.any([admitted.signal, runOptions.signal]) : admitted.signal
      const guarded: CoachProvider = Object.freeze({
        kind: 'local', id: provider.id, protocol: 'intent-v2',
        async next(context: ProviderContext, nextOptions: { signal: AbortSignal }) {
          if (signal.aborted || !admission.isCurrent(admitted.lease) || context.question !== admitted.localQuestion) {
            throw new Error('STALE_ADMISSION')
          }
          // V2 planner receives only the admitted minimal wire; history has no question text.
          const raw = await provider.nextAdmitted(freezeCoachValue({ ...admitted.wire,
            remainingCalls: Math.min(context.remainingCalls, admitted.wire.remainingCalls) }), nextOptions)
          if (signal.aborted || nextOptions.signal.aborted || !admission.isCurrent(admitted.lease)) throw new Error('STALE_ADMISSION')
          const plan = parseLocalProviderPlan(raw)
          if (plan.mode !== 'insufficient' && plan.mode !== admitted.constraint.intent) throw new Error('PLAN_OUTSIDE_ADMISSION')
          if (plan.mode === 'history') {
            const call = plan.calls[0] as { query: { limit?: number } }
            if (call.query.limit !== admitted.constraint.historyPreviousCount) throw new Error('PLAN_OUTSIDE_ADMISSION')
          }
          return freezeCoachValue(plan)
        },
      })
      // All reads, owned receipts, scope and evidence gates remain in the existing orchestration path.
      const runner = createCoachOrchestrator({ provider: guarded, dispatcher, localEnabled: true, maxTurns: 1, timeoutMs })
      try {
        const answer = await runner.run(admitted.localQuestion, { signal })
        if (signal.aborted || !admission.acceptResult(admitted.lease)) return stopped('CANCELLED_OR_STALE_ADMISSION')
        return freezeCoachValue({ status: 'completed', answer })
      } finally {
        // Only release this lease. A stale completion must never invalidate a newer submission.
        admission.acceptResult(admitted.lease)
      }
    },
  })
}
