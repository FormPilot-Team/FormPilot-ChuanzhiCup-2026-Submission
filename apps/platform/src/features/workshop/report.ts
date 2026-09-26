import { BODY_AREAS, REQUIREMENTS } from './catalog'
import { goalProgress, type CustomActionSessionRecord } from './session'
import type { RequirementId } from './types'

/**
 * Report of a custom-action training. Deliberately limited to what the recognizer measured: how much of the goal was
 * done, how many repetitions met each 识别重点, and the feedback given. No composite score is derived.
 */

export interface CustomRequirementRow {
  id: RequirementId
  label: string
  checked: number
  passed: number
  /** 0–100, null without judged repetitions. */
  rate: number | null
  feedback: string
}

export interface CustomFocusItem {
  kind: 'requirement' | 'completion' | 'amplitude' | 'steady'
  title: string
  detail: string
  value: string | null
  reason: string
}

export interface CustomActionComparison {
  available: boolean
  reason: string | null
  previousId: string | null
  previousStartedAt: number | null
  doneDelta: number | null
  passRateDelta: number | null
}

export interface CustomActionReport {
  record: CustomActionSessionRecord
  complete: boolean
  progress: { done: number; target: number; unit: '次' | '秒'; share: number }
  /** Share of repetitions (held seconds) meeting every 识别重点, 0–100; null before any. */
  passRate: number | null
  requirements: CustomRequirementRow[]
  primaryFeedback: { code: string; message: string } | null
  focus: CustomFocusItem[]
  comparison: CustomActionComparison
  headline: string
  notes: string[]
}

const MOTION_TOO_SMALL = 'MOTION_TOO_SMALL'

function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

export function isReliableCustomSession(record: CustomActionSessionRecord): boolean {
  return record.source === 'live' && record.mode === 'normal' && record.outcome !== 'in_progress'
}

function unitWord(record: CustomActionSessionRecord): string {
  return record.goal.type === 'duration' ? '秒' : '次'
}

function requirementRows(record: CustomActionSessionRecord): CustomRequirementRow[] {
  return record.requirements
    .filter((item) => item.id !== 'full-return')
    .map((item) => ({ id: item.id, label: REQUIREMENTS[item.id].label, checked: item.checked, passed: item.passed, rate: percent(item.passed, item.checked), feedback: REQUIREMENTS[item.id].feedback }))
}

function primaryFeedback(record: CustomActionSessionRecord, rows: readonly CustomRequirementRow[]): CustomActionReport['primaryFeedback'] {
  const worst = [...rows].filter((row) => row.checked > row.passed).sort((left, right) => (right.checked - right.passed) - (left.checked - left.passed))[0]
  if (worst) return { code: `REQUIREMENT_${worst.id.toUpperCase().replaceAll('-', '_')}`, message: worst.feedback }
  if ((record.feedbackCounts[MOTION_TOO_SMALL] ?? 0) >= 2) return { code: MOTION_TOO_SMALL, message: '动作幅度再大一些，做到完成姿势' }
  return null
}

function focusItems(record: CustomActionSessionRecord, rows: readonly CustomRequirementRow[], progress: CustomActionReport['progress'], passRate: number | null): CustomFocusItem[] {
  const unit = unitWord(record)
  const items: CustomFocusItem[] = []
  const weakest = [...rows].filter((row) => row.rate !== null && row.checked >= 2 && row.rate < 80).sort((left, right) => (left.rate as number) - (right.rate as number))[0]
  if (weakest) {
    items.push({ kind: 'requirement', title: weakest.label, detail: `${weakest.feedback}。`, value: `${weakest.passed} / ${weakest.checked} ${unit}达标`, reason: `本次达标比例最低的识别重点（${weakest.rate}%）。` })
  }
  if (progress.share < 1) {
    items.push({ kind: 'completion', title: '完成全部目标', detail: `下次尽量做满 ${progress.target} ${progress.unit}。`, value: `${progress.done} / ${progress.target} ${progress.unit}`, reason: '本次在达到目标前结束了。' })
  }
  const small = record.feedbackCounts[MOTION_TOO_SMALL] ?? 0
  if (small >= 2) {
    items.push({ kind: 'amplitude', title: '每次都做到完成姿势', detail: '做到你示范的完成姿势再回来，才会计次。', value: `${small} 次幅度不足`, reason: '有动作没有做到位，所以没有计次。' })
  }
  if (!items.length && record.reps > 0) {
    items.push({ kind: 'steady', title: '保持稳定，可以加一点难度', detail: '识别重点基本都做到了，下次可以提高目标次数或放慢速度。', value: passRate === null ? null : `达标 ${passRate}%`, reason: '本次没有明显的问题。' })
  }
  return items.slice(0, 3)
}

function compare(record: CustomActionSessionRecord, history: readonly CustomActionSessionRecord[], passRate: number | null): CustomActionComparison {
  const none = { previousId: null, previousStartedAt: null, doneDelta: null, passRateDelta: null }
  if (!isReliableCustomSession(record)) return { available: false, reason: '本次记录不参与历史对比（测试记录或未结束）。', ...none }
  const previous = history
    .filter((item) => item.id !== record.id && item.actionId === record.actionId && isReliableCustomSession(item) && item.goal.type === record.goal.type && item.startedAt < record.startedAt)
    .sort((left, right) => right.startedAt - left.startedAt)[0]
  if (!previous) return { available: false, reason: '这是这个动作的第一条训练记录，暂无可对比的历史。', ...none }
  const previousRate = percent(previous.passedReps, previous.reps)
  return {
    available: true,
    reason: null,
    previousId: previous.id,
    previousStartedAt: previous.startedAt,
    doneDelta: goalProgress(record).done - goalProgress(previous).done,
    passRateDelta: passRate !== null && previousRate !== null ? passRate - previousRate : null,
  }
}

export function buildCustomActionReport(record: CustomActionSessionRecord, history: readonly CustomActionSessionRecord[] = []): CustomActionReport {
  const progressRaw = goalProgress(record)
  const progress = { ...progressRaw, share: progressRaw.target > 0 ? Math.min(1, progressRaw.done / progressRaw.target) : 0 }
  const passRate = percent(record.passedReps, record.reps)
  const rows = requirementRows(record)
  const unit = unitWord(record)
  const notes: string[] = []
  if (record.source !== 'live' || record.mode !== 'normal') notes.push('这条记录来自测试模式，不参与历史对比。')
  notes.push(`识别范围：${BODY_AREAS[record.bodyArea].label}动作，${record.recognitionMode === 'pose-match' ? '按你示范的开始姿势和完成姿势比对' : '按动作模板的信号判断'}。`)
  notes.push('识别重点的阈值来自你的示范和工程经验，只反映二维姿态，不代表专业评估。')
  notes.push('只保存识别结果，不保存摄像头画面。')
  const verb = record.goal.type === 'duration' ? '保持' : '完成'
  return {
    record,
    complete: record.outcome === 'completed',
    progress,
    passRate,
    requirements: rows,
    primaryFeedback: primaryFeedback(record, rows),
    focus: focusItems(record, rows, progress, passRate),
    comparison: compare(record, history, passRate),
    headline: `${verb} ${progress.done} / ${progress.target} ${progress.unit} · 达标 ${record.passedReps} ${unit}`,
    notes,
  }
}
