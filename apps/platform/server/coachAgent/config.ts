export interface CoachAgentServerConfig {
  enabled?: boolean
  apiKey?: string
  accessToken?: string
  model?: string
  modelUrl?: string
  /** Exact trusted hostnames, configured outside the browser request. */
  allowedModelHosts?: readonly string[]
  origin?: string
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  maxConcurrent?: number
  requestsPerMinute?: number
  maxRequests?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  totalTokenBudget?: number
  budgetMicroUsd?: number
  inputPriceMicroUsdPerMillionTokens?: number
  outputPriceMicroUsdPerMillionTokens?: number
  /** Programmatic test fixture only. The environment/CLI cannot enable this. */
  allowLoopbackModelForTests?: boolean
}

export interface ResolvedCoachAgentConfig {
  enabled: boolean
  configured: boolean
  apiKey: string
  accessToken: string
  model: string
  modelUrl: URL | null
  origin: string
  timeoutMs: number
  maxRequestBytes: number
  maxResponseBytes: number
  maxConcurrent: number
  requestsPerMinute: number
  maxRequests: number
  maxInputTokens: number
  maxOutputTokens: number
  totalTokenBudget: number
  budgetMicroUsd: number
  inputPriceMicroUsdPerMillionTokens: number
  outputPriceMicroUsdPerMillionTokens: number
  allowLoopbackModelForTests: boolean
}

function integer(value: number | undefined, fallback: number, min: number, max: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('INVALID_SERVER_CONFIG')
  return result
}

export function resolveCoachAgentConfig(config: CoachAgentServerConfig): ResolvedCoachAgentConfig {
  const origin = config.origin ?? 'http://127.0.0.1:5173'
  let parsedOrigin: URL
  try { parsedOrigin = new URL(origin) } catch { throw new Error('INVALID_SERVER_CONFIG') }
  if (parsedOrigin.origin !== origin || parsedOrigin.hostname !== '127.0.0.1' || parsedOrigin.protocol !== 'http:') {
    throw new Error('INVALID_SERVER_CONFIG')
  }
  const apiKey = config.apiKey ?? ''
  const accessToken = config.accessToken ?? ''
  const model = config.model ?? ''
  if ((accessToken && !/^[A-Za-z0-9_-]{32,256}$/u.test(accessToken))
    || (apiKey && (apiKey.length > 4096 || /[\r\n]/u.test(apiKey)))
    || (model && !/^[A-Za-z0-9._:/-]{1,128}$/u.test(model))
    || (apiKey && apiKey === accessToken)) throw new Error('INVALID_SERVER_CONFIG')
  const allowLoopbackModelForTests = config.allowLoopbackModelForTests === true
  let modelUrl: URL | null = null
  if (config.modelUrl) {
    try { modelUrl = new URL(config.modelUrl) } catch { throw new Error('INVALID_SERVER_CONFIG') }
    const testUrl = allowLoopbackModelForTests && modelUrl.protocol === 'http:' && modelUrl.hostname === '127.0.0.1'
    if ((!testUrl && modelUrl.protocol !== 'https:') || modelUrl.username || modelUrl.password || modelUrl.hash
      || modelUrl.search || !modelUrl.pathname.endsWith('/chat/completions')
      || !config.allowedModelHosts?.includes(modelUrl.hostname)
      || modelUrl.hostname.toLowerCase() !== modelUrl.hostname
      || modelUrl.hostname.endsWith('.')) throw new Error('INVALID_SERVER_CONFIG')
  }
  const inputPrice = integer(config.inputPriceMicroUsdPerMillionTokens, 0, 0, 1_000_000_000)
  const outputPrice = integer(config.outputPriceMicroUsdPerMillionTokens, 0, 0, 1_000_000_000)
  return {
    enabled: config.enabled === true,
    configured: !!(apiKey && accessToken && model && modelUrl && inputPrice > 0 && outputPrice > 0),
    apiKey, accessToken, model, modelUrl, origin, allowLoopbackModelForTests,
    timeoutMs: integer(config.timeoutMs, 10_000, 1, 60_000),
    maxRequestBytes: integer(config.maxRequestBytes, 32_768, 128, 32_768),
    maxResponseBytes: integer(config.maxResponseBytes, 32_768, 128, 65_536),
    maxConcurrent: integer(config.maxConcurrent, 1, 1, 4),
    requestsPerMinute: integer(config.requestsPerMinute, 6, 1, 60),
    maxRequests: integer(config.maxRequests, 20, 1, 1000),
    maxInputTokens: integer(config.maxInputTokens, 16_384, 512, 32_768),
    maxOutputTokens: integer(config.maxOutputTokens, 1024, 1, 4096),
    totalTokenBudget: integer(config.totalTokenBudget, 50_000, 1, 1_000_000),
    budgetMicroUsd: integer(config.budgetMicroUsd, 0, 0, 1_000_000_000),
    inputPriceMicroUsdPerMillionTokens: inputPrice,
    outputPriceMicroUsdPerMillionTokens: outputPrice,
  }
}

/** Only this explicit allowlist is read; no VITE_* or Jev configuration is used. */
export function loadCoachAgentServerConfig(env: NodeJS.ProcessEnv = process.env): CoachAgentServerConfig {
  const number = (name: string): number | undefined => env[name] === undefined ? undefined : Number(env[name])
  return {
    enabled: env.COACH_AGENT_ENABLED === 'true',
    apiKey: env.COACH_AGENT_API_KEY,
    accessToken: env.COACH_AGENT_ACCESS_TOKEN,
    model: env.COACH_AGENT_MODEL,
    modelUrl: env.COACH_AGENT_MODEL_URL,
    allowedModelHosts: env.COACH_AGENT_ALLOWED_MODEL_HOSTS?.split(',').map(host => host.trim()),
    origin: env.COACH_AGENT_ORIGIN,
    timeoutMs: number('COACH_AGENT_TIMEOUT_MS'),
    maxRequestBytes: number('COACH_AGENT_MAX_REQUEST_BYTES'),
    maxResponseBytes: number('COACH_AGENT_MAX_RESPONSE_BYTES'),
    maxConcurrent: number('COACH_AGENT_MAX_CONCURRENT'),
    requestsPerMinute: number('COACH_AGENT_REQUESTS_PER_MINUTE'),
    maxRequests: number('COACH_AGENT_MAX_REQUESTS'),
    maxInputTokens: number('COACH_AGENT_MAX_INPUT_TOKENS'),
    maxOutputTokens: number('COACH_AGENT_MAX_OUTPUT_TOKENS'),
    totalTokenBudget: number('COACH_AGENT_TOTAL_TOKEN_BUDGET'),
    budgetMicroUsd: number('COACH_AGENT_BUDGET_MICRO_USD'),
    inputPriceMicroUsdPerMillionTokens: number('COACH_AGENT_INPUT_PRICE_MICRO_USD_PER_MILLION_TOKENS'),
    outputPriceMicroUsdPerMillionTokens: number('COACH_AGENT_OUTPUT_PRICE_MICRO_USD_PER_MILLION_TOKENS'),
  }
}
