import { classifyCoachQuestion, type CoachProvider, type ProviderContext } from './provider.ts'
import { boundedId, parseToolIntent, plainFields } from './toolQuery.ts'
import { parseRemoteContext, validateRemoteStep, REMOTE_CONTEXT_MAX_BYTES, REMOTE_STEP_MAX_BYTES,
  REMOTE_PROBLEM_CODES, type RemoteCoachContext } from './remoteProtocol.ts'
import { minimizeCoachQuestion, parseLocalPlanContext, validateLocalPlanCandidate, type LocalInputProjection, type LocalPlanContext } from './localProtocolV2.ts'

export interface AdmittedLocalCoachProvider extends CoachProvider {
  /** Trusted composition only: a previously admitted context may narrow, never expand, configured scope. */
  nextAdmitted(context: LocalPlanContext, options: { signal: AbortSignal }): Promise<unknown>
}

export interface LocalCoachProviderOptions {
  /** These are trusted application decisions, never values from a prompt or model. */
  enabled?: boolean
  consent?: boolean
  endpoint: string
  /** Single-use local bootstrap capability, held in memory; NEVER the model API Key. */
  accessToken: string
  warmupSessionId?: string
  routineSessionId?: string
  historyLimit?: number
  protocol?: 'provider-step-v1' | 'intent-v2'
  inputProjection?: LocalInputProjection
  timeoutMs?: number
  /** Dependency injection for tests or a trusted application transport. */
  fetch?: typeof globalThis.fetch
}

function endpoint(value: string): string {
  const url = new URL(value)
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/v1\/coach\/local\/step$/u.test(value)
    || !url.port || Number(url.port) > 65535 || url.href !== value) throw new Error('Invalid local bridge endpoint')
  return value
}

function projection(context: ProviderContext, options: LocalCoachProviderOptions) {
  const sessions = new Map<string, string>()
  const requests = new Map<string, string>()
  const evidences = new Map<string, string>()
  const sessionOriginals = new Map<string, string>()
  const requestOriginals = new Map<string, string>()
  const evidenceOriginals = new Map<string, string>()
  const session = (kind: 'warmup' | 'routine', id: string) => {
    const key = `${kind}\u0000${id}`
    if (!sessions.has(key)) {
      const alias = `s${sessions.size + 1}`
      sessions.set(key, alias); sessionOriginals.set(alias, id)
    }
    return sessions.get(key)!
  }
  const scope: RemoteCoachContext['scope'] = { historyLimit: options.historyLimit ?? 3 }
  if (options.warmupSessionId) scope.warmupSessionId = session('warmup', options.warmupSessionId)
  if (options.routineSessionId) scope.routineSessionId = session('routine', options.routineSessionId)
  const wire = parseRemoteContext({ mode: classifyCoachQuestion(context.question), remainingCalls: context.remainingCalls, scope,
    observations: context.observations.map(observation => {
      const requestId = `r${requests.size + 1}`
      requests.set(observation.requestId, requestId); requestOriginals.set(requestId, observation.requestId)
      return { requestId, tool: observation.tool, ok: observation.ok,
        problemCode: observation.problemCode === null ? null : REMOTE_PROBLEM_CODES.includes(observation.problemCode as typeof REMOTE_PROBLEM_CODES[number])
          ? observation.problemCode : 'UNAVAILABLE',
        comparisonGate: observation.comparisonGate, evidence: observation.evidence.map(evidence => {
          const evidenceId = `e${evidences.size + 1}`
          evidences.set(`${observation.requestId}\u0000${evidence.evidenceId}`, evidenceId)
          evidenceOriginals.set(evidenceId, evidence.evidenceId)
          return { evidenceId, sessionId: session(evidence.subject.kind === 'exercise' ? 'warmup' : 'routine', evidence.sessionId),
            subject: { kind: evidence.subject.kind, id: evidence.subject.id }, scoreKind: evidence.scoreKind }
        }) }
    }) })
  return { wire, decode(value: unknown) {
    const step = validateRemoteStep(value, wire)
    if (step.type === 'answer') return { ...step, evidenceRefs: step.evidenceRefs.map(ref => ({
      requestId: requestOriginals.get(ref.requestId)!, evidenceId: evidenceOriginals.get(ref.evidenceId)!,
    })) }
    return { type: 'tools', calls: step.calls.map(call => {
      const intent = parseToolIntent(call)!
      if (intent.query.sessionId) intent.query.sessionId = sessionOriginals.get(intent.query.sessionId)!
      // Decoding still goes through the original application-side tool grammar.
      const parsed = parseToolIntent(intent)
      if (!parsed) throw new Error('INVALID_PROVIDER_OUTPUT')
      return parsed
    }) }
  } }
}

function planProjection(context: ProviderContext, options: LocalCoachProviderOptions, admitted?: LocalPlanContext) {
  const inputProjection = options.inputProjection ?? 'question-scope'
  const wire = parseLocalPlanContext(admitted ?? { protocol: 'coach-plan-v2', inputProjection,
    ...(inputProjection === 'structured' ? { mode: classifyCoachQuestion(context.question) }
      : { question: minimizeCoachQuestion(context.question) }),
    scope: { warmup: !!options.warmupSessionId, routine: !!options.routineSessionId, historyLimit: options.historyLimit ?? 3 },
    remainingCalls: context.remainingCalls })
  if (admitted && ((wire.inputProjection === 'question-scope' && wire.question !== context.question)
    || (wire.scope.warmup && !options.warmupSessionId) || (wire.scope.routine && !options.routineSessionId)
    || wire.scope.historyLimit > (options.historyLimit ?? 3) || wire.remainingCalls > context.remainingCalls)) {
    throw new Error('INVALID_ADMITTED_SCOPE')
  }
  return { wire, decode(value: unknown) {
    const candidate = validateLocalPlanCandidate(value, wire)
    if (candidate.intent === 'insufficient') return { type: 'plan', mode: 'insufficient', calls: [] }
    const routine = candidate.intent === 'routine'
    const intent = parseToolIntent({ tool: candidate.tool, query: {
      kind: routine ? 'routine' : 'warmup', sessionId: routine ? options.routineSessionId : options.warmupSessionId,
      subject: routine ? { kind: 'routine', id: 'baduanjin' } : { kind: 'exercise', id: 'squat' },
      ...(candidate.intent === 'history' ? { limit: candidate.limit } : {}),
    } })
    if (!intent) throw new Error('INVALID_PROVIDER_OUTPUT')
    return { type: 'plan', mode: candidate.intent, calls: [intent] }
  } }
}

async function responseValue(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected || !/^application\/json(?:\s*;.*)?$/iu.test(response.headers.get('content-type') ?? '')) {
    throw new Error('LOCAL_PROVIDER_FAILURE')
  }
  const length = response.headers.get('content-length')
  if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > REMOTE_STEP_MAX_BYTES)) throw new Error('LOCAL_PROVIDER_FAILURE')
  if (!response.body) throw new Error('LOCAL_PROVIDER_FAILURE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > REMOTE_STEP_MAX_BYTES) throw new Error('LOCAL_PROVIDER_FAILURE')
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
}

/** Independent loopback-only provider. Shares only the historical minimal wire grammar.
 * No network, storage, API credentials or model downloads occur during construction. */
export function createLocalCoachProvider(input: LocalCoachProviderOptions): AdmittedLocalCoachProvider {
  const options = Object.freeze({ ...input })
  const url = endpoint(options.endpoint)
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(options.accessToken)
    || (options.warmupSessionId !== undefined && !boundedId(options.warmupSessionId))
    || (options.routineSessionId !== undefined && !boundedId(options.routineSessionId))
    || (options.protocol !== undefined && !['provider-step-v1', 'intent-v2'].includes(options.protocol))
    || (options.inputProjection !== undefined && !['structured', 'question-scope'].includes(options.inputProjection))
    || (options.inputProjection !== undefined && options.protocol !== 'intent-v2')) throw new Error('Invalid local bridge configuration')
  const historyLimit = options.historyLimit ?? 3
  const timeoutMs = options.timeoutMs ?? 5_000
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 64
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid local bridge budget')
  const fetchModel = options.fetch ?? globalThis.fetch
  let sessionPromise: Promise<{ token: string; expiresAt: number }> | undefined
  const exchange = (signal: AbortSignal) => {
    // One attempt per provider instance. Failure, cancellation or an expired session
    // requires a new, explicitly provisioned prototype session; no silent retries.
    sessionPromise ??= (async () => {
      const response = await fetchModel(url.replace(/\/step$/u, '/session'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.accessToken}` },
        body: '{}', signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      })
      const raw = await responseValue(response)
      if (signal.aborted) throw new Error('LOCAL_PROVIDER_FAILURE')
      const value = plainFields(raw, ['sessionToken', 'expiresInMs'])
      if (Object.keys(value).length !== 2 || typeof value.sessionToken !== 'string'
        || !/^[A-Za-z0-9_-]{32,256}$/u.test(value.sessionToken) || !Number.isSafeInteger(value.expiresInMs)
        || (value.expiresInMs as number) < 1 || (value.expiresInMs as number) > 300_000) throw new Error('LOCAL_PROVIDER_FAILURE')
      return { token: value.sessionToken, expiresAt: performance.now() + (value.expiresInMs as number) }
    })()
    return sessionPromise
  }
  const next = (context: ProviderContext, lifetime: { signal: AbortSignal }, admitted?: LocalPlanContext): Promise<unknown> => {
      if (options.enabled !== true || options.consent !== true || lifetime.signal.aborted) return Promise.reject(new Error('LOCAL_NOT_ENABLED'))
      const projected = options.protocol === 'intent-v2' ? planProjection(context, options, admitted) : projection(context, options)
      const body = JSON.stringify(projected.wire)
      if (new TextEncoder().encode(body).byteLength > REMOTE_CONTEXT_MAX_BYTES) return Promise.reject(new Error('LOCAL_CONTEXT_TOO_LARGE'))
      return new Promise((resolve, reject) => {
        const controller = new AbortController()
        const deadline = performance.now() + timeoutMs
        let settled = false
        const finish = (ok: boolean, value?: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          lifetime.signal.removeEventListener('abort', cancel)
          if (ok && !lifetime.signal.aborted && performance.now() < deadline) resolve(value)
          else { controller.abort(); reject(new Error('LOCAL_PROVIDER_FAILURE')) }
        }
        const cancel = () => finish(false)
        const timer = setTimeout(cancel, timeoutMs)
        lifetime.signal.addEventListener('abort', cancel, { once: true })
        const work = async () => {
          const session = await exchange(controller.signal)
          if (settled) return
          if (lifetime.signal.aborted || performance.now() >= deadline) { finish(false); return }
          if (performance.now() >= session.expiresAt) throw new Error('LOCAL_PROVIDER_FAILURE')
          const response = await fetchModel(url, { method: 'POST', headers: {
            'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`,
          }, body, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
          const raw = await responseValue(response)
          if (!settled) finish(true, projected.decode(raw))
        }
        void work().catch(() => finish(false))
      })
  }
  return Object.freeze({ kind: 'local' as const, id: options.protocol === 'intent-v2' ? 'local-coach-ollama-v2' : 'local-coach-ollama-v1',
    ...(options.protocol === 'intent-v2' ? { protocol: 'intent-v2' as const } : {}), next,
    nextAdmitted(context: LocalPlanContext, lifetime: { signal: AbortSignal }): Promise<unknown> {
      if (options.protocol !== 'intent-v2') return Promise.reject(new Error('TRUSTED_LOCAL_V2_REQUIRED'))
      const wire = parseLocalPlanContext(context)
      return next({ question: wire.question ?? '', observations: [], remainingCalls: wire.remainingCalls }, lifetime, wire)
    },
  })
}
