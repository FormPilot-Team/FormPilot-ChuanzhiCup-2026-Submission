import { pathToFileURL } from 'node:url'
import { loadCoachAgentServerConfig, resolveCoachAgentConfig } from './config.ts'
import { createCoachAgentServer } from './server.ts'

export { createCoachAgentServer } from './server.ts'
export { loadCoachAgentServerConfig } from './config.ts'
export type { CoachAgentServerConfig } from './config.ts'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadCoachAgentServerConfig()
    const resolved = resolveCoachAgentConfig(config)
    const port = Number(process.env.COACH_AGENT_PORT ?? '4319')
    if (!resolved.enabled || !resolved.configured || !resolved.budgetMicroUsd) {
      console.error('AI Coach remote server disabled or not configured; no listener started.')
      process.exitCode = 1
    } else if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
      console.error('AI Coach server configuration rejected.')
      process.exitCode = 1
    } else {
      const server = createCoachAgentServer(config)
      server.once('error', () => { console.error('AI Coach loopback server could not start.'); process.exitCode = 1 })
      server.listen(port, '127.0.0.1', () => console.log(`AI Coach development server listening on 127.0.0.1:${port}; memory budgets reset on restart.`))
    }
  } catch {
    console.error('AI Coach server configuration rejected.')
    process.exitCode = 1
  }
}
