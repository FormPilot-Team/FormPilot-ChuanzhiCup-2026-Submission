import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import { createJevProxy } from '../server/jevProxy'
import { JevDecisionService } from '../server/JevDecisionService'
import { NORMAL_INPUT, mockAnswer } from '../src/features/adaptiveTraining/scenarios'

const servers: Server[] = []
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())) })
async function start(service: JevDecisionService, interval = 0) {
  const server = createJevProxy(service, interval)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  return `http://127.0.0.1:${address.port}`
}
describe('loopback server boundary', () => {
  it('real HTTP loopback returns health and honest no-key fallback', async () => {
    const url = await start(new JevDecisionService())
    expect(await (await fetch(`${url}/api/jev/health`)).json()).toEqual({ configured: false, model: 'jev-latest' })
    const response = await fetch(`${url}/api/jev/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(NORMAL_INPUT) })
    expect(await response.json()).toMatchObject({ source: 'rules', reason: 'not_configured' })
  })
  it('rejects foreign origins, non-JSON, invalid input and oversized bodies', async () => {
    const url = await start(new JevDecisionService())
    expect((await fetch(`${url}/api/jev/health`, { headers: { Origin: 'https://untrusted.example' } })).status).toBe(403)
    expect((await fetch(`${url}/api/jev/decision`, { method: 'POST', body: '{}' })).status).toBe(415)
    expect((await fetch(`${url}/api/jev/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400)
    expect((await fetch(`${url}/api/jev/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(9000) })).status).toBe(413)
  })
  it('sanitizes inputs and limits upstream calls even over HTTP', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ model: 'jev-test', answers: { intervention: mockAnswer('CONTINUE_STANDARD') }, usage: { input_tokens: 1, output_tokens: 1 }, secret: 'private' }))
    const url = await start(new JevDecisionService({ apiKey: 'never-client-readable', fetcher }), 10000)
    const call = () => fetch(`${url}/api/jev/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...NORMAL_INPUT, cameraImage: 'private', name: 'private' }) })
    const result = await (await call()).json()
    expect(result.source).toBe('jev')
    expect(JSON.stringify(result)).not.toMatch(/private|never-client-readable/)
    expect(fetcher.mock.calls[0][1]!.body).not.toContain('private')
    expect(await (await call()).json()).toMatchObject({ reason: 'rate_limited' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
