import { analyzeTraining } from '../analysis'
import type { CoachDecisionResponse } from '../coachAgent/decisionModel/engine/contract'
import { createCoachToolDispatcher } from '../coachAgent/dispatcher'
import type { DispatchReceipt } from '../coachAgent/dispatchTypes'
import type { SessionKind } from '../coachAgent/readerTypes'
import { createCoachSessionReader } from '../coachAgent/sessionReader'
import { exerciseRegistry } from '../exercises/registry'
import type { ExerciseId } from '../exercises/types'
import { ROUTINE_PROGRAMS, findRoutineProgram } from '../routines/programs'
import { buildRoutineReport, SIMILARITY_BAND_LABEL } from '../routines/report/routineReport'
import { chapterDisplayName, formatClock, scopeTitle } from '../routines/scope'
import { ROUTINE_SESSION_STORAGE_KEY } from '../routines/session/RoutineSessionRepository'
import type { RoutineSessionRecord } from '../routines/session/types'
import { SESSION_STORAGE_KEY } from '../training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionState } from '../training/types'
import { WEB_GAMES } from '../web/games'
import { VERIFICATION_LABEL, type KnowledgeChunk, type KnowledgeTopic } from './knowledge'
import type { AgentToolCall, AgentToolName } from './protocol'
import { normalizeQuery, retrieveKnowledge } from './retrieval'

/**
 * Trusted, read-only tool execution for the V1.2 agent. Authorization comes from the page (the user's consent and
 * confirmed profile), never from model arguments. Record tools go through the existing Dispatcher (authorization by
 * session id, reader validation, native comparison gates) and then the report pages' own analysis, so every number the
 * model sees is the number the report shows. Results are projected to compact JSON for the model and, separately, to
 * evidence/citation records for the UI. Nothing here writes storage, changes a score or controls training.
 */

export interface AgentToolContext {
  storage: Pick<Storage, 'getItem'> | null
  now: () => number
  /** The user ticked 「允许读取此浏览器中的训练记录」 on this page. Trusted page state only. */
  recordsConsent: boolean
  /** Runs the page's decision runtime on the confirmed profile; null = no confirmed profile yet. */
  recommend: () => CoachDecisionResponse | null
  /** Motion Games Lab service availability as probed by the page; null = unknown. */
  gamesAvailable: boolean | null
}

export interface ToolCitation { ref: string; chunkId: string; title: string; text: string; source: string; verification: string; url: string | null }
export interface ToolEvidence { kind: 'record' | 'comparison' | 'recommendation' | 'catalog'; label: string; detail: string }

export interface ToolExecution {
  call: AgentToolCall
  ok: boolean
  /** JSON string given to the model as the tool message. */
  content: string
  errorCode: string | null
  /** One line for the progress UI. */
  summary: string
  citations: ToolCitation[]
  evidence: ToolEvidence[]
  elapsedMs: number
}

const TOOL_LABEL: Readonly<Record<AgentToolName, string>> = Object.freeze({
  search_knowledge: '检索功法知识库',
  get_catalog: '读取内容目录',
  recommend_training: '生成训练推荐（决策模型 / 规则）',
  read_last_training: '读取最近一次训练记录',
  compare_recent_training: '比较近期训练记录',
})
export function toolLabel(name: AgentToolName): string { return TOOL_LABEL[name] }

function exerciseName(id: string): string {
  return exerciseRegistry.get(id as ExerciseId)?.displayName ?? id
}

/** Report trend codes in the words the report page uses; the model never sees raw codes. */
const TREND_TEXT: Readonly<Record<string, string>> = Object.freeze({ IMPROVED: '提升', STABLE: '持平', DECLINED: '下降', up: '提升', flat: '基本持平', down: '下降' })
export function trendText(trend: string | null | undefined): string { return trend ? TREND_TEXT[trend] ?? '—' : '—' }

function dateText(epoch: number): string {
  const d = new Date(epoch)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const SOURCE_TEXT: Record<string, string> = { live: '摄像头实时训练', demo: '演示模式', synthetic: '合成测试数据', unknown: '来源未知' }

function citationSource(chunk: KnowledgeChunk): { source: string; verification: string; url: string | null } {
  const first = chunk.citations[0]
  const names = chunk.citations.map((c) => (c.organization && c.organization !== 'FormPilot' ? `${c.organization}《${c.label.replace(/^《|》$/gu, '')}》` : c.label))
  return { source: [...new Set(names)].join('；'), verification: VERIFICATION_LABEL[first.verification], url: first.url }
}

function fail(call: AgentToolCall, code: string, message: string, started: number): ToolExecution {
  return { call, ok: false, content: JSON.stringify({ ok: false, error: code, message }), errorCode: code, summary: message, citations: [], evidence: [], elapsedMs: Math.round(performance.now() - started) }
}

// ---- search_knowledge -----------------------------------------------------------------------------------------------

/** A chapter label the question names but the routine does not have (e.g. 八段锦第十二式). */
function missingChapterNote(query: string, topics: readonly string[]): string | null {
  const text = normalizeQuery(query)
  for (const program of ROUTINE_PROGRAMS) {
    if (!topics.includes(program.id) && !text.includes(program.title)) continue
    for (const match of text.matchAll(/第([一二三四五六七八九十]+)(式|势|戏|动)/gu)) {
      if (!program.chapters.some((chapter) => chapter.label === match[0])) {
        const forms = program.chapters.filter((chapter) => chapter.kind === 'form').length
        return `目录核对：${program.title}共 ${forms} ${program.formUnit}（另有预备势、收势），没有“${match[0]}”。请如实告诉用户。`
      }
    }
  }
  return null
}

function searchKnowledge(call: AgentToolCall, refOffset: number, started: number): ToolExecution {
  const query = String(call.arguments.query ?? '').trim()
  if (!query) return fail(call, 'INVALID_ARGUMENTS', '检索问题为空。', started)
  const topic = (['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing', 'warmup'].includes(String(call.arguments.topic)) ? call.arguments.topic : 'any') as KnowledgeTopic | 'any'
  const result = retrieveKnowledge(query, { topic })
  const catalogNote = missingChapterNote(query, result.linked.topics)
  if (result.status === 'insufficient') {
    return { call, ok: true, content: JSON.stringify({ ok: true, status: 'insufficient', ...(catalogNote ? { catalogNote } : {}), message: '知识库中没有与该问题足够相关的条目。请告诉用户现有资料不足以回答，不要自行补充。' }),
      errorCode: null, summary: '没有找到足够相关的资料', citations: [], evidence: [], elapsedMs: Math.round(performance.now() - started) }
  }
  const citations = result.hits.map((hit, index) => {
    const meta = citationSource(hit.chunk)
    return { ref: `K${refOffset + index + 1}`, chunkId: hit.chunk.id, title: hit.chunk.title, text: hit.chunk.text, ...meta }
  })
  return {
    call, ok: true, errorCode: null, citations, evidence: [], elapsedMs: Math.round(performance.now() - started),
    summary: `找到 ${citations.length} 条资料`,
    content: JSON.stringify({ ok: true, status: 'ok', ...(catalogNote ? { catalogNote } : {}), results: citations.map((c) => ({ ref: c.ref, title: c.title, text: c.text, source: `${c.source}（${c.verification}）` })) }),
  }
}

// ---- get_catalog -------------------------------------------------------------------------------------------------------

function getCatalog(call: AgentToolCall, context: AgentToolContext, started: number): ToolExecution {
  const kind = ['routines', 'warmup', 'games'].includes(String(call.arguments.kind)) ? String(call.arguments.kind) : 'all'
  const data: Record<string, unknown> = {}
  if (kind === 'all' || kind === 'routines') {
    data.routines = ROUTINE_PROGRAMS.map((program) => ({ id: program.id, title: program.title, duration: formatClock(program.video.durationSeconds), chapters: program.chapters.map(chapterDisplayName) }))
  }
  if (kind === 'all' || kind === 'warmup') data.warmup = [...exerciseRegistry.values()].map((definition) => definition.displayName)
  if (kind === 'all' || kind === 'games') {
    data.games = WEB_GAMES.map((game) => game.title)
    data.gameService = context.gamesAvailable === null ? '未检测' : context.gamesAvailable ? '已连接' : '未运行'
  }
  return { call, ok: true, errorCode: null, citations: [], elapsedMs: Math.round(performance.now() - started),
    evidence: [{ kind: 'catalog', label: 'FormPilot 内容目录', detail: kind === 'all' ? '功法、热身动作与体感游戏' : kind }],
    summary: '已读取内容目录', content: JSON.stringify({ ok: true, ...data }) }
}

// ---- recommend_training ---------------------------------------------------------------------------------------------

const ABSTAIN_TEXT: Readonly<Record<string, string>> = Object.freeze({ LOW_SUITABILITY: '候选适配度都偏低', OUT_OF_DISTRIBUTION: '输入超出训练数据范围', NO_CANDIDATES: '没有可排序的候选' })

/** Why the decision runtime used rules this time, in the page's own terms (never a raw code). */
function ruleReason(response: CoachDecisionResponse): string {
  if (response.fallbackReason === 'MODEL_ABSTAINED') return `决策模型弃权：${(response.abstainReason && ABSTAIN_TEXT[response.abstainReason]) ?? '把握不足'}`
  if (response.fallbackReason === 'MODEL_DISABLED') return '本构建未启用决策模型'
  if (response.fallbackReason === 'SHADOW_MODE') return '决策模型影子运行，只记录不展示'
  if (response.fallbackReason === 'EXPERIMENTAL_MODEL_NOT_APPROVED') return '本构建未批准实验性决策模型'
  return '决策模型未运行或已回退'
}

function recommendTraining(call: AgentToolCall, context: AgentToolContext, started: number): ToolExecution {
  let response: CoachDecisionResponse | null
  try { response = context.recommend() } catch { return fail(call, 'RECOMMENDATION_FAILED', '推荐暂时无法生成。', started) }
  if (!response) return fail(call, 'PROFILE_REQUIRED', '用户还没有在本页完成并确认画像（目标、困难、部位、风险确认），无法推荐。请提示用户先完成画像。', started)
  const result = response.display?.result
  if (response.status === 'safety_hold') {
    return { call, ok: true, errorCode: null, citations: [], elapsedMs: Math.round(performance.now() - started), summary: '风险规则暂停推荐',
      evidence: [{ kind: 'recommendation', label: '安全规则', detail: '画像中报告了风险，暂停推荐' }],
      content: JSON.stringify({ ok: true, status: 'safety_hold', message: result?.message ?? '画像中报告了疼痛、眩晕或近期受伤，暂停推荐。', instruction: '告诉用户本次不推荐任何训练，请先停止训练，必要时咨询医生或康复治疗师。' }) }
  }
  if (response.status !== 'ready' || !result) return fail(call, response.status === 'profile_required' ? 'PROFILE_REQUIRED' : 'NO_RECOMMENDATION', result?.message ?? '当前没有可推荐的内容。', started)
  const rank = (id: string) => response!.ranking.find((item) => item.id === id)
  const items = [...result.chapters, ...result.routines, ...result.games].slice(0, 6).map((item) => ({
    kind: item.entry.kind === 'game' ? '体感游戏' : item.entry.kind === 'chapter' ? '功法章节' : '功法',
    title: item.entry.title,
    reasons: item.reasons.slice(0, 2),
    ...(response!.decisionOrigin === 'model' && rank(item.entry.id) ? { modelRank: rank(item.entry.id)!.rank, suitability: `${Math.round(rank(item.entry.id)!.suitability * 100)}%（候选内相对适配度，不是医学概率）` } : {}),
  }))
  const origin = response.decisionOrigin === 'model' ? `训练模型 ${response.model?.id ?? 'fp-cdm'} 排序 + 规则安全筛选` : `项目规则推荐（${ruleReason(response)}）`
  return {
    call, ok: true, errorCode: null, citations: [], elapsedMs: Math.round(performance.now() - started),
    summary: `${response.decisionOrigin === 'model' ? '决策模型' : '规则'}给出 ${items.length} 项推荐`,
    evidence: [{ kind: 'recommendation', label: origin, detail: items.map((item) => item.title).join('、') }],
    content: JSON.stringify({ ok: true, status: 'ready', decisionOrigin: origin, message: result.message, items,
      dataSources: response.dataSources.trainingHistory === 'live_local_records' ? '画像 + 已授权本机记录' : '仅自述画像', limitations: response.limitations.slice(0, 3) }),
  }
}

// ---- record tools ------------------------------------------------------------------------------------------------------

interface AuthorizedRead { latestId: string; receipt: DispatchReceipt; raw: unknown[] }

async function authorizedRead(kind: SessionKind, context: AgentToolContext, tool: 'read_session' | 'read_history'): Promise<AuthorizedRead | { error: string; message: string }> {
  if (!context.recordsConsent || !context.storage) return { error: 'NOT_AUTHORIZED', message: '用户没有授权 AI 教练读取本机训练记录。请提示用户勾选输入框上方的“允许 AI 教练读取此浏览器中的热身与功法训练记录”后再问。' }
  const reader = createCoachSessionReader({ storage: context.storage, now: () => Math.floor(context.now()) })
  const history = reader.readHistory({ kind, limit: 64 })
  if (!history.ok) return { error: history.error.code, message: '训练记录未通过校验，无法读取。' }
  if (history.data.state === 'EMPTY' || !history.data.sessions.length) return { error: 'NO_RECORDS', message: kind === 'warmup' ? '这个浏览器里还没有热身训练记录。' : '这个浏览器里还没有功法跟练记录。' }
  const sessions = [...history.data.sessions].sort((a, b) => b.summary.startedAt.value - a.summary.startedAt.value)
  const ids = sessions.map((item) => item.summary.sessionId)
  const dispatcher = createCoachToolDispatcher({ reader, now: () => Math.floor(context.now()), maxCalls: 4, timeoutMs: 3000,
    authorization: { principalId: 'local-browser-user', tools: ['read_session', 'read_history', 'read_scoring_evidence'], sessions: { [kind]: ids }, maxHistory: 20 } })
  const receipt = await dispatcher.dispatch({ tool, query: tool === 'read_session' ? { kind, sessionId: ids[0] } : { kind, sessionId: ids[0], limit: 20 } })
  if (!dispatcher.owns(receipt)) return { error: 'UNTRUSTED_RESULT', message: '工具结果未通过校验。' }
  if (!receipt.ok) return { error: receipt.problem?.code ?? 'UNAVAILABLE', message: receipt.problem?.code === 'INSUFFICIENT_DATA' ? '最近一次训练没有足够的评分证据。' : '记录读取失败。' }
  let raw: unknown[] = []
  try { raw = JSON.parse(context.storage.getItem(kind === 'warmup' ? SESSION_STORAGE_KEY : ROUTINE_SESSION_STORAGE_KEY) ?? '[]') as unknown[] } catch { raw = [] }
  return { latestId: ids[0], receipt, raw }
}

function provenanceNote(receipt: DispatchReceipt): string[] {
  const summary = receipt.result?.data
  const provenance = summary && !Array.isArray(summary) && 'provenance' in summary ? summary.provenance : receipt.evidence[0]?.provenance
  const notes: string[] = []
  if (provenance && provenance.source !== 'live') notes.push(`记录来源：${SOURCE_TEXT[provenance.source] ?? provenance.source}，不能代表真人训练表现。`)
  if (provenance && provenance.mode !== 'normal') notes.push('记录为非正常模式（例如快速测试），不能作为训练表现依据。')
  return notes
}

function warmupLast(session: TrainingSessionState, history: TrainingSessionState[]) {
  const analysis = analyzeTraining(session, history)
  return {
    date: dateText(session.startedAt),
    status: analysis.courseComplete ? '完成全部动作' : '未完成全部动作',
    overallScore: analysis.overall.score === null ? '无综合分（有效数据不足或未完成）' : `${analysis.overall.score} 分（${analysis.overall.scope === 'FULL_COURSE' ? '完整训练综合评分' : '已完成动作平均分'}，满分 100）`,
    exercises: analysis.exercises.map((exercise) => ({ name: exerciseName(exercise.exerciseId), score: exercise.score === null ? '无评分' : `${exercise.score} 分` })),
    mainIssues: analysis.priorityIssues.slice(0, 2).map((issue) => ({ issue: `${issue.exerciseIds.map(exerciseName).join('、')}：${issue.reportLabel}`, cue: issue.cue })),
    nextFocus: analysis.nextFocus.slice(0, 2).map((item) => item.text),
    reportSummary: analysis.summary.map((item) => item.text).slice(0, 3),
  }
}

function routineLast(record: RoutineSessionRecord, history: RoutineSessionRecord[]) {
  const report = buildRoutineReport(record, history)
  if (!report) return null
  return {
    date: dateText(record.startedAt),
    scope: scopeTitle(report.program, record.scope),
    status: report.complete ? '跟练完成' : '未完整完成',
    coverage: `${Math.round(report.coverage * 100)}%`,
    followAlongSimilarity: report.similarity === null ? '识别数据不足，无相似度' : `${report.similarity}%（${SIMILARITY_BAND_LABEL[report.band!]}；衡量与示范姿态的接近程度，不等于动作规范评分）`,
    techniqueScore: report.technique.score === null ? '无动作规范分' : `${report.technique.score} 分（动作规范检查，与相似度分开评价）`,
    weakestChapter: report.weakestChapter && report.weakestChapter.similarity !== null ? `${chapterDisplayName(report.weakestChapter.chapter)}：相似度 ${report.weakestChapter.similarity}%，要领：${report.weakestChapter.chapter.cue}` : '没有足够数据判断最弱的一段',
    focus: report.focusItems.slice(0, 2).map((item) => `${item.title}${item.detail ? `：${item.detail}` : ''}`),
    techniqueDeductions: report.technique.deductions.slice(0, 2).map((item) => `${chapterDisplayName(item.chapter)} · ${item.result.criterion.name}：${item.result.criterion.feedback.issue}（纠正：${item.result.criterion.feedback.cue}）`),
  }
}

async function readLastTraining(call: AgentToolCall, context: AgentToolContext, started: number): Promise<ToolExecution> {
  const kind = call.arguments.kind === 'routine' ? 'routine' : call.arguments.kind === 'warmup' ? 'warmup' : null
  if (!kind) return fail(call, 'INVALID_ARGUMENTS', 'kind 必须是 warmup 或 routine。', started)
  const read = await authorizedRead(kind, context, 'read_session')
  if ('error' in read) return fail(call, read.error, read.message, started)
  const notes = provenanceNote(read.receipt)
  let data: Record<string, unknown> | null = null
  try {
    if (kind === 'warmup') {
      const records = read.raw as TrainingSessionState[]
      const current = records.find((item) => item.id === read.latestId)
      if (current) data = warmupLast(current, records)
    } else {
      const records = read.raw as RoutineSessionRecord[]
      const current = records.find((item) => item.id === read.latestId)
      if (current && findRoutineProgram(current.programId)) data = routineLast(current, records)
    }
  } catch { data = null }
  if (!data) return fail(call, 'INSUFFICIENT_DATA', '最近一次训练的数据不足以生成解读。', started)
  const label = kind === 'warmup' ? '热身训练记录' : '功法跟练记录'
  return {
    call, ok: true, errorCode: null, citations: [], elapsedMs: Math.round(performance.now() - started),
    summary: `已读取${label}（${String(data.date)}）`,
    evidence: [{ kind: 'record', label: `${label} · ${String(data.date)}`, detail: `会话 ${read.latestId} · 经 Dispatcher 授权与校验 · ${notes.length ? '非实时训练数据' : '实时训练'}` }],
    content: JSON.stringify({ ok: true, kind: label, ...data, dataNotes: [...notes, ...read.receipt.limitations.filter((item) => !/^[A-Z_]+:/u.test(item)).slice(0, 2)], rule: '分数与结论来自 FormPilot 报告，不得修改或换算。' }),
  }
}

async function compareRecentTraining(call: AgentToolCall, context: AgentToolContext, started: number): Promise<ToolExecution> {
  const kind = call.arguments.kind === 'routine' ? 'routine' : call.arguments.kind === 'warmup' ? 'warmup' : null
  if (!kind) return fail(call, 'INVALID_ARGUMENTS', 'kind 必须是 warmup 或 routine。', started)
  const read = await authorizedRead(kind, context, 'read_history')
  if ('error' in read) return fail(call, read.error, read.message, started)
  const comparison = read.receipt.comparison
  const notes = provenanceNote(read.receipt)
  const gateText = { FULL: '完全可比', PARTIAL: '部分可比', NONE: '不可比' } as const
  let data: Record<string, unknown> = { comparable: comparison?.gate !== 'NONE', gate: gateText[comparison?.gate ?? 'NONE'] }
  try {
    if (kind === 'warmup') {
      const records = read.raw as TrainingSessionState[]
      const current = records.find((item) => item.id === read.latestId)!
      const analysis = analyzeTraining(current, records)
      data = { ...data, reason: analysis.comparison.reasonText ?? null,
        previousDate: analysis.comparison.previousStartedAt ? dateText(analysis.comparison.previousStartedAt) : null,
        overallChange: analysis.overall.delta !== null && analysis.comparison.overallDeltaAllowed ? `综合分 ${analysis.overall.delta > 0 ? '+' : ''}${analysis.overall.delta} 分（${trendText(analysis.overall.trend)}）` : '综合分不可直接比较',
        exerciseChanges: analysis.exercises.filter((item) => item.scoreDelta !== null).map((item) => `${exerciseName(item.exerciseId)} ${item.scoreDelta! > 0 ? '+' : ''}${item.scoreDelta} 分`),
        improvements: analysis.improvements.slice(0, 2).map((item) => item.text) }
    } else {
      const records = read.raw as RoutineSessionRecord[]
      const current = records.find((item) => item.id === read.latestId)!
      const report = buildRoutineReport(current, records)
      const c = report?.comparison
      data = { ...data, comparable: !!c?.available, reason: c?.reason ?? null, previousDate: c?.previousStartedAt ? dateText(c.previousStartedAt) : null,
        similarityChange: c?.similarityDelta !== null && c?.similarityDelta !== undefined ? `跟练相似度 ${c.similarityDelta > 0 ? '+' : ''}${c.similarityDelta} 个百分点（${trendText(c.similarityTrend)}；相似度不是动作规范分）` : null,
        syncChange: c?.syncDelta !== null && c?.syncDelta !== undefined ? `节奏同步 ${c.syncDelta > 0 ? '+' : ''}${c.syncDelta} 个百分点（${trendText(c.syncTrend)}）` : null }
    }
  } catch { return fail(call, 'INSUFFICIENT_DATA', '近期记录不足以比较。', started) }
  const label = kind === 'warmup' ? '热身训练' : '功法跟练'
  return {
    call, ok: true, errorCode: null, citations: [], elapsedMs: Math.round(performance.now() - started),
    summary: data.comparable ? `已比较近期${label}（${String(data.gate)}）` : `近期${label}不可比较`,
    evidence: [{ kind: 'comparison', label: `${label}历史比较`, detail: `${String(data.gate)}${data.reason ? ` · ${String(data.reason)}` : ''} · 使用报告页同一比较规则` }],
    content: JSON.stringify({ ok: true, ...data, dataNotes: notes, rule: '只能使用这里的比较结论，指标名称照原样使用；没有给出的指标（如稳定性、波动）不要提。不可比时必须说无法判断进步，不要自己比较分数。' }),
  }
}

export async function executeAgentTool(call: AgentToolCall, context: AgentToolContext, refOffset = 0): Promise<ToolExecution> {
  const started = performance.now()
  try {
    switch (call.name) {
      case 'search_knowledge': return searchKnowledge(call, refOffset, started)
      case 'get_catalog': return getCatalog(call, context, started)
      case 'recommend_training': return recommendTraining(call, context, started)
      case 'read_last_training': return await readLastTraining(call, context, started)
      case 'compare_recent_training': return await compareRecentTraining(call, context, started)
      default: return fail(call, 'UNKNOWN_TOOL', '未知工具。', started)
    }
  } catch {
    return fail(call, 'TOOL_FAILURE', '工具执行失败。', started)
  }
}
