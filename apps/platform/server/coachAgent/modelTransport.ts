import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import type { ResolvedCoachAgentConfig } from './config.ts'

export class CoachAgentServerError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status = 502) { super(code); this.code = code; this.status = status }
}

export interface ModelRequest {
  config: ResolvedCoachAgentConfig
  body: string
  signal: AbortSignal
}
export interface CoachAgentServerDependencies {
  resolveHost?: (hostname: string) => Promise<LookupAddress[]>
  /** Trusted test/application injection; never derived from request data. */
  requestModel?: (request: ModelRequest) => Promise<unknown>
  now?: () => number
}

function publicIPv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b, c] = octets
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)
    && !(a === 192 && b === 0) && !(a === 192 && b === 2)
    && !(a === 192 && b === 88 && c === 99)
    && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113)
}

/** Conservative: IPv6 accepts global-unicast 2000::/3 except special-use ranges. */
export function isPublicModelAddress(address: string): boolean {
  if (isIP(address) === 4) return publicIPv4(address)
  if (isIP(address) !== 6) return false
  const lower = address.toLowerCase()
  if (!/^[23][0-9a-f]{3}:/u.test(lower)) return false
  const [first, second = ''] = lower.split(':')
  return !(first === '2001' && (Number.parseInt(second || '0', 16) < 0x200 || Number.parseInt(second, 16) === 0xdb8))
    && !lower.startsWith('2002:') && !lower.startsWith('3fff:')
}

export async function requestChatCompletion(request: ModelRequest,
  resolveHost: (hostname: string) => Promise<LookupAddress[]> = hostname => lookup(hostname, { all: true, verbatim: true })): Promise<unknown> {
  const { config, body, signal } = request
  const url = config.modelUrl
  if (!url) throw new CoachAgentServerError('NOT_CONFIGURED', 503)
  const testLoopback = config.allowLoopbackModelForTests && url.protocol === 'http:' && url.hostname === '127.0.0.1'
  const literalFamily = isIP(url.hostname)
  let addresses: LookupAddress[]
  try {
    addresses = testLoopback ? [{ address: '127.0.0.1', family: 4 }]
      : literalFamily ? [{ address: url.hostname, family: literalFamily }] : await resolveHost(url.hostname)
  } catch { throw new CoachAgentServerError('TARGET_NOT_ALLOWED') }
  if (signal.aborted) throw new CoachAgentServerError('CANCELLED', 499)
  if (!addresses.length || addresses.some(item => !testLoopback && !isPublicModelAddress(item.address))) {
    throw new CoachAgentServerError('TARGET_NOT_ALLOWED')
  }
  // Resolve once, validate every result, and pin the connection. There is no second DNS lookup.
  const pinned = addresses[0]
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      method: 'POST', agent: false, signal,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, _options, callback) => {
        if (_options.all) callback(null, [{ address: pinned.address, family: pinned.family }])
        else callback(null, pinned.address, pinned.family)
      },
    }
    const req = (testLoopback ? httpRequest : httpsRequest)(url, options, response => {
      const fail = (code: string) => {
        response.destroy()
        reject(new CoachAgentServerError(code))
      }
      // No redirects, decompression, error bodies or upstream diagnostic text cross this boundary.
      if (response.statusCode !== 200) { fail(response.statusCode === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_FAILURE'); return }
      if (!/^application\/json(?:\s*;|$)/iu.test(response.headers['content-type'] ?? '')
        || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        fail('INVALID_MODEL_RESPONSE'); return
      }
      const length = response.headers['content-length']
      if (length && (!/^\d+$/u.test(length) || Number(length) > config.maxResponseBytes)) { fail('MODEL_RESPONSE_TOO_LARGE'); return }
      const chunks: Buffer[] = []
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > config.maxResponseBytes) { fail('MODEL_RESPONSE_TOO_LARGE'); return }
        chunks.push(chunk)
      })
      response.once('error', () => reject(new CoachAgentServerError(signal.aborted ? 'CANCELLED' : 'UPSTREAM_FAILURE')))
      response.once('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { reject(new CoachAgentServerError('INVALID_MODEL_RESPONSE')) }
      })
    })
    req.once('error', () => reject(new CoachAgentServerError(signal.aborted ? 'CANCELLED' : 'UPSTREAM_FAILURE')))
    req.end(body)
  })
}
