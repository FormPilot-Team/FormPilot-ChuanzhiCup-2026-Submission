import type { ScoringEvidence } from './contracts'
import type { DispatchReceipt } from './dispatchTypes'
import { freezeCoachValue, type AnswerMode, type AnswerReference, type CoachProvider } from './provider'

export interface CoachCitation extends AnswerReference {
  sessionId: string
  subject: ScoringEvidence['subject']
  score: ScoringEvidence['score']
  recordRef: ScoringEvidence['recordRef']
  provenance: ScoringEvidence['provenance']
  recordPaths: string[]
  sampleCount: number
  observability: ScoringEvidence['quality']['observability']
}
export interface CoachFinding extends AnswerReference {
  criterionId: string
  label: string
  score: number
  weight: number
  evaluatedReps: number
}
export interface CoachAnswer {
  status: 'answered' | 'insufficient' | 'failed' | 'cancelled' | 'timeout'
  mock: boolean
  providerKind: CoachProvider['kind']
  /** A validated provider plan is separate from a locally grounded factual answer. */
  modelPlanning: 'mock' | 'completed' | 'not_completed'
  providerId: string
  text: string
  citations: CoachCitation[]
  findings: CoachFinding[]
  limitations: string[]
  calls: Array<{ requestId: string; tool: string | null; ok: boolean; problemCode: string | null }>
  problemCode: string | null
}

export function receiptEvidence(receipt: DispatchReceipt): ScoringEvidence[] {
  const result = receipt.result
  if (!receipt.ok || !result?.ok) return []
  if (result.tool === 'read_scoring_evidence') return result.data
  if (result.tool === 'read_session') return result.data.evidence
  if (result.tool === 'read_history') return result.data.flatMap(session => session.evidence)
  return []
}

const FAILURE_TEXT: Record<string, string> = {
  CORRUPT: '训练数据损坏，不能据此断言没有训练记录。',
  NOT_FOUND: '指定训练记录不存在。',
  UNAVAILABLE: '训练数据暂时不可读取，不能据此断言没有历史。',
  PERMISSION_DENIED: '没有读取这些训练记录的授权。',
  UNSUPPORTED_VERSION: '记录版本暂不受支持。',
  INSUFFICIENT_DATA: '有效评分证据不足。',
  TIMEOUT: '调用已超时，未使用迟到结果。',
  CANCELLED: '调用已取消，未使用迟到结果。',
}
const CRITERION_NAMES: Record<string, string> = {
  'wu.squat.depth': '下蹲幅度', 'wu.squat.knee_track': '膝部轨迹',
  'wu.squat.balance': '左右均衡与躯干稳定', 'wu.squat.completion': '完整起立', 'wu.squat.tempo': '控制节奏',
}

function localFindings(receipt: DispatchReceipt, evidence: ScoringEvidence): CoachFinding[] {
  const explanation = receipt.details.find(item => item.evidenceId === evidence.id)?.explanation
  if (!explanation || typeof explanation !== 'object') return []
  const components = (explanation as { components?: unknown }).components
  if (!Array.isArray(components)) return []
  const findings: CoachFinding[] = []
  for (const raw of components) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.criterionId !== 'string' || !evidence.criterionIds.includes(item.criterionId)
      || typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score >= 100
      || typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1
      || typeof item.evaluatedReps !== 'number' || !Number.isSafeInteger(item.evaluatedReps) || item.evaluatedReps < 1) continue
    findings.push({ requestId: receipt.requestId, evidenceId: evidence.id, criterionId: item.criterionId,
      label: CRITERION_NAMES[item.criterionId] ?? item.criterionId,
      score: item.score, weight: item.weight, evaluatedReps: item.evaluatedReps })
  }
  return findings.sort((a, b) => a.score - b.score || a.criterionId.localeCompare(b.criterionId)).slice(0, 3)
}

function scoreText(citation: CoachCitation): string {
  const score = citation.score
  if (score.scoreKind === 'guidance') return 'guidance：仅有指导信息，不计分'
  if (score.status !== 'available') return `${score.scoreKind}：有效评分证据不足`
  return `${score.scoreKind}：${Number(score.value.toFixed(2))}${score.scale === '0-1' ? '（0–1 跟练相似度）' : '/100'}`
}

export function coachFailure(providerId: string, receipts: DispatchReceipt[], code: string,
  status: CoachAnswer['status'] = 'failed', providerKind: CoachProvider['kind'] = 'mock'): CoachAnswer {
  return freezeCoachValue({ status, mock: providerKind === 'mock', providerKind,
    modelPlanning: providerKind === 'mock' ? 'mock' : 'not_completed', providerId,
    text: `${providerKind === 'mock' ? '[MOCK / 确定性规则演示]'
      : providerKind === 'local' ? '[LOCAL / 本地规划未完成]' : '[REMOTE / 未完成可信模型规划]'} ${FAILURE_TEXT[code] ?? '未取得可信答复，数据不足，无法回答训练表现。'}`,
    citations: [], findings: [], limitations: [], calls: receipts.map(receipt => ({
      requestId: receipt.requestId, tool: receipt.tool, ok: receipt.ok, problemCode: receipt.problem?.code ?? null,
    })), problemCode: code })
}

/** Scores and factual copy are rendered locally; the provider can select references, never write facts. */
export function renderCoachAnswer(providerId: string, mode: AnswerMode, refs: AnswerReference[], receipts: DispatchReceipt[],
  providerKind: CoachProvider['kind'] = 'mock'): CoachAnswer {
  const selected = refs.map(ref => {
    const receipt = receipts.find(item => item.requestId === ref.requestId)
    const evidence = receipt && receiptEvidence(receipt).find(item => item.id === ref.evidenceId)
    if (!receipt || !evidence) throw new Error('INVALID_EVIDENCE_REFERENCE')
    return { receipt, evidence }
  })
  if (mode === 'insufficient' && refs.length) throw new Error('INVALID_ANSWER_SCOPE')
  if (mode === 'explain' || mode === 'history') {
    if (selected.some(({ evidence }) => evidence.subject.kind !== 'exercise' || evidence.subject.id !== 'squat'
      || evidence.score.scoreKind !== 'warmup-standard')) throw new Error('INVALID_ANSWER_SCOPE')
  } else if (mode === 'routine' && selected.some(({ evidence }) => evidence.subject.kind !== 'routine'
    || evidence.subject.id !== 'baduanjin' || !['routine-technique', 'follow-along-similarity', 'guidance'].includes(evidence.score.scoreKind))) {
    throw new Error('INVALID_ANSWER_SCOPE')
  }
  const citations: CoachCitation[] = selected.map(({ receipt, evidence }) => ({
    requestId: receipt.requestId, evidenceId: evidence.id, sessionId: evidence.sessionId,
    subject: evidence.subject, score: evidence.score, recordRef: evidence.recordRef, provenance: evidence.provenance,
    recordPaths: [...(receipt.details.find(item => item.evidenceId === evidence.id)?.recordPaths ?? [])],
    sampleCount: evidence.quality.sampleCount, observability: evidence.quality.observability,
  }))
  const limitations = [...new Set(receipts.flatMap(receipt => receipt.limitations))]
  const findings = mode === 'explain' ? selected.flatMap(({ receipt, evidence }) => localFindings(receipt, evidence)) : []
  const body: string[] = []
  let status: CoachAnswer['status'] = 'answered'
  if (citations.some(item => item.provenance.source === 'synthetic' || item.provenance.source === 'demo')) {
    body.push('以下为 synthetic/demo 合成演示数据，不能代表真人训练表现。')
  }
  for (const receipt of receipts) if (!receipt.ok) body.push(FAILURE_TEXT[receipt.problem?.code ?? ''] ?? '工具调用失败，证据不足。')
  const available = citations.filter(item => item.score.status === 'available' || (item.score.scoreKind === 'guidance' && item.sampleCount > 0))
  if (!available.length || mode === 'insufficient') {
    status = 'insufficient'
    body.push('数据不足：没有可用于回答本问题的有效证据。')
  } else if (mode === 'history') {
    const comparisons = [...new Set(selected.map(({ receipt }) => receipt))]
    if (comparisons.some(receipt => receipt.tool !== 'read_history' || !receipt.comparison)) throw new Error('INVALID_COMPARISON_REFERENCE')
    const comparable = comparisons.filter(receipt => receipt.comparison?.gate !== 'NONE')
    if (!comparable.length) {
      status = 'insufficient'
      body.push('历史不可比较，无法判断最近深蹲有没有进步。')
      for (const receipt of comparisons) body.push(`比较门禁：${receipt.comparison!.gate}；原因：${receipt.comparison!.reason ?? '证据不足'}。`)
    } else {
      body.push('已通过既有历史比较门禁；以下分别列出相同评分种类的观察值，不生成统一总分。')
      for (const citation of citations) body.push(`${citation.sessionId}：${scoreText(citation)} [${citation.evidenceId}]。`)
      for (const receipt of comparable) body.push(`比较门禁：${receipt.comparison!.gate}；${receipt.comparison!.reason ?? '同范围比较'}。`)
      body.push('这些观察值不单独证明动作改善或真人训练效果。')
    }
  } else {
    for (const citation of citations) body.push(`${citation.sessionId} ${scoreText(citation)} [${citation.evidenceId}]。`)
    if (mode === 'explain') {
      if (findings.length) body.push(`本地规则评分中较低的分项：${findings.map(item => `${item.label}（${item.criterionId}）${Number(item.score.toFixed(2))}/100`).join('；')}。`)
      else body.push('当前记录没有可定位的较低分项，不能推断分数偏低的原因。')
      body.push('以上是既有规则对已存观测的解释，工程标定分值不等于医学判断。')
    } else body.push('跟练相似度与动作规范评分分别呈现；相似度不能证明动作规范，guidance 不计分。')
  }
  if (limitations.length) body.push(`数据限制：${limitations.join('；')}`)
  return freezeCoachValue({ status, mock: providerKind === 'mock', providerKind,
    modelPlanning: providerKind === 'mock' ? 'mock' : 'completed', providerId,
    text: `${providerKind === 'mock' ? '[MOCK / 确定性规则演示]'
      : providerKind === 'local' ? '[LOCAL / 本机规划已校验，事实由本地证据生成]'
        : '[REMOTE / 模型规划已验证，事实由本地证据生成]'} ${body.join('\n')}`,
    citations, findings, limitations, calls: receipts.map(receipt => ({
      requestId: receipt.requestId, tool: receipt.tool, ok: receipt.ok, problemCode: receipt.problem?.code ?? null,
    })), problemCode: null })
}
