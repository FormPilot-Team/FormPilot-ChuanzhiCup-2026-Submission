import { scopeChapters } from '../../routines/scope'
import type { RoutineChapter, RoutineProgram, RoutineScope } from '../../routines/types'
import { criteriaFor, findCriterion } from '../criteria'
import { targetText, withUnit } from '../targetScore'
import { SCORING_VERSION, type EvaluationCriterion } from '../types'
import type { RoutineTechniqueRecord, TechniqueWindowObservation } from './techniqueRecord'

/** One observed window, ready to quote as evidence. */
export interface TechniqueEvidence {
  /** 1-based position among this criterion's windows in the chapter (第 N 次). */
  occurrence: number
  /** Video time of the phase, seconds. */
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
  /** Mean window score, 0–100; null when no window could be observed. */
  score: number | null
  /** Lowest-scoring observed windows (up to three), worst first; only windows below full marks. */
  failures: TechniqueEvidence[]
}

export interface TechniqueChapterResult {
  chapter: RoutineChapter
  /** Weighted mean of the chapter's scored criteria that were observed. */
  score: number | null
  measured: TechniqueCriterionResult[]
  /** Requirements shown for reference: not measured yet, or not observable at all. */
  references: EvaluationCriterion[]
}

export interface TechniqueDeduction {
  result: TechniqueCriterionResult
  chapter: RoutineChapter
  /** weight × (100 − score), the share of the technique score this criterion cost. */
  lostPoints: number
}

export interface RoutineTechniqueReport {
  version: string
  /** False when the record predates Scoring v2 or the standard pose data was missing. */
  available: boolean
  reason: string | null
  /** 动作规范评价: weighted mean over all observed scored criteria; null when nothing could be observed. */
  score: number | null
  chapters: TechniqueChapterResult[]
  /** Chapters that have at least one camera check (the rest are reference-only for now). */
  measuredChapterCount: number
  deductions: TechniqueDeduction[]
  /** Routine-wide requirements the camera cannot judge (breathing, intent …). */
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

/**
 * 动作规范评价 for a routine session. Similarity (how close the pose is to the video) is reported elsewhere and is
 * never mixed in here: this is only whether the specific, sourced requirements were met in each phase.
 */
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

/** “01:27” for evidence lines. */
export function videoClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

/** “第 3 次托举顶点（视频 01:27）双肘伸展角（较弯一侧）137°，要求 ≥ 150°”. */
export function evidenceSentence(result: TechniqueCriterionResult, evidence: TechniqueEvidence): string {
  const metric = result.criterion.metric?.label ?? result.criterion.name
  return `第 ${evidence.occurrence} 次${evidence.phase ?? ''}（视频 ${videoClock(evidence.start)}）${metric} ${evidence.valueText}，要求 ${evidence.targetText}`
}
