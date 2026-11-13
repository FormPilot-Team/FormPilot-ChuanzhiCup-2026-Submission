import { pathToFileURL } from 'node:url'
import { createAgentBridge } from './server.ts'

/**
 * Launcher for the V1.2 local LLM agent bridge. Reads only the variables below; never loads .env, never starts or
 * downloads a model. Example (PowerShell, separate terminal):
 *   $env:FP_AGENT_ENABLED='true'; $env:FP_AGENT_OLLAMA_PORT='11441'
 *   $env:FP_AGENT_ORIGINS='http://127.0.0.1:4173,http://localhost:4175'
 *   $env:FP_AGENT_PRELOAD='true'   # optional: load the model into VRAM at start
 *   node server/coachAgent/agent/index.ts
 */
export function startAgentBridge(env: NodeJS.ProcessEnv = process.env) {
  const bridge = createAgentBridge({
    enabled: env.FP_AGENT_ENABLED === 'true',
    origins: env.FP_AGENT_ORIGINS ? env.FP_AGENT_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
    port: env.FP_AGENT_PORT ? Number(env.FP_AGENT_PORT) : undefined,
    ollamaPort: env.FP_AGENT_OLLAMA_PORT ? Number(env.FP_AGENT_OLLAMA_PORT) : undefined,
    model: env.FP_AGENT_MODEL || undefined,
    accessToken: env.FP_AGENT_ACCESS_TOKEN || undefined,
    requestsPerMinute: env.FP_AGENT_RPM ? Number(env.FP_AGENT_RPM) : undefined,
  })
  if (!bridge.config.enabled) {
    console.error('FormPilot agent bridge is disabled. Set FP_AGENT_ENABLED=true to start it.')
    process.exitCode = 1
    return null
  }
  bridge.server.listen(bridge.config.port, '127.0.0.1', () => {
    console.log(`FormPilot agent bridge on http://127.0.0.1:${bridge.config.port} · model ${bridge.config.model} via 127.0.0.1:${bridge.config.modelPort} · origins ${bridge.config.origins.join(', ')}`)
    if (env.FP_AGENT_PRELOAD === 'true') {
      const started = Date.now()
      void bridge.preload().then((ok) => console.log(ok ? `model preloaded in ${Date.now() - started} ms` : 'model preload failed (bridge keeps serving; first answer will be slow or unavailable)'))
    }
  })
  return bridge
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) startAgentBridge()
