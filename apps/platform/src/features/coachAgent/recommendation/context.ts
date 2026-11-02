import { createCoachSessionReader } from '../sessionReader'
import { findCriterion } from '../../scoring/criteria'
import type { SessionSnapshot } from '../readerTypes'
import type { CoachEvidence, Focus, RecommendationContext } from './types'

const SUBJECT_FOCUS: Record<string, Focus[]> = {
  shoulder_rotation: ['coordination'], overhead_raise: ['reach'], lateral_raise: ['reach', 'stability'],
  step_jack: ['coordination', 'rhythm'], squat: ['stability', 'rhythm'], knee_raise: ['stability', 'coordination'],
  baduanjin: ['coordination', 'rhythm'], taijiquan: ['coordination', 'stability'], wuqinxi: ['coordination', 'rhythm'], yijinjing: ['stability'],
}
const SUBJECT_LABELS: Record<string, string> = { shoulder_rotation: '肩部环绕', overhead_raise: '双臂上举', lateral_raise: '侧平举', step_jack: '开合步', squat: '深蹲', knee_raise: '交替提膝', baduanjin: '八段锦', taijiquan: '太极拳', wuqinxi: '五禽戏', yijinjing: '易筋经' }
const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
function criterionFocus(id: string): Focus[] {
  if (/tempo|rhythm|timing/.test(id)) return ['rhythm']
  if (/balance|stability|symmetr|knee_track/.test(id)) return ['stability']
  if (/depth|amplitude|height|reach/.test(id)) return ['reach']
  if (/coordination|alternat/.test(id)) return ['coordination']
  return ['general']
}

function sessionEvidence(snapshot: SessionSnapshot): { training: CoachEvidence[]; reports: CoachEvidence[] } {
  const training: CoachEvidence[] = [], reports: CoachEvidence[] = []
  const summary = snapshot.summary
  if (summary.provenance.source !== 'live' || summary.provenance.mode !== 'normal' || summary.endedAt === null) return { training, reports }
  for (const evidence of summary.evidence) {
    // Guidance, missing versions, unknown observability and empty samples are never numeric evidence.
    if (evidence.score.status !== 'available' || !evidence.score.scoringVersion || evidence.quality.sampleCount < 1 || evidence.quality.observability === 'NOT_OBSERVABLE') continue
    const detail = snapshot.details.find(item => item.evidenceId === evidence.id)
    if (!detail) continue
    const references = [`${snapshot.storage.key}[${snapshot.storage.index}]`, ...detail.recordPaths, `record:${summary.recordRef.id}@${summary.recordRef.version}`, `evidence:${evidence.id}`, `scoring:${evidence.score.scoringVersion}`]
    const base = { source: 'live' as const, occurredAt: summary.startedAt.value, references }
    const explanation = obj(detail.explanation)
    const chapterId = typeof explanation?.chapterId === 'string' ? explanation.chapterId : undefined
    training.push({ ...base, id: `history:${evidence.id}`, category: 'training', title: `已记录${SUBJECT_LABELS[evidence.subject.id] ?? evidence.subject.id}${chapterId ? ` / ${chapterId}` : ''}`,
      detail: `${evidence.score.scoreKind} = ${Number(evidence.score.value.toFixed(2))}（${evidence.score.scale}），有效样本 ${evidence.quality.sampleCount}，可观测性 ${evidence.quality.observability}；仅表示该类工程记录，不据此判断疗效或进步。`,
      focuses: SUBJECT_FOCUS[evidence.subject.id] ?? ['general'], contentId: chapterId ?? evidence.subject.id })
    const components = Array.isArray(explanation?.components) ? explanation.components : []
    const criteria = Array.isArray(explanation?.criteria) ? explanation.criteria : []
    for (const raw of components) {
      const component = obj(raw)
      if (!component || typeof component.criterionId !== 'string' || !evidence.criterionIds.includes(component.criterionId)
        || typeof component.score !== 'number' || component.score < 0 || component.score >= 100
        || typeof component.evaluatedReps !== 'number' || component.evaluatedReps < 1) continue
      const criterion = criteria.map(obj).find(item => item?.id === component.criterionId || item?.criterionId === component.criterionId)
      const knownCriterion = findCriterion(component.criterionId)
      const label = typeof criterion?.requirement === 'string' ? criterion.requirement.slice(0, 180) : knownCriterion?.name ?? component.criterionId
      reports.push({ ...base, id: `report:${evidence.id}:${component.criterionId}`, category: 'report', title: label,
        detail: `已保存记录的本地解释分项为 ${Number(component.score.toFixed(2))}/100，${component.evaluatedReps} 次有效动作；这是待关注分项，不是疾病结论。`,
        focuses: criterionFocus(component.criterionId), contentId: evidence.subject.id })
    }
    if (evidence.score.scoreKind === 'routine-technique' && evidence.score.value < 100 && explanation) {
      reports.push({ ...base, id: `report:${evidence.id}`, category: 'report', title: typeof explanation.requirement === 'string' ? explanation.requirement.slice(0, 180) : '功法规范分项',
        detail: `原规范分项 ${Number(evidence.score.value.toFixed(2))}/100，${evidence.quality.sampleCount} 个窗口样本；与跟练相似度分开解释，不能用于医学判断。`,
        focuses: criterionFocus(evidence.criterionIds[0] ?? ''), contentId: chapterId ?? evidence.subject.id })
    }
  }
  return { training, reports }
}

/** Only call after consent. Uses the existing strict readers; never mutates, repairs or uploads storage. */
export function readRecommendationContext(storage: { getItem(key: string): string | null }, now: number): RecommendationContext {
  const reader = createCoachSessionReader({ storage, now: () => now })
  const training: CoachEvidence[] = [], reportCandidates: CoachEvidence[] = []
  let latestSessionAt = -Infinity
  let latestSessionRef: string | null = null
  const limitations = ['游戏历史未接入：MotionLab 无持久历史仓储，独立游戏与平台尚无跨应用可信适配。', 'StartLux 未接入：当前没有实际模型输出，规则继续兜底。', '只读取最近各 8 条热身/功法记录；未执行历史进步比较。']
  for (const kind of ['warmup', 'routine'] as const) {
    const result = reader.readHistory({ kind, limit: 8 })
    if (!result.ok) { limitations.push(`${kind} 历史读取失败：${result.error.code}；不能断言没有历史。`); continue }
    let accepted = 0
    for (const snapshot of result.data.sessions) {
      if (!reader.owns(snapshot)) continue
      const summary = snapshot.summary
      const sessionRef = `record:${summary.recordRef.id}@${summary.recordRef.version}`
      if (summary.provenance.source === 'live' && summary.provenance.mode === 'normal' && summary.endedAt !== null
        && (summary.startedAt.value > latestSessionAt || (summary.startedAt.value === latestSessionAt && sessionRef > (latestSessionRef ?? '')))) {
        latestSessionAt = summary.startedAt.value
        latestSessionRef = sessionRef
      }
      const projected = sessionEvidence(snapshot)
      accepted += projected.training.length
      training.push(...projected.training)
      reportCandidates.push(...projected.reports)
    }
    if (!accepted) limitations.push(`${kind} 没有通过来源、正常模式、版本、结束状态及有效样本门禁的评分记录。`)
  }
  reportCandidates.sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id))
  training.sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id))
  const evidence = training.slice(0, 12)
  if (training.length > evidence.length) limitations.push(`当前有 ${training.length} 条有效评分证据，展示与排序仅使用最近 12 条训练证据，另保留最新报告最多 3 个分项。`)
  // Only the newest available report's findings answer "recent issues"; do not pool stale problems.
  evidence.push(...reportCandidates.filter(item => latestSessionRef !== null && item.references.includes(latestSessionRef)).slice(0, 3))
  if (!evidence.some(item => item.category === 'report')) limitations.push('最近报告问题证据不足：不会把自述困难或训练动作名称补造成检测结论。')
  return { evidence, limitations, decisionStatus: 'not_connected' }
}
