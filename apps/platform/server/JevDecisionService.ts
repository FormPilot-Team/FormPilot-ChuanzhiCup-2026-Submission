import { bounded, parseChoice, parseTrainingInput, record, type TrainingDecisionInput, type TrainingDecision } from '../src/features/adaptiveTraining/protocol.ts'
import { buildJevRequest, eligibleForModel, executeChoice, ruleBaseline } from '../src/features/adaptiveTraining/decisionPolicy.ts'

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

export class JevDecisionService {
  private readonly apiKey: string | undefined
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  constructor(options: { apiKey?: string; fetcher?: typeof fetch; timeoutMs?: number } = {}) {
    this.apiKey = options.apiKey
    this.fetcher = options.fetcher ?? fetch
    this.timeoutMs = options.timeoutMs ?? 6000
  }
  configured(): boolean { return Boolean(this.apiKey?.trim()) }

  async decide(summary: TrainingDecisionInput, signal?: AbortSignal): Promise<TrainingDecision> {
    const input = parseTrainingInput(summary)
    if (!eligibleForModel(input)) return ruleBaseline('safety_guard')
    if (!this.configured()) return ruleBaseline('not_configured')
    if (signal?.aborted) return ruleBaseline('unavailable')
    const started = performance.now()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
    const latency = () => Math.round(performance.now() - started)
    let receivedResponse = false
    try {
      const response = await this.fetcher(JEV_ENDPOINT, {
        method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildJevRequest(input)), signal: controller.signal,
      })
      receivedResponse = true
      if (!response.ok) return ruleBaseline([429, 529].includes(response.status) ? 'rate_limited' : 'unavailable', latency())
      // Never relay upstream error bodies or unknown fields to clients/logs.
      const body = record(await response.json())
      const usage = record(body?.usage)
      if (!body || typeof body.model !== 'string' || !/^jev-[\w.-]{1,64}$/.test(body.model)
        || !usage || !bounded(usage.input_tokens, 0, 1e9) || !bounded(usage.output_tokens, 0, 1e9)) throw new Error('Invalid response')
      const answer = parseChoice(record(body.answers)?.intervention)
      if (controller.signal.aborted) return ruleBaseline(timedOut ? 'timeout' : 'unavailable', latency())
      return executeChoice(input, answer, latency(), body.model)
    } catch {
      return ruleBaseline(timedOut ? 'timeout' : controller.signal.aborted || !receivedResponse ? 'unavailable' : 'invalid_response', latency())
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
