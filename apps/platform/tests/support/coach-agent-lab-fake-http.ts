import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import { createCoachAgentServer } from '../../server/coachAgent/server.ts'
import { parseRemoteContext, type RemoteCoachContext } from '../../src/features/coachAgent/remoteProtocol.ts'

/** A deterministic HTTP fixture. It cannot reach a real model or browser storage. */
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

/** Only trusted test code or a local operator supplies the in-memory bootstrap. */
export async function startFakeCoachLab(options: { bootstrapToken: string; origin?: string; port?: number }) {
  const modelKey = randomBytes(32).toString('base64url')
  let modelRequests = 0
  const contexts: RemoteCoachContext[] = []
  const model = createServer(async (request, response) => {
    try {
      if (request.url !== '/v1/chat/completions' || request.method !== 'POST'
        || request.headers.authorization !== `Bearer ${modelKey}`) { response.writeHead(403); response.end(); return }
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 65_536) { response.writeHead(413); response.end(); return }
        chunks.push(Buffer.from(chunk))
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages: Array<{ content: string }> }
      const context = parseRemoteContext(JSON.parse(payload.messages.at(-1)!.content))
      modelRequests += 1
      contexts.push(context)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan(context)) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    } catch { response.writeHead(400); response.end() }
  })
  const modelPort = await listen(model, 0)
  let proxy: Server | undefined
  try {
    proxy = createCoachAgentServer({
      enabled: true, apiKey: modelKey, accessToken: options.bootstrapToken,
      model: 'FAKE_REMOTE_TEST', modelUrl: `http://127.0.0.1:${modelPort}/v1/chat/completions`,
      allowedModelHosts: ['127.0.0.1'], allowLoopbackModelForTests: true,
      origin: options.origin ?? 'http://127.0.0.1:5173',
      requestsPerMinute: 30, maxRequests: 30, totalTokenBudget: 200_000,
      budgetMicroUsd: 1_000_000, inputPriceMicroUsdPerMillionTokens: 1, outputPriceMicroUsdPerMillionTokens: 1,
    })
    const port = await listen(proxy, options.port ?? 4319)
    const proxyServer = proxy
    return { endpoint: `http://127.0.0.1:${port}/v1/coach/step`,
      getModelRequests: () => modelRequests,
      getContexts: (): readonly RemoteCoachContext[] => contexts,
      async stop() { await Promise.all([close(proxyServer), close(model)]); contexts.length = 0 },
    }
  } catch (error) {
    if (proxy?.listening) await close(proxy)
    await close(model)
    throw error
  }
}

/** No echo, command-line argument, environment secret, clipboard or log output. */
async function readBootstrap(): Promise<string> {
  if (!process.stdin.isTTY) {
    let text = ''
    for await (const chunk of process.stdin) {
      text += chunk.toString()
      if (text.length > 258) throw new Error('Invalid bootstrap')
    }
    return text.trim()
  }
  process.stdout.write('输入本次 Fake HTTP 演示的 bootstrap（32–256 位 base64url，不回显）：')
  return new Promise((resolve, reject) => {
    let text = ''
    const finish = (cancelled: boolean) => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      if (cancelled) reject(new Error('Cancelled'))
      else resolve(text)
      text = ''
    }
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') { finish(true); return }
        if (character === '\r' || character === '\n') { finish(false); return }
        if (character === '\u007f' || character === '\b') text = text.slice(0, -1)
        else if (text.length < 256 && /^[A-Za-z0-9_-]$/u.test(character)) text += character
      }
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bootstrapToken = await readBootstrap()
    if (!/^[A-Za-z0-9_-]{32,256}$/u.test(bootstrapToken)) throw new Error('Invalid bootstrap')
    const demo = await startFakeCoachLab({ bootstrapToken })
    console.log(`FAKE_REMOTE_TEST: ${demo.endpoint}`)
    console.log('仅本机确定性假模型，无付费调用。Lab 中选择 Remote，并粘贴刚才的 bootstrap；令牌不会被打印或持久化。')
    const stop = () => { void demo.stop().then(() => { process.exitCode = 0 }) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  } catch {
    console.error('Fake HTTP 演示未启动：检查 bootstrap 格式或本机端口。')
    process.exitCode = 1
  }
}
