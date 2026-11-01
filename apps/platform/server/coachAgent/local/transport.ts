import { request } from 'node:http'
import type { ResolvedLocalConfig } from './config.ts'

export class LocalCoachError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status = 502) { super(code); this.code = code; this.status = status }
}

/** Native HTTP to a literal IP: no DNS lookup, environment proxy, redirect or global fetch. */
export function localJson(config: ResolvedLocalConfig, path: '/api/tags' | '/api/show' | '/api/chat',
  body: string | undefined, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!['/api/tags', '/api/show', '/api/chat'].includes(path)) { reject(new LocalCoachError('LOCAL_TARGET_NOT_ALLOWED')); return }
    if (signal.aborted) { reject(new LocalCoachError('CANCELLED', 499)); return }
    const req = request({ hostname: '127.0.0.1', family: 4, port: config.modelPort, path,
      method: body === undefined ? 'GET' : 'POST', agent: false, signal,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      }) },
    }, res => {
      const fail = () => { res.destroy(); reject(new LocalCoachError('LOCAL_MODEL_UNAVAILABLE')) }
      if (res.statusCode !== 200 || !/^application\/json(?:\s*;.*)?$/iu.test(res.headers['content-type'] ?? '')
        || res.headers['content-encoding'] || (res.headers['content-length'] !== undefined
          && (!/^\d+$/u.test(res.headers['content-length']) || Number(res.headers['content-length']) > 65_536))) { fail(); return }
      const chunks: Buffer[] = []
      let bytes = 0
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 65_536) { fail(); return }
        chunks.push(chunk)
      })
      res.once('error', () => reject(new LocalCoachError('LOCAL_MODEL_UNAVAILABLE')))
      res.once('aborted', () => reject(new LocalCoachError('LOCAL_MODEL_UNAVAILABLE')))
      res.once('end', () => {
        try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))) }
        catch { reject(new LocalCoachError('INVALID_LOCAL_RESPONSE')) }
      })
    })
    req.once('error', () => reject(new LocalCoachError(signal.aborted ? 'CANCELLED' : 'LOCAL_MODEL_UNAVAILABLE')))
    req.end(body)
  })
}

function localRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LocalCoachError('LOCAL_MODEL_UNAVAILABLE')
  const record = value as Record<string, unknown>
  // Ollama's cloud aliases expose remote targets. Never accept these as local weights.
  if ('remote_host' in record || 'remote_model' in record || 'remote' in record) throw new LocalCoachError('LOCAL_MODEL_NOT_LOCAL')
  return record
}

/** Read-only installed-model verification. Never pulls, creates or loads a model. */
export async function verifyInstalledModel(config: ResolvedLocalConfig, signal: AbortSignal) {
  const raw = localRecord(await localJson(config, '/api/tags', undefined, signal))
  if (!Array.isArray(raw.models) || raw.models.length > 256) throw new LocalCoachError('LOCAL_MODEL_UNAVAILABLE')
  const matches = raw.models.filter(item => item && typeof item === 'object' && item.name === config.model).map(localRecord)
  if (matches.length !== 1) throw new LocalCoachError('LOCAL_MODEL_NOT_INSTALLED')
  const item = matches[0]
  if (typeof item.digest !== 'string' || item.digest.replace(/^sha256:/u, '') !== config.modelDigest
    || typeof item.size !== 'number' || item.size < 100_000_000 || item.size > 4_000_000_000) {
    throw new LocalCoachError('LOCAL_MODEL_IDENTITY_MISMATCH')
  }
  const shown = localRecord(await localJson(config, '/api/show', JSON.stringify({ model: config.model }), signal))
  const details = localRecord(shown.details)
  localRecord(shown.model_info)
  if (details.format !== 'gguf' || !['qwen2', 'qwen3'].includes(String(details.family))
    || typeof details.quantization_level !== 'string' || !/^Q4_/u.test(details.quantization_level)
    || !Array.isArray(shown.capabilities) || !shown.capabilities.includes('completion')) {
    throw new LocalCoachError('LOCAL_MODEL_NOT_LOCAL')
  }
  if (config.planningProtocol === 'native-tools' && !shown.capabilities.includes('tools')) {
    throw new LocalCoachError('LOCAL_TOOLS_NOT_SUPPORTED')
  }
}
