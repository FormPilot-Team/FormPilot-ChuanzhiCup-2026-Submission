export type ExercisePhase =
  | 'START'
  | 'RAISING'
  | 'TOP'
  | 'LOWERING'
  | 'COMPLETE'
  | 'CENTER'
  | 'LEFT_OPENING'
  | 'LEFT_OPEN'
  | 'RETURNING_FROM_LEFT'
  | 'RIGHT_OPENING'
  | 'RIGHT_OPEN'
  | 'RETURNING_FROM_RIGHT'
  | 'STANDING'
  | 'DESCENDING'
  | 'BOTTOM'
  | 'ASCENDING'
  | 'LEFT_RAISING'
  | 'LEFT_TOP'
  | 'LEFT_RETURNING'
  | 'RIGHT_RAISING'
  | 'RIGHT_TOP'
  | 'RIGHT_RETURNING'
  | 'READY'
  | 'ROTATING'

export type ExerciseId = 'shoulder_rotation' | 'overhead_raise' | 'lateral_raise' | 'step_jack' | 'squat' | 'knee_raise'

export interface MetricScore {
  value: number
  score: number
  valid: boolean
  unit?: string
}

export type MotionErrorCode =
  | 'ARM_TOO_LOW_L'
  | 'ARM_TOO_LOW_R'
  | 'ELBOW_TOO_BENT_L'
  | 'ELBOW_TOO_BENT_R'
  | 'ASYMMETRY'
  | 'TORSO_LEAN'
  | 'TOO_FAST'
  | 'INCOMPLETE_REP'
  | 'POSE_LOW_CONFIDENCE'
  | 'BODY_OUT_OF_FRAME'
  | 'STEP_TOO_SMALL'
  | 'ARM_TOO_LOW'
  | 'ARM_LEG_UNSYNCED'
  | 'WRONG_SIDE_SEQUENCE'
  | 'BODY_SWAY'
  | 'INCOMPLETE_RETURN'
  | 'DEPTH_INSUFFICIENT'
  | 'KNEE_VALGUS'
  | 'LEFT_RIGHT_ASYMMETRY'
  | 'TORSO_LATERAL_LEAN'
  | 'KNEE_TOO_LOW_L'
  | 'KNEE_TOO_LOW_R'
  | 'LEFT_RIGHT_HEIGHT_GAP'
  | 'MOTION_TOO_SMALL'
  | 'ARMS_UNSYNCED'
  | 'MOTION_PAUSED'
  | 'ARMS_TOO_LOW'

export interface MotionError {
  code: MotionErrorCode
  severity: number
  side?: 'left' | 'right'
  message: string
}

export type RuleMetrics = Record<string, MetricScore>

export interface RuleResult {
  exerciseId: ExerciseId
  phase: ExercisePhase
  confidence: number
  metrics: RuleMetrics
  currentScore: number
  errors: MotionError[]
  primaryFeedback?: MotionError
}

export interface BaseRepSummary {
  exerciseId: ExerciseId
  repIndex: number
  startedAt: number
  completedAt: number
  durationMs: number
  maxTorsoLean: number
}

export interface LateralRaiseRepSummary extends BaseRepSummary {
  exerciseId: 'lateral_raise'
  topHoldMs: number
  peakShoulderL: number
  peakShoulderR: number
  minElbowL: number
  minElbowR: number
  maxSymmetryDiff: number
}

export interface StepJackRepSummary extends BaseRepSummary {
  exerciseId: 'step_jack'
  side: 'left' | 'right'
  peakOpenRatio: number
  peakMeanShoulderAngle: number
  maxArmAngleDiff: number
  syncGapMs: number
  wrongSideSequence: boolean
  incompleteReturn: boolean
}

export interface SquatRepSummary extends BaseRepSummary {
  exerciseId: 'squat'
  bottomTime: number
  maxHipDrop: number
  minKneeSpreadRatio: number
  maxKneeHeightDiff: number
  depthScore: number
  stabilityScore: number
  symmetryScore: number
  completionScore: number
  tempoScore: number
  overallScore: number
  errors: MotionErrorCode[]
}

export interface KneeRaiseRepSummary extends BaseRepSummary {
  exerciseId: 'knee_raise'
  side: 'left' | 'right'
  startTime: number
  topTime: number
  endTime: number
  peakKneeHeight: number
  hipShiftMax: number
  amplitudeScore: number
  stabilityScore: number
  alternationScore: number
  symmetryScore: number
  tempoScore: number
  overallScore: number
  errors: MotionErrorCode[]
  wrongSideSequence: boolean
  incompleteReturn: boolean
}

export interface OverheadRaiseRepSummary extends BaseRepSummary {
  exerciseId: 'overhead_raise'
  peakShoulderL: number
  peakShoulderR: number
  minElbowL: number
  minElbowR: number
  /** Lowest qualified elbow angle observed while the state machine is in TOP. */
  topElbowL?: number
  /** Lowest qualified elbow angle observed while the state machine is in TOP. */
  topElbowR?: number
  maxSymmetryDiff: number
  amplitudeScore: number
  elbowScore: number
  synchronizationScore: number
  stabilityScore: number
  tempoScore: number
  overallScore: number
  errors: MotionErrorCode[]
}

export type RepSummary = LateralRaiseRepSummary | StepJackRepSummary | SquatRepSummary | KneeRaiseRepSummary | OverheadRaiseRepSummary

export interface ExerciseState {
  phase: ExercisePhase
  repCount: number
  completedRep?: RepSummary
}

export function isLateralRaiseRep(rep: RepSummary): rep is LateralRaiseRepSummary {
  return rep.exerciseId === 'lateral_raise'
}

export function isStepJackRep(rep: RepSummary): rep is StepJackRepSummary {
  return rep.exerciseId === 'step_jack'
}

export function isSquatRep(rep: RepSummary): rep is SquatRepSummary {
  return rep.exerciseId === 'squat'
}

export function isKneeRaiseRep(rep: RepSummary): rep is KneeRaiseRepSummary {
  return rep.exerciseId === 'knee_raise'
}

export function isOverheadRaiseRep(rep: RepSummary): rep is OverheadRaiseRepSummary {
  return rep.exerciseId === 'overhead_raise'
}
