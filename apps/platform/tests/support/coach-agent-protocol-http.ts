import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLocalCoachServer } from '../../server/coachAgent/local/server'
import type { LocalCoachServerConfig } from '../../server/coachAgent/local/config'
import { createLocalCoachProvider, type LocalCoachProviderOptions } from '../../src/features/coachAgent/localProvider'
import { createCoachOrchestrator } from '../../src/features/coachAgent/orchestrator'
import type { RemoteCoachContext } from '../../src/features/coachAgent/remoteProtocol'
import type { LocalPlanContext } from '../../src/features/coachAgent/localProtocolV2'
import { remoteDemoFixture } from '../coach-agent-remote-fixtures'

export type ProtocolArm = 'A' | 'B' | 'C' | 'D'
export type ExperimentContext = RemoteCoachContext | LocalPlanContext
const ORIGIN = 'http://127.0.0.1:5173'
const TOKEN = 'phase1h_fake_bootstrap_capability_1234567890'
const MODEL = 'qwen2.5:0.5b-instruct-q4_K_M'
const DIGEST = 'a'.repeat(64)

export function legacyFixturePlan(context: RemoteCoachContext): unknown {
  if (context.mode === 'insufficient') return { type: 'answer', mode: 'insufficient', evidenceRefs: [] }
  if (context.observations.length) return { type: 'answer', mode: context.mode,
    evidenceRefs: context.observations.filter(item => item.ok).flatMap(item => item.evidence.map(e => ({
      requestId: item.requestId, evidenceId: e.evidenceId,
    }))) }
  const routine = context.mode === 'routine'
  const sessionId = routine ? context.scope.routineSessionId : context.scope.warmupSessionId
  if (!sessionId) return { type: 'answer', mode: 'insufficient', evidenceRefs: [] }
  return { type: 'tools', calls: [{ tool: context.mode === 'history' ? 'read_history' : 'read_scoring_evidence',
    query: { kind: routine ? 'routine' : 'warmup', sessionId,
      subject: routine ? { kind: 'routine', id: 'baduanjin' } : { kind: 'exercise', id: 'squat' },
      ...(context.mode === 'history' ? { limit: context.scope.historyLimit } : {}) } }] }
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  return (server.address() as AddressInfo).port
}
async function close(server: Server) {
  server.closeAllConnections()
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
}

/** Fake endpoints only: ports are OS-assigned and no Ollama process or model is used. */
export async function setupProtocolDemo(options: {
  protocol: ProtocolArm
  projection?: 'structured' | 'question-scope'
  reply?: (context: ExperimentContext) => unknown
  fixture?: Parameters<typeof remoteDemoFixture>[0]
  providerOptions?: Partial<LocalCoachProviderOptions>
  config?: LocalCoachServerConfig
  modelContent?: string
  nativeEnvelope?: unknown
  capabilities?: string[]
}) {
  if (options.protocol === 'A' && options.projection === 'question-scope') throw new Error('A retains the unmodified historical projection')
  const contexts: ExperimentContext[] = []
  const bodies: string[] = []
  const paths: string[] = []
  const responses: unknown[] = []
  const model = createServer(async (req, res) => {
    paths.push(req.url!)
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST, size: 398_000_000 }] })); return
    }
    if (req.url === '/api/show') {
      req.resume()
      res.end(JSON.stringify({ details: { format: 'gguf', family: 'qwen2', quantization_level: 'Q4_K_M' },
        model_info: {}, capabilities: options.capabilities ?? ['completion', 'tools'] })); return
    }
    if (req.url !== '/api/chat') { res.writeHead(404); res.end('{}'); return }
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString('utf8')
      bodies.push(body)
      const context = JSON.parse(JSON.parse(body).messages.at(-1).content) as ExperimentContext
      contexts.push(context)
      const candidate = options.reply ? options.reply(context) : options.protocol === 'A'
        ? legacyFixturePlan(context as RemoteCoachContext) : { intent: 'insufficient', tool: 'none' }
      const data = candidate as Record<string, unknown>
      const { tool, ...argumentsValue } = data
      const envelope = options.nativeEnvelope ?? { done: true, done_reason: 'stop',
        message: options.protocol === 'C'
          ? { role: 'assistant', content: options.modelContent ?? '', tool_calls: [{ function: {
            name: tool === 'none' ? 'decline' : tool, arguments: argumentsValue,
          } }] }
          : { role: 'assistant', content: options.modelContent ?? JSON.stringify(candidate) },
        prompt_eval_count: 1, eval_count: 1 }
      responses.push(envelope)
      res.end(JSON.stringify(envelope))
    } catch { res.writeHead(500); res.end('{}') }
  })
  const modelPort = await listen(model)
  let bridge: Server | undefined
  try {
    bridge = createLocalCoachServer({ enabled: true, resourcesConfirmed: true, accessToken: TOKEN, origin: ORIGIN,
      model: MODEL, modelDigest: DIGEST, testModelPort: modelPort, requestsPerMinute: 60,
      planningProtocol: ({ A: 'provider-step-v1', B: 'simple-json', C: 'native-tools', D: 'structured-output' } as const)[options.protocol],
      ...options.config })
    const bridgePort = await listen(bridge)
    const endpoint = `http://127.0.0.1:${bridgePort}/v1/coach/local/step`
    const fixture = remoteDemoFixture(options.fixture)
    const provider = createLocalCoachProvider({ enabled: true, consent: true, endpoint, accessToken: TOKEN,
      warmupSessionId: fixture.warmupSessionId, routineSessionId: fixture.routineSessionId, timeoutMs: 3000,
      ...(options.protocol === 'A' ? {} : { protocol: 'intent-v2' as const, inputProjection: options.projection ?? 'question-scope' }),
      fetch: (input, init) => {
        const headers = new Headers(init?.headers); headers.set('Origin', ORIGIN)
        return fetch(input, { ...init, headers })
      }, ...options.providerOptions })
    const dispatchIntents: unknown[] = []
    const trackedDispatcher = { ...fixture.dispatcher,
      dispatch: (...args: Parameters<typeof fixture.dispatcher.dispatch>) => {
        dispatchIntents.push(args[0])
        return fixture.dispatcher.dispatch(...args)
      } }
    const agent = createCoachOrchestrator({ dispatcher: trackedDispatcher, provider, localEnabled: true, timeoutMs: 4000 })
    const localBridge = bridge
    return { ...fixture, agent, provider, endpoint, contexts, bodies, paths, responses, dispatchIntents,
      async close() { await Promise.all([close(localBridge), close(model)]) } }
  } catch (error) {
    if (bridge) await close(bridge)
    await close(model)
    throw error
  }
}
