import { scopeChapters } from '../../routines/scope'
import type { RoutineChapter, RoutineProgram, RoutineScope } from '../../routines/types'
import { criteriaFor, findCriterion } from '../criteria'
import { targetText, withUnit } from '../targetScore'
import { SCORING_VERSION, type EvaluationCriterion } from '../types'
import type { RoutineTechniqueRecord, TechniqueWindowObservation } from './techniqueRecord'

export interface TechniqueEvidence {
  /** 本检查项在该章节内的第几次（第 N 次），从 1 开始 */
  occurrence: number
  /** 阶段在视频中的时间，秒 */
  start: number
  phase: string | null
  value: number
  valueText: string
  targetText: string
  score: number
}

export interface TechniqueCriterionResult {
  criterion: EvaluationCriterion
  chapterId: string
  windowsTotal: number
  windowsObserved: number
  passed: number
  /** 窗口平均分 0–100；没有可观测窗口时为 null */
  score: number | null
  /** 低于满分的窗口，最差的在前，最多三个 */
  failures: TechniqueEvidence[]
}

export interface TechniqueChapterResult {
  chapter: RoutineChapter
  score: number | null
  measured: TechniqueCriterionResult[]
  /** 仅供参考的要求：尚未测量或无法观测 */
  references: EvaluationCriterion[]
}

export interface TechniqueDeduction {
  result: TechniqueCriterionResult
  chapter: RoutineChapter
  /** weight × (100 − score)，即该项扣掉的分 */
  lostPoints: number
}

export interface RoutineTechniqueReport {
  version: string
  /** 旧记录或缺少标准姿态数据时为 false */
  available: boolean
  reason: string | null
  score: number | null
  chapters: TechniqueChapterResult[]
  /** 至少有一项摄像头检查的章节数 */
  measuredChapterCount: number
  deductions: TechniqueDeduction[]
  routineNotObservable: EvaluationCriterion[]
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function evidenceOf(criterion: EvaluationCriterion, window: TechniqueWindowObservation, occurrence: number): TechniqueEvidence | null {
  if (window.value === null || window.score === null || !criterion.target) return null
  return {
    occurrence,
    start: window.start,
    phase: criterion.phase,
    value: window.value,
    valueText: withUnit(window.value, criterion.target.unit),
    targetText: targetText(criterion.target),
    score: window.score,
  }
}

function criterionResult(criterion: EvaluationCriterion, chapterId: string, windows: readonly TechniqueWindowObservation[]): TechniqueCriterionResult {
  const evidence = windows.map((window, index) => evidenceOf(criterion, window, index + 1)).filter((item): item is TechniqueEvidence => item !== null)
  const score = mean(evidence.map((item) => item.score))
  return {
    criterion,
    chapterId,
    windowsTotal: windows.length,
    windowsObserved: evidence.length,
    passed: evidence.filter((item) => item.score >= 100).length,
    score: score === null ? null : Math.round(score),
    failures: evidence.filter((item) => item.score < 100).sort((left, right) => left.score - right.score || left.start - right.start).slice(0, 3),
  }
}

function weightedScore(results: readonly TechniqueCriterionResult[]): number | null {
  let sum = 0
  let weights = 0
  for (const result of results) {
    if (result.criterion.scoring !== 'SCORED' || result.score === null) continue
    sum += result.criterion.weight * result.score
    weights += result.criterion.weight
  }
  return weights ? Math.round(sum / weights) : null
}

const UNAVAILABLE_OLD = '这条记录生成于评分说明上线之前，没有保存动作规范检查的数据。'
const UNAVAILABLE_TRACK = '本次没有加载到标准动作姿态数据，无法划分动作阶段，因此没有动作规范检查。'

/** 动作规范评价：只看各阶段是否满足有出处的要求，不混入跟练相似度 */
export function buildRoutineTechniqueReport(
  program: RoutineProgram,
  scope: RoutineScope,
  technique: RoutineTechniqueRecord | undefined,
  referenceAvailable = true,
): RoutineTechniqueReport {
  const chapters = scopeChapters(program, scope)
  const records = new Map((technique?.criteria ?? []).map((item) => [`${item.criterionId}@${item.chapterId}`, item]))
  const chapterResults: TechniqueChapterResult[] = chapters.map((chapter) => {
    const criteria = criteriaFor(program.id, chapter.id)
    const measured: TechniqueCriterionResult[] = []
    const references: EvaluationCriterion[] = []
    for (const criterion of criteria) {
      if (criterion.scoring === 'REFERENCE_ONLY' || criterion.measurement.kind !== 'pose-window') {
        if (criterion.exercise !== '*' && criterion.scoring === 'REFERENCE_ONLY') references.push(criterion)
        continue
      }
      const record = records.get(`${criterion.id}@${chapter.id}`)
      if (record && findCriterion(record.criterionId)) measured.push(criterionResult(criterion, chapter.id, record.windows))
    }
    return { chapter, score: weightedScore(measured), measured, references }
  })
  const allMeasured = chapterResults.flatMap((item) => item.measured)
  const deductions = chapterResults
    .flatMap((item) => item.measured
      .filter((result) => result.criterion.scoring === 'SCORED' && result.score !== null && result.score < 100)
      .map((result) => ({ result, chapter: item.chapter, lostPoints: result.criterion.weight * (100 - (result.score as number)) })))
    .sort((left, right) => right.lostPoints - left.lostPoints || left.chapter.index - right.chapter.index)
    .slice(0, 3)
  const available = Boolean(technique) && referenceAvailable
  return {
    version: technique?.version ?? SCORING_VERSION,
    available,
    reason: available ? null : referenceAvailable ? UNAVAILABLE_OLD : UNAVAILABLE_TRACK,
    score: available ? weightedScore(allMeasured) : null,
    chapters: chapterResults,
    measuredChapterCount: chapterResults.filter((item) => item.measured.length > 0).length,
    deductions: available ? deductions : [],
    routineNotObservable: criteriaFor(program.id, '*').filter((criterion) => criterion.exercise === '*' && criterion.scoring === 'REFERENCE_ONLY'),
  }
}

export function videoClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

/** 如“第 3 次托举顶点（视频 01:27）双肘伸展角（较弯一侧）137°，要求 ≥ 150°” */
export function evidenceSentence(result: TechniqueCriterionResult, evidence: TechniqueEvidence): string {
  const metric = result.criterion.metric?.label ?? result.criterion.name
  return `第 ${evidence.occurrence} 次${evidence.phase ?? ''}（视频 ${videoClock(evidence.start)}）${metric} ${evidence.valueText}，要求 ${evidence.targetText}`
}
