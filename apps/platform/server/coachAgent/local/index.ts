import { pathToFileURL } from 'node:url'
import { resolveLocalConfig, type LocalCoachServerConfig } from './config.ts'
import { createLocalCoachServer } from './server.ts'

export { createLocalCoachServer } from './server.ts'
export { LOCAL_MODELS, resolveLocalConfig } from './config.ts'
export type { LocalCoachServerConfig } from './config.ts'

/** Isolated allowlist; never consumes legacy COACH_AGENT_*, VITE_*, API keys or Jev settings. */
export function loadLocalCoachConfig(env: NodeJS.ProcessEnv = process.env): LocalCoachServerConfig {
  return {
    enabled: env.LOCAL_COACH_ENABLED === 'true',
    resourcesConfirmed: env.LOCAL_COACH_RESOURCES_CONFIRMED === 'true',
    accessToken: env.LOCAL_COACH_ACCESS_TOKEN,
    origin: env.LOCAL_COACH_ORIGIN,
    model: env.LOCAL_COACH_MODEL,
    modelDigest: env.LOCAL_COACH_MODEL_DIGEST,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = loadLocalCoachConfig()
    const config = resolveLocalConfig(input)
    const port = Number(process.env.LOCAL_COACH_PORT ?? '4320')
    if (!config.enabled || !config.configured) {
      console.error('Local Coach OFF: explicit enable, hardware/license/resource confirmation and installed model digest are required. No listener or inference started.')
      process.exitCode = 1
    } else if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === 11434) {
      throw new Error('INVALID_LOCAL_PORT')
    } else {
      const server = createLocalCoachServer(input)
      server.once('error', () => { console.error('Local Coach loopback bridge could not start.'); process.exitCode = 1 })
      server.listen(port, '127.0.0.1', () => console.log(`Local Coach bridge: http://127.0.0.1:${port}/v1/coach/local/step; installed model verification happens on session exchange. No model is downloaded or started.`))
      const stop = () => { server.closeAllConnections(); server.close() }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    }
  } catch {
    console.error('Local Coach configuration rejected; no inference started.')
    process.exitCode = 1
  }
}
