import { createCoachSessionReader } from '../sessionReader'
import { createCoachToolDispatcher } from '../dispatcher'
import { createCoachOrchestrator } from '../orchestrator'
import { createMockCoachProvider } from '../mockProvider'
import { createRemoteCoachProvider } from '../remoteProvider'
import { classifyCoachQuestion, freezeCoachValue, type CoachProvider } from '../provider'
import type { DispatchReceipt, CoachToolDispatcher } from '../dispatchTypes'
import type { SessionSnapshot } from '../readerTypes'
import { createLabSyntheticFixture } from './fixtures'
import type {
  CoachLabController, CoachLabDependencies, CoachLabState, LabProblem, LabProviderConfiguration, LabSession,
} from './types'

export const LAB_QUESTIONS = Object.freeze({
  explain: '为什么我这次深蹲评分不高？',
  history: '我最近几次深蹲有没有进步？',
  routine: '我最近的八段锦跟练表现如何？',
})

const MESSAGES: Record<string, string> = {
  PERMISSION_DENIED: '未获得本地只读授权，未读取训练记录。',
  INVALID_SESSION: '请从已读取的记录列表选择当前 Session，不能通过问题追加授权。',
  EMPTY_HISTORY: '当前浏览器没有此类训练记录。可以返回合成演示，或完成训练后重新读取。',
  CORRUPT: '本机记录损坏，不能将读取失败解释为空历史。请在原训练应用处理数据。',
  UNSUPPORTED_VERSION: '当前记录版本暂不支持，未套用其他版本评分。',
  UNAVAILABLE: '本机存储暂时不可用，未取得训练记录。',
  INSUFFICIENT_DATA: '有效评分证据不足。',
  INVALID_INPUT: '请输入 1–4096 字的训练问题。',
  UNSUPPORTED_QUESTION: '当前仅支持深蹲低分、最近深蹲比较和八段锦跟练这三类问题。',
  QUESTION_SCOPE: '问题与当前记录类型不匹配，请切换热身或功法记录。',
  REMOTE_DISABLED: 'Remote 默认关闭。请分别同意最小数据披露与可能付费调用，再配置本机连接。',
  REMOTE_NOT_CONFIGURED: '尚未配置可信本机连接。未发起远程规划。',
  REMOTE_CONFIGURATION: '本机连接配置无效。只接受 127.0.0.1 的独立代理地址与一次性本机令牌。',
  REMOTE_PROVIDER_MISMATCH: '规划模式与可信 Provider 不匹配，未采用返回结果。',
  CANCELLED: '任务已取消，未采用迟到结果。',
  TIMEOUT: '任务已超时，未采用迟到结果。',
  PROVIDER_FAILURE: '远端规划未完成，服务可能不可用、授权已过期或预算受限。没有自动重试。',
  INVALID_PROVIDER_OUTPUT: '模型输出未通过校验，未采用不可信内容。',
  INVALID_EVIDENCE_REFERENCE: '证据引用未通过本地校验，未采用模型返回的引用。',
  LAB_FAILURE: '本次实验未完成，未取得可信答复。',
}

function issue(code: string): LabProblem {
  return { code, message: MESSAGES[code] ?? '调用未完成，请查看工具状态及数据限制。' }
}

function sessionOption(snapshot: SessionSnapshot): LabSession {
  const summary = snapshot.summary
  return { id: summary.sessionId, kind: summary.kind, source: summary.provenance.source,
    mode: summary.provenance.mode, startedAt: summary.startedAt.value, evidenceCount: summary.evidence.length,
    scoreKinds: [...new Set(summary.evidence.map(item => item.score.scoreKind))],
    versions: [...new Set(summary.evidence.flatMap(item => [item.score.scoringVersion,
      item.score.rulesVersion?.spec, item.score.rulesVersion?.threshold].filter((value): value is string => typeof value === 'string')))],
    limitations: [...snapshot.limitations] }
}

/** Trusted browser composition. It has no storage write capability and never exposes credentials in state. */
export function createCoachLabController(dependencies: CoachLabDependencies = {}): CoachLabController {
  const synthetic = createLabSyntheticFixture()
  const now = dependencies.now ?? (() => Date.now())
  const timeoutMs = dependencies.timeoutMs ?? 10_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid Lab timeout')
  const listeners = new Set<() => void>()
  let disposed = false
  let generation = 0
  let pending: AbortController | undefined
  let remoteProvider: CoachProvider | undefined
  let state: CoachLabState = freezeCoachValue({
    mode: 'mock', dataSource: 'synthetic', kind: 'warmup', sessions: [], currentSessionId: null,
    allowedSessionIds: [], localConsent: false, disclosureConsent: false, paidConsent: false,
    remoteConfigured: false, question: LAB_QUESTIONS.explain, status: 'idle', result: null,
    comparisons: [], problem: null, localLoaded: false,
  })

  const update = (patch: Partial<CoachLabState>) => {
    if (disposed) return
    state = freezeCoachValue({ ...state, ...patch })
    for (const listener of listeners) listener()
  }
  const stop = () => {
    generation += 1
    pending?.abort()
    pending = undefined
  }
  const invalidate = (remote = false) => {
    stop()
    if (remote) remoteProvider = undefined
    update({ result: null, comparisons: [], problem: null, status: state.sessions.length ? 'ready' : 'idle',
      ...(remote ? { remoteConfigured: false, disclosureConsent: false, paidConsent: false } : {}) })
  }
  const deny = (code: string) => {
    stop()
    update({ status: 'failed', problem: issue(code), result: null, comparisons: [] })
  }
  const reader = () => createCoachSessionReader({
    now: state.dataSource === 'synthetic' ? synthetic.now : now,
    storage: state.dataSource === 'synthetic' ? synthetic.storage : {
      getItem(key: string) {
        if (!state.localConsent || state.dataSource !== 'local') throw new DOMException('Read not authorized', 'SecurityError')
        if (!dependencies.getLocalStorage) throw new Error('Storage unavailable')
        return dependencies.getLocalStorage().getItem(key)
      },
    },
  })
  const loadSynthetic = () => {
    const history = reader().readHistory({ kind: state.kind, limit: 64 })
    if (!history.ok) { deny(history.error.code); return }
    const sessions = history.data.sessions.map(sessionOption)
    update({ sessions, currentSessionId: sessions[0]?.id ?? null,
      allowedSessionIds: sessions.map(item => item.id), status: 'ready', problem: null, localLoaded: false })
  }
  const providerFor = (configuration: LabProviderConfiguration): CoachProvider => {
    if (dependencies.providerFactory) return dependencies.providerFactory(configuration)
    const selected = configuration.kind === 'warmup' ? { warmupSessionId: configuration.sessionId } : { routineSessionId: configuration.sessionId }
    return configuration.mode === 'mock'
      ? createMockCoachProvider({ ...selected, historyLimit: configuration.historyLimit })
      : createRemoteCoachProvider({ ...selected, enabled: true, consent: true,
        endpoint: configuration.remote!.endpoint, accessToken: configuration.remote!.bootstrapToken,
        historyLimit: configuration.historyLimit, timeoutMs })
  }

  loadSynthetic()
  return Object.freeze<CoachLabController>({
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    setMode(mode) {
      if (disposed || !['mock', 'remote'].includes(mode) || mode === state.mode) return
      invalidate(true)
      update({ mode })
    },
    setDataSource(dataSource) {
      if (disposed || !['synthetic', 'local'].includes(dataSource) || dataSource === state.dataSource) return
      invalidate(true)
      update({ dataSource, localConsent: false, sessions: [], currentSessionId: null, allowedSessionIds: [],
        localLoaded: false, status: 'idle' })
      if (dataSource === 'synthetic') loadSynthetic()
    },
    setKind(kind) {
      if (disposed || !['warmup', 'routine'].includes(kind) || kind === state.kind) return
      invalidate(true)
      update({ kind, sessions: [], currentSessionId: null, allowedSessionIds: [], localLoaded: false,
        status: 'idle', question: kind === 'routine' ? LAB_QUESTIONS.routine : LAB_QUESTIONS.explain })
      if (state.dataSource === 'synthetic') loadSynthetic()
    },
    setLocalConsent(consent) {
      if (disposed || consent === state.localConsent) return
      invalidate(true)
      update({ localConsent: consent, ...(consent ? {} : {
        sessions: state.dataSource === 'local' ? [] : state.sessions,
        currentSessionId: state.dataSource === 'local' ? null : state.currentSessionId,
        allowedSessionIds: state.dataSource === 'local' ? [] : state.allowedSessionIds,
        localLoaded: false, status: state.dataSource === 'local' ? 'idle' : 'ready',
      }) })
    },
    loadLocalSessions() {
      if (disposed) return
      if (state.dataSource !== 'local' || !state.localConsent) { deny('PERMISSION_DENIED'); return }
      invalidate(true)
      const history = reader().readHistory({ kind: state.kind, limit: 64 })
      if (!history.ok) { update({ sessions: [], currentSessionId: null, allowedSessionIds: [], localLoaded: false }); deny(history.error.code); return }
      const sessions = history.data.sessions.map(sessionOption)
      update({ sessions, currentSessionId: null, allowedSessionIds: [], localLoaded: true,
        status: sessions.length ? 'ready' : 'insufficient', problem: sessions.length ? null : issue('EMPTY_HISTORY') })
    },
    selectCurrentSession(sessionId) {
      if (disposed) return
      invalidate(true)
      if (sessionId === null) { update({ currentSessionId: null }); return }
      if (!state.sessions.some(item => item.id === sessionId)
        || (state.dataSource === 'local' && (!state.localConsent || !state.localLoaded))) {
        update({ currentSessionId: null, allowedSessionIds: [] }); deny('INVALID_SESSION'); return
      }
      update({ currentSessionId: sessionId, allowedSessionIds: [...new Set([...state.allowedSessionIds, sessionId])] })
    },
    setAllowedSessions(sessionIds) {
      if (disposed) return
      invalidate(true)
      if (!Array.isArray(sessionIds) || sessionIds.length > 64
        || sessionIds.some(id => !state.sessions.some(item => item.id === id))
        || new Set(sessionIds).size !== sessionIds.length
        || (state.dataSource === 'local' && (!state.localConsent || !state.localLoaded))) {
        update({ allowedSessionIds: [] }); deny('INVALID_SESSION'); return
      }
      update({ allowedSessionIds: [...sessionIds] })
    },
    setQuestion(question) {
      if (disposed || question === state.question) return
      invalidate()
      update({ question })
    },
    setDisclosureConsent(consent) {
      if (disposed || consent === state.disclosureConsent) return
      if (!consent) { invalidate(true); return }
      invalidate()
      update({ disclosureConsent: true })
    },
    setPaidConsent(consent) {
      if (disposed || consent === state.paidConsent) return
      if (!consent) { invalidate(true); return }
      invalidate()
      update({ paidConsent: true })
    },
    configureRemote(configuration) {
      if (disposed) return false
      invalidate()
      remoteProvider = undefined
      update({ remoteConfigured: false })
      if (state.mode !== 'remote' || !state.disclosureConsent || !state.paidConsent) { deny('REMOTE_DISABLED'); return false }
      if (!state.currentSessionId || !state.allowedSessionIds.includes(state.currentSessionId)) { deny('INVALID_SESSION'); return false }
      try {
        // Validate even an injected provider's connection settings. Construction performs no network.
        createRemoteCoachProvider({ endpoint: configuration.endpoint, accessToken: configuration.bootstrapToken })
        remoteProvider = providerFor({ mode: 'remote', kind: state.kind, sessionId: state.currentSessionId,
          historyLimit: 3, remote: { endpoint: configuration.endpoint, bootstrapToken: configuration.bootstrapToken } })
        if (remoteProvider.kind !== 'remote') throw new Error('Invalid Provider')
        update({ remoteConfigured: true, status: 'ready' })
        return true
      } catch { remoteProvider = undefined; deny('REMOTE_CONFIGURATION'); return false }
    },
    async run() {
      if (disposed || pending) return
      if (state.dataSource === 'local' && (!state.localConsent || !state.localLoaded)) { deny('PERMISSION_DENIED'); return }
      if (!state.currentSessionId || !state.allowedSessionIds.includes(state.currentSessionId)) { deny('INVALID_SESSION'); return }
      if (typeof state.question !== 'string' || !state.question.trim() || state.question.length > 4096) { deny('INVALID_INPUT'); return }
      const questionMode = classifyCoachQuestion(state.question)
      if (questionMode === 'insufficient') { deny('UNSUPPORTED_QUESTION'); return }
      if ((questionMode === 'routine') !== (state.kind === 'routine')) { deny('QUESTION_SCOPE'); return }
      if (state.mode === 'remote' && (!state.disclosureConsent || !state.paidConsent)) { deny('REMOTE_DISABLED'); return }
      if (state.mode === 'remote' && (!remoteProvider || !state.remoteConfigured)) { deny('REMOTE_NOT_CONFIGURED'); return }
      const runGeneration = ++generation
      const lifetime = new AbortController()
      pending = lifetime
      const receipts: DispatchReceipt[] = []
      update({ status: 'running', result: null, comparisons: [], problem: null })
      try {
        const currentReader = reader()
        const dispatcher = createCoachToolDispatcher({ reader: currentReader, now, maxCalls: 4,
          timeoutMs: Math.min(timeoutMs, 1000), authorization: {
            principalId: 'coach-lab-current-user', tools: ['read_session', 'read_scoring_evidence', 'read_history'],
            sessions: { [state.kind]: [...state.allowedSessionIds] }, maxHistory: 3,
          } })
        const traced = Object.freeze<CoachToolDispatcher>({ owns: dispatcher.owns, remainingCalls: dispatcher.remainingCalls,
          async dispatch(intent, options) {
            const receipt = await dispatcher.dispatch(intent, options)
            if (!lifetime.signal.aborted && generation === runGeneration) receipts.push(receipt)
            return receipt
          } })
        const provider = state.mode === 'remote' ? remoteProvider! : providerFor({ mode: 'mock', kind: state.kind,
          sessionId: state.currentSessionId, historyLimit: 3 })
        if (provider.kind !== state.mode) { deny('REMOTE_PROVIDER_MISMATCH'); return }
        const agent = createCoachOrchestrator({ dispatcher: traced, provider, remoteEnabled: state.mode === 'remote', timeoutMs })
        const result = await agent.run(state.question, { signal: lifetime.signal })
        if (disposed || lifetime.signal.aborted || generation !== runGeneration) return
        pending = undefined
        update({ result, status: result.status, comparisons: receipts.flatMap(receipt => receipt.comparison ? [{
          requestId: receipt.requestId, gate: receipt.comparison.gate, reason: receipt.comparison.reason,
        }] : []), problem: result.problemCode ? issue(result.problemCode) : null })
      } catch {
        if (disposed || lifetime.signal.aborted || generation !== runGeneration) return
        pending = undefined
        update({ status: 'failed', problem: issue('LAB_FAILURE'), result: null, comparisons: [] })
      }
    },
    cancel() {
      if (disposed) return
      const wasRunning = pending !== undefined
      stop()
      if (wasRunning) update({ status: 'cancelled', result: null, comparisons: [], problem: issue('CANCELLED') })
    },
    clear() {
      if (disposed) return
      stop(); remoteProvider = undefined
      update({ mode: 'mock', dataSource: 'synthetic', kind: 'warmup', sessions: [], currentSessionId: null,
        allowedSessionIds: [], localConsent: false, disclosureConsent: false, paidConsent: false,
        remoteConfigured: false, question: LAB_QUESTIONS.explain, status: 'idle', result: null,
        comparisons: [], problem: null, localLoaded: false })
      loadSynthetic()
    },
    dispose() {
      stop(); remoteProvider = undefined
      state = freezeCoachValue({ ...state, sessions: [], currentSessionId: null, allowedSessionIds: [],
        localConsent: false, disclosureConsent: false, paidConsent: false, remoteConfigured: false,
        question: '', status: 'idle', result: null, comparisons: [], problem: null, localLoaded: false })
      disposed = true
      listeners.clear()
    },
  })
}
