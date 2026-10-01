import { POSE_METRICS } from '../routine/poseMetrics'
import { getScoringSource } from '../sources'
import type { CriterionMeasurement, CriterionTarget, EvaluationCriterion } from '../types'

export type CriterionInput = Omit<EvaluationCriterion,
  'sourceType' | 'sourceTitle' | 'tolerance' | 'metric' | 'landmarks' | 'additionalSourceIds' | 'limitations'
  | 'thresholdSource' | 'thresholdBasis' | 'phase' | 'target' | 'weight' | 'severity'> & {
  additionalSourceIds?: ReadonlyArray<string>
  limitations?: ReadonlyArray<string>
  metric?: EvaluationCriterion['metric']
  landmarks?: ReadonlyArray<string>
  phase?: string | null
  target?: CriterionTarget | null
  thresholdBasis?: string | null
  weight?: number
  severity?: EvaluationCriterion['severity']
}

function toleranceOf(target: CriterionTarget | null): number | null {
  if (!target) return null
  return target.kind === 'between' ? target.tolerance : Math.abs(target.value - target.zeroAt)
}

function metricOf(measurement: CriterionMeasurement): Pick<EvaluationCriterion, 'metric' | 'landmarks'> {
  if (measurement.kind !== 'pose-window') return { metric: null, landmarks: [] }
  const definition = POSE_METRICS[measurement.metric]
  return { metric: { label: definition.label, unit: definition.unit }, landmarks: definition.landmarks }
}

/** 补全来源与测量派生的字段并冻结 */
export function defineCriterion(input: CriterionInput): EvaluationCriterion {
  const source = getScoringSource(input.sourceId)
  for (const id of input.additionalSourceIds ?? []) getScoringSource(id)
  const derived = metricOf(input.measurement)
  const target = input.target ?? null
  const phase = input.phase ?? (input.measurement.kind === 'pose-window' ? input.measurement.window.label : null)
  return Object.freeze({
    ...input,
    sourceType: source.type,
    sourceTitle: source.title,
    additionalSourceIds: Object.freeze([...(input.additionalSourceIds ?? [])]),
    limitations: Object.freeze([...(input.limitations ?? [])]),
    metric: input.metric ?? derived.metric,
    landmarks: Object.freeze([...(input.landmarks ?? derived.landmarks)]),
    phase,
    target,
    tolerance: toleranceOf(target),
    thresholdSource: target ? 'FORMPILOT_CALIBRATED' as const : 'NONE' as const,
    thresholdBasis: input.thresholdBasis ?? null,
    weight: input.scoring === 'SCORED' ? input.weight ?? 1 : 0,
    severity: input.severity ?? 'minor',
  })
}

/** 摄像头无法判断的要求（呼吸、眼神、手型…）：只展示，不计分 */
export function notObservable(input: Pick<EvaluationCriterion, 'id' | 'mode' | 'exercise' | 'name' | 'requirement' | 'sourceId'> & {
  evidenceLevel?: EvaluationCriterion['evidenceLevel']
  reason: string
  additionalSourceIds?: ReadonlyArray<string>
}): EvaluationCriterion {
  return defineCriterion({
    id: input.id,
    mode: input.mode,
    exercise: input.exercise,
    name: input.name,
    description: '本项需要人工观察，目前不计入自动评分。',
    requirement: input.requirement,
    sourceId: input.sourceId,
    additionalSourceIds: input.additionalSourceIds,
    evidenceLevel: input.evidenceLevel ?? 'A',
    observable: 'NOT_OBSERVABLE',
    scoring: 'REFERENCE_ONLY',
    measurement: { kind: 'none' },
    feedback: { issue: '', cue: input.requirement },
    limitations: [input.reason],
  })
}

/** 摄像头可以估计、但尚未自动化或定阈值的要求 */
export function referenceOnly(input: Pick<EvaluationCriterion, 'id' | 'mode' | 'exercise' | 'name' | 'requirement' | 'sourceId'> & {
  evidenceLevel?: EvaluationCriterion['evidenceLevel']
  reason: string
  additionalSourceIds?: ReadonlyArray<string>
}): EvaluationCriterion {
  return defineCriterion({
    id: input.id,
    mode: input.mode,
    exercise: input.exercise,
    name: input.name,
    description: '动作规范参考，目前不进入视觉评分。',
    requirement: input.requirement,
    sourceId: input.sourceId,
    additionalSourceIds: input.additionalSourceIds,
    evidenceLevel: input.evidenceLevel ?? 'A',
    observable: 'PROXY',
    scoring: 'REFERENCE_ONLY',
    measurement: { kind: 'none' },
    feedback: { issue: '', cue: input.requirement },
    limitations: [input.reason],
  })
}
