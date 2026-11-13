import { QWEN3_4B_DIGEST, QWEN3_4B_MODEL } from '../local/config.ts'

/**
 * Web V1.2 LLM agent bridge configuration. Zero paid API: the only model target is a local Ollama on a literal
 * loopback port. The model tag and its digest are pinned; nothing here downloads, creates or starts a model.
 */
export interface AgentBridgeConfigInput {
  enabled?: boolean
  /** Exact browser origins allowed to call the bridge, e.g. http://127.0.0.1:4173. */
  origins?: string[]
  port?: number
  ollamaPort?: number
  model?: string
  modelDigest?: string
  /** Optional bearer token; when set every chat request must carry it. */
  accessToken?: string
  timeoutMs?: number
  requestsPerMinute?: number
  maxRequests?: number
}

/** Pinned identities. Adding a tag here never downloads weights; the digest must match the installed model. */
export const AGENT_MODELS: Readonly<Record<string, string>> = Object.freeze({
  [QWEN3_4B_MODEL]: QWEN3_4B_DIGEST,
})

function int(value: number | undefined, fallback: number, min: number, max: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('INVALID_AGENT_CONFIG')
  return result
}

export function resolveAgentConfig(input: AgentBridgeConfigInput) {
  const model = input.model ?? QWEN3_4B_MODEL
  const pinned = AGENT_MODELS[model]
  const digest = (input.modelDigest ?? pinned ?? '').replace(/^sha256:/u, '')
  if (!pinned || digest !== pinned) throw new Error('INVALID_AGENT_CONFIG')
  const origins = (input.origins ?? ['http://127.0.0.1:4173']).map((origin) => {
    const parsed = new URL(origin)
    if (parsed.origin !== origin || parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('INVALID_AGENT_CONFIG')
    return origin
  })
  if (!origins.length || origins.length > 8) throw new Error('INVALID_AGENT_CONFIG')
  const accessToken = input.accessToken ?? ''
  if (accessToken && !/^[A-Za-z0-9_-]{32,256}$/u.test(accessToken)) throw new Error('INVALID_AGENT_CONFIG')
  return Object.freeze({
    enabled: input.enabled === true,
    origins: Object.freeze(origins),
    port: int(input.port, 4321, 1024, 65535),
    model,
    modelDigest: digest,
    accessToken,
    // verifyInstalledModel() reads these two fields: pinned runtime + native tools capability.
    modelPort: int(input.ollamaPort, 11434, 1024, 65535),
    planningProtocol: 'native-tools' as const,
    timeoutMs: int(input.timeoutMs, 90_000, 1000, 180_000),
    requestsPerMinute: int(input.requestsPerMinute, 40, 1, 600),
    maxRequests: int(input.maxRequests, 2000, 1, 100_000),
  })
}
export type ResolvedAgentConfig = ReturnType<typeof resolveAgentConfig>
