import type { RoutineId } from '../../routines/types'
import type { PoseMetricId } from '../routine/poseMetrics'
import type { PhaseWindowSpec } from '../routine/phaseWindows'
import type { CriterionTarget, EvaluationCriterion, EvidenceLevel, Observability, Severity, WindowAggregation } from '../types'
import { defineCriterion } from './define'

export interface PoseCheckInput {
  id: string
  exercise: string
  name: string
  description: string
  requirement: string
  sourceId: string
  additionalSourceIds?: ReadonlyArray<string>
  evidenceLevel: EvidenceLevel
  observable: Exclude<Observability, 'NOT_OBSERVABLE'>
  scoring?: 'SCORED' | 'ADVISORY'
  metric: PoseMetricId
  aggregation: WindowAggregation
  window: PhaseWindowSpec
  target: CriterionTarget
  thresholdBasis: string
  weight?: number
  severity?: Severity
  feedback: { issue: string; cue: string }
  limitations?: ReadonlyArray<string>
}

/** A follow-along technique check: the user's metric inside phase windows found in the standard video. */
export function poseCheck(mode: RoutineId, input: PoseCheckInput): EvaluationCriterion {
  return defineCriterion({
    id: input.id,
    mode,
    exercise: input.exercise,
    name: input.name,
    description: input.description,
    requirement: input.requirement,
    sourceId: input.sourceId,
    additionalSourceIds: [...(input.additionalSourceIds ?? []), 'fp-reference-demo'].filter((id, index, all) => id !== input.sourceId && all.indexOf(id) === index),
    evidenceLevel: input.evidenceLevel,
    observable: input.observable,
    scoring: input.scoring ?? 'SCORED',
    measurement: { kind: 'pose-window', metric: input.metric, aggregation: input.aggregation, window: input.window },
    target: input.target,
    thresholdBasis: `FormPilot 标定（按标准示范实测值留出余量）：${input.thresholdBasis}`,
    weight: input.weight ?? 1,
    severity: input.severity ?? 'minor',
    feedback: input.feedback,
    limitations: input.limitations,
  })
}

/** Routine-wide requirements a camera cannot judge. */
export const COMMON_NOT_OBSERVABLE_REASONS = Object.freeze({
  breathing: '呼吸节律无法从二维姿态可靠判断；标准视频的口令已包含呼吸提示。',
  intent: '意念、神态与精神状态无法从画面判断。',
  gaze: '眼神与目视方向需要面部细节，当前全身关键点不足以可靠判断。',
  handShape: '手型（指节屈伸、掌型变化）需要手部关键点，当前全身姿态模型不提供可靠的手指细节。',
})
