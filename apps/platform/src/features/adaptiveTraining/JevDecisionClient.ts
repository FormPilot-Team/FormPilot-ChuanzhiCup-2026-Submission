import { bounded, isStrategy, parseChoice, parseTrainingInput, record, type TrainingDecision, type TrainingDecisionInput, type DecisionReason } from './protocol.ts'
import { decisionFingerprint, eligibleForModel, executeChoice, ruleBaseline } from './decisionPolicy.ts'

const REASONS: DecisionReason[] = ['model', 'not_configured', 'unavailable', 'timeout', 'invalid_response', 'rate_limited', 'safety_guard', 'waiting', 'mock']

export class JevDecisionClient {
  private lastKey?: string
  private lastStarted = -Infinity
  private generation = 0
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private pending?: TrainingDecisionInput
  private current = ruleBaseline()
  private readonly onDecision: (decision: TrainingDecision) => void
  private readonly fetcher: typeof fetch
  private readonly intervalMs: number
  private readonly timeoutMs: number

  constructor(onDecision: (decision: TrainingDecision) => void, options: { fetcher?: typeof fetch; intervalMs?: number; timeoutMs?: number } = {}) {
    this.onDecision = onDecision
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.intervalMs = options.intervalMs ?? 10000
    this.timeoutMs = options.timeoutMs ?? 7000
  }
  update(summary: TrainingDecisionInput): void {
    const input = parseTrainingInput(summary)
    const key = decisionFingerprint(input)
    if (key === this.lastKey) return
    this.lastKey = key
    this.cancelPending()
    this.generation += 1
    // Immediately discard the previous intervention while waiting for a new state decision.
    this.publish(ruleBaseline(eligibleForModel(input) ? 'waiting' : 'safety_guard'))
    if (!eligibleForModel(input)) return
    this.pending = input
    const delay = Math.max(0, this.intervalMs - (performance.now() - this.lastStarted))
    this.timer = setTimeout(() => { this.timer = undefined; void this.request(input, this.generation) }, delay)
  }
  dispose(): void { this.generation += 1; this.cancelPending(); this.lastKey = undefined }
  private cancelPending(): void {
    clearTimeout(this.timer)
    this.controller?.abort()
    this.controller = undefined
    this.pending = undefined
  }
  private publish(decision: TrainingDecision): void { this.current = decision; this.onDecision(this.current) }

  private async request(input: TrainingDecisionInput, generation: number): Promise<void> {
    if (this.pending !== input) return
    this.lastStarted = performance.now()
    const controller = new AbortController()
    this.controller = controller
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
    const latency = () => Math.round(performance.now() - this.lastStarted)
    let result: TrainingDecision
    let receivedResponse = false
    try {
      const response = await this.fetcher('/api/jev/decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      })
      receivedResponse = true
      if (!response.ok) result = ruleBaseline('unavailable', latency())
      else {
        const v = record(await response.json())
        if (!v || !isStrategy(v.strategy) || v.baseline !== 'CONTINUE_STANDARD'
          || !bounded(v.latencyMs, 0, 120000) || typeof v.safetyFallback !== 'boolean'
          || !REASONS.includes(v.reason as DecisionReason)) throw new Error('Invalid proxy response')
        if (v.source === 'jev') {
          if (typeof v.model !== 'string' || !/^jev-[\w.-]{1,64}$/.test(v.model)) throw new Error('Invalid model')
          // Reapply the guard in the browser. Never trust an upstream execution strategy.
          result = executeChoice(input, parseChoice(v.modelAnswer), v.latencyMs, v.model)
        } else if (v.source === 'rules' && v.strategy === 'CONTINUE_STANDARD') {
          result = ruleBaseline(v.reason as DecisionReason, v.latencyMs)
        } else throw new Error('Invalid decision source')
      }
    } catch {
      result = ruleBaseline(timedOut ? 'timeout' : receivedResponse ? 'invalid_response' : 'unavailable', latency())
    } finally { clearTimeout(timeout) }
    if (generation !== this.generation || (controller.signal.aborted && !timedOut)) return
    this.controller = undefined
    this.publish(result)
  }
}
