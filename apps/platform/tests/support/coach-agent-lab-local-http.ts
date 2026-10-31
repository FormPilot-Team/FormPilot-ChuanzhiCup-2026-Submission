import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLocalCoachServer } from '../../server/coachAgent/local/index.ts'
import { parseRemoteContext, type RemoteCoachContext } from '../../src/features/coachAgent/remoteProtocol.ts'

/** Deterministic planner fixture, never a real model or training-data source. */
function plan(context: RemoteCoachContext) {
  if (context.mode === 'insufficient') return { type: 'answer', mode: 'insufficient', evidenceRefs: [] }
  if (context.observations.length) return {
    type: 'answer', mode: context.mode,
    evidenceRefs: context.observations.filter(item => item.ok).flatMap(item => item.evidence.map(evidence => ({
      requestId: item.requestId, evidenceId: evidence.evidenceId,
    }))),
  }
  const routine = context.mode === 'routine'
  const sessionId = routine ? context.scope.routineSessionId : context.scope.warmupSessionId
  if (!sessionId) return { type: 'answer', mode: 'insufficient', evidenceRefs: [] }
  return { type: 'tools', calls: [{
    tool: context.mode === 'history' ? 'read_history' : 'read_scoring_evidence',
    query: { kind: routine ? 'routine' : 'warmup', sessionId,
      subject: routine ? { kind: 'routine', id: 'baduanjin' } : { kind: 'exercise', id: 'squat' },
      ...(context.mode === 'history' ? { limit: context.scope.historyLimit } : {}),
    },
  }] }
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  return (server.address() as AddressInfo).port
}

async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

/** Exercises the real Local bridge over HTTP without touching Ollama, weights or cloud APIs. */
export async function startFakeLocalCoachLab(options: { bootstrapToken: string; origin?: string; port?: number }) {
  const modelName = 'qwen2.5:0.5b-instruct-q4_K_M'
  const modelDigest = 'a'.repeat(64)
  let modelRequests = 0
  const contexts: RemoteCoachContext[] = []
  const model = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    try {
      if (request.method === 'GET' && request.url === '/api/tags') {
        response.end(JSON.stringify({ models: [{ name: modelName, digest: modelDigest, size: 398_000_000 }] }))
        return
      }
      if (request.method !== 'POST' || !['/api/show', '/api/chat'].includes(request.url ?? '')) {
        response.writeHead(404); response.end('{}'); return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 65_536) { response.writeHead(413); response.end('{}'); return }
        chunks.push(Buffer.from(chunk))
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model: string; messages: Array<{ content: string }> }
      if (payload.model !== modelName) { response.writeHead(400); response.end('{}'); return }
      if (request.url === '/api/show') {
        response.end(JSON.stringify({ details: { format: 'gguf', family: 'qwen2', quantization_level: 'Q4_K_M' },
          model_info: {}, capabilities: ['completion'] }))
        return
      }
      const context = parseRemoteContext(JSON.parse(payload.messages.at(-1)!.content))
      contexts.push(context)
      modelRequests += 1
      response.end(JSON.stringify({ done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(plan(context)) },
        prompt_eval_count: 1, eval_count: 1 }))
    } catch { response.writeHead(400); response.end('{}') }
  })
  const modelPort = await listen(model, 0)
  let bridge: Server | undefined
  try {
    bridge = createLocalCoachServer({ enabled: true, resourcesConfirmed: true, accessToken: options.bootstrapToken,
      origin: options.origin ?? 'http://127.0.0.1:5173', model: modelName, modelDigest, testModelPort: modelPort,
      requestsPerMinute: 30, maxRequests: 30, totalTokenBudget: 200_000 })
    const port = await listen(bridge, options.port ?? 4320)
    const localBridge = bridge
    return { endpoint: `http://127.0.0.1:${port}/v1/coach/local/step`,
      getModelRequests: () => modelRequests,
      getContexts: (): readonly RemoteCoachContext[] => contexts,
      async stop() { await Promise.all([close(localBridge), close(model)]); contexts.length = 0 },
    }
  } catch (error) {
    if (bridge?.listening) await close(bridge)
    await close(model)
    throw error
  }
}
