import { pathToFileURL } from 'node:url'
import { createDemoGateway } from './server.ts'

/**
 * Launcher for the FormPilot public demo gateway. Reads only FP_DEMO_* variables; never loads .env files, never
 * downloads or starts a model, never opens a tunnel. Example (PowerShell, local Qwen upstream, loopback only):
 *   pnpm demo:build
 *   $env:FP_DEMO_ENABLED='true'; $env:FP_DEMO_OLLAMA_PORT='11441'
 *   node server/coachAgent/demo/index.ts        # → http://127.0.0.1:4330/
 * OpenAI-compatible upstream (key set by the owner in this terminal only, never committed):
 *   $env:FP_DEMO_UPSTREAM='openai'; $env:FP_DEMO_OPENAI_BASE_URL='https://…/v1'; $env:FP_DEMO_OPENAI_MODEL='…'
 *   $env:FP_DEMO_OPENAI_API_KEY='…'
 * Public exposure: set FP_DEMO_PUBLIC_ORIGINS=https://<host> (+ FP_DEMO_TRUST_PROXY=cloudflare behind Cloudflare).
 */
const num = (value: string | undefined) => (value ? Number(value) : undefined)
const list = (value: string | undefined) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined)

export function startDemoGateway(env: NodeJS.ProcessEnv = process.env) {
  const gateway = createDemoGateway({
    enabled: env.FP_DEMO_ENABLED === 'true',
    port: num(env.FP_DEMO_PORT),
    bind: env.FP_DEMO_BIND || undefined,
    publicOrigins: list(env.FP_DEMO_PUBLIC_ORIGINS),
    frameAncestors: list(env.FP_DEMO_FRAME_ANCESTORS),
    staticDir: env.FP_DEMO_STATIC_DIR || undefined,
    upstream: (env.FP_DEMO_UPSTREAM as 'ollama' | 'openai' | undefined) || undefined,
    ollamaPort: num(env.FP_DEMO_OLLAMA_PORT),
    openaiBaseUrl: env.FP_DEMO_OPENAI_BASE_URL || undefined,
    openaiModel: env.FP_DEMO_OPENAI_MODEL || undefined,
    openaiApiKey: env.FP_DEMO_OPENAI_API_KEY || undefined,
    openaiDisableThinking: env.FP_DEMO_OPENAI_DISABLE_THINKING === 'true',
    label: env.FP_DEMO_LABEL || undefined,
    trustProxy: (env.FP_DEMO_TRUST_PROXY as 'none' | 'cloudflare' | 'xff' | undefined) || undefined,
    clientPerMinute: num(env.FP_DEMO_CLIENT_RPM),
    clientPerDay: num(env.FP_DEMO_CLIENT_DAILY),
    globalPerMinute: num(env.FP_DEMO_GLOBAL_RPM),
    dailyBudget: num(env.FP_DEMO_DAILY_BUDGET),
    maxConcurrent: num(env.FP_DEMO_MAX_CONCURRENT),
    timeoutMs: num(env.FP_DEMO_TIMEOUT_MS),
  })
  const { config } = gateway
  if (!config.enabled) {
    console.error('FormPilot demo gateway is disabled. Set FP_DEMO_ENABLED=true to start it.')
    process.exitCode = 1
    return null
  }
  gateway.server.listen(config.port, config.bind, () => {
    console.log(`FormPilot demo gateway on http://${config.bind === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'}:${config.port}/ · upstream ${config.upstream} (${config.model}) · origins ${config.origins.join(', ')} · static ${config.staticDir}`)
    console.log(`limits: ${config.clientPerMinute}/min and ${config.clientPerDay}/day per visitor, ${config.globalPerMinute}/min and ${config.dailyBudget}/day in total, ${config.maxConcurrent} at a time`)
  })
  return gateway
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) startDemoGateway()
