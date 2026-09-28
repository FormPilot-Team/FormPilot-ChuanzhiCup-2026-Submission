import type { RoutineId } from '../../routines/types'
import type { EvaluationCriterion, ScoringMode } from '../types'
import { BADUANJIN_CRITERIA } from './baduanjin'
import { TAIJIQUAN_CRITERIA } from './taijiquan'
import { WARM_UP_CRITERIA } from './warmUp'
import { WUQINXI_CRITERIA } from './wuqinxi'
import { YIJINJING_CRITERIA } from './yijinjing'

export { WARM_UP_CRITERIA, BADUANJIN_CRITERIA, WUQINXI_CRITERIA, YIJINJING_CRITERIA, TAIJIQUAN_CRITERIA }

/** Every criterion of Scoring v2, in registry order (mode, then exercise / chapter). */
export const CRITERIA: ReadonlyArray<EvaluationCriterion> = Object.freeze([
  ...WARM_UP_CRITERIA,
  ...BADUANJIN_CRITERIA,
  ...TAIJIQUAN_CRITERIA,
  ...WUQINXI_CRITERIA,
  ...YIJINJING_CRITERIA,
])

const BY_ID: ReadonlyMap<string, EvaluationCriterion> = new Map(CRITERIA.map((criterion) => [criterion.id, criterion]))

export function getCriterion(id: string): EvaluationCriterion {
  const criterion = BY_ID.get(id)
  if (!criterion) throw new Error(`Unknown criterion: ${id}`)
  return criterion
}

export function findCriterion(id: string): EvaluationCriterion | undefined {
  return BY_ID.get(id)
}

export function criteriaForMode(mode: ScoringMode): EvaluationCriterion[] {
  return CRITERIA.filter((criterion) => criterion.mode === mode)
}

/** Criteria of one exercise (热身) or chapter (跟练), including routine-wide `*` entries for chapters. */
export function criteriaFor(mode: ScoringMode, exercise: string): EvaluationCriterion[] {
  return CRITERIA.filter((criterion) => criterion.mode === mode && (criterion.exercise === exercise || (mode !== 'warm-up' && criterion.exercise === '*')))
}

/** Follow-along criteria that the runtime measures from the camera (pose-window checks). */
export function routineMeasuredCriteria(routine: RoutineId): EvaluationCriterion[] {
  return CRITERIA.filter((criterion) => criterion.mode === routine && criterion.measurement.kind === 'pose-window' && criterion.scoring !== 'REFERENCE_ONLY')
}
