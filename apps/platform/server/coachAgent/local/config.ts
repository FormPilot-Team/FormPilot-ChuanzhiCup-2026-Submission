/** No API keys, public hosts or model-controlled destinations exist in this adapter. */
export interface LocalCoachServerConfig {
  enabled?: boolean
  resourcesConfirmed?: boolean
  accessToken?: string
  origin?: string
  model?: string
  modelDigest?: string
  timeoutMs?: number
  maxRequests?: number
  totalTokenBudget?: number
  requestsPerMinute?: number
  maxOutputTokens?: number
  /** Explicit experiment selection; never selected by user text or model output. */
  planningProtocol?: 'provider-step-v1' | 'simple-json' | 'native-tools' | 'structured-output'
  /** Trusted programmatic fixture only; the launcher always uses Ollama port 11434. */
  testModelPort?: number
}

export const LOCAL_MODELS = ['qwen2.5:0.5b-instruct-q4_K_M', 'qwen2.5:1.5b-instruct-q4_K_M', 'qwen3:0.6b-q4_K_M'] as const

function integer(value: number | undefined, fallback: number, min: number, max: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('INVALID_LOCAL_CONFIG')
  return result
}

export function resolveLocalConfig(input: LocalCoachServerConfig) {
  const model = input.model ?? ''
  const modelDigest = input.modelDigest ?? ''
  const accessToken = input.accessToken ?? ''
  const origin = input.origin ?? 'http://127.0.0.1:5173'
  const parsed = new URL(origin)
  const planningProtocol = input.planningProtocol ?? 'provider-step-v1'
  if (parsed.origin !== origin || parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:'
    || !['provider-step-v1', 'simple-json', 'native-tools', 'structured-output'].includes(planningProtocol)
    || (model && !LOCAL_MODELS.includes(model as typeof LOCAL_MODELS[number]))
    || (modelDigest && !/^(?:sha256:)?[a-f0-9]{64}$/u.test(modelDigest))
    || (accessToken && !/^[A-Za-z0-9_-]{32,256}$/u.test(accessToken))) throw new Error('INVALID_LOCAL_CONFIG')
  return Object.freeze({
    enabled: input.enabled === true && input.resourcesConfirmed === true,
    configured: !!(model && modelDigest && accessToken),
    model, modelDigest: modelDigest.replace(/^sha256:/u, ''), accessToken, origin,
    planningProtocol,
    modelPort: integer(input.testModelPort, 11434, 1024, 65535),
    timeoutMs: integer(input.timeoutMs, 20_000, 1, 60_000),
    maxRequests: integer(input.maxRequests, 20, 1, 1000),
    requestsPerMinute: integer(input.requestsPerMinute, 6, 1, 60),
    totalTokenBudget: integer(input.totalTokenBudget, 100_000, 1, 1_000_000),
    maxOutputTokens: integer(input.maxOutputTokens, 512, 1, 2048),
  })
}
export type ResolvedLocalConfig = ReturnType<typeof resolveLocalConfig>
