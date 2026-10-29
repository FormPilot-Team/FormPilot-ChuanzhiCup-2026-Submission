import { createServer, type IncomingMessage } from 'node:http'
import { pathToFileURL } from 'node:url'
import { JevDecisionService } from './JevDecisionService.ts'
import { parseTrainingInput } from '../src/features/adaptiveTraining/protocol.ts'
import { ruleBaseline } from '../src/features/adaptiveTraining/decisionPolicy.ts'

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])
function localRequest(req: IncomingMessage): boolean {
  try {
    if (!loopback.has(new URL(`http://${req.headers.host}`).hostname)) return false
    return !req.headers.origin || loopback.has(new URL(req.headers.origin).hostname)
  } catch { return false }
}

export function createJevProxy(service = new JevDecisionService(), minIntervalMs = 10000) {
  let lastStarted = -Infinity
  let retryAfter = -Infinity
  let inFlight = false
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const reply = (status: number, data: unknown) => { if (!res.destroyed) { res.writeHead(status); res.end(JSON.stringify(data)) } }
    if (!localRequest(req)) { reply(403, { error: 'local_only' }); return }
    if (req.method === 'GET' && req.url === '/api/jev/health') { reply(200, { configured: service.configured(), model: 'jev-latest' }); return }
    if (req.url !== '/api/jev/decision') { reply(404, { error: 'not_found' }); return }
    if (req.method !== 'POST') { reply(405, { error: 'method_not_allowed' }); return }
    if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'json_required' }); return }
    let input
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk.toString()
        if (Buffer.byteLength(body) > 8192) { reply(413, { error: 'summary_too_large' }); return }
      }
      input = parseTrainingInput(JSON.parse(body))
    } catch { reply(400, { error: 'invalid_summary' }); return }
    if (!service.configured()) { reply(200, ruleBaseline('not_configured')); return }
    const now = performance.now()
    if (inFlight || now < retryAfter || now - lastStarted < minIntervalMs) { reply(200, ruleBaseline('rate_limited')); return }
    inFlight = true
    lastStarted = now
    const controller = new AbortController()
    const cancel = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', cancel)
    try {
      const decision = await service.decide(input, controller.signal)
      if (decision.source === 'rules' && decision.reason !== 'safety_guard') retryAfter = performance.now() + 30000
      reply(200, decision)
    } finally {
      inFlight = false
      res.off('close', cancel)
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('Paid API proxy is disabled for this competition. Use npm run competition:dev for the offline local engine.')
  process.exitCode = 1
}
