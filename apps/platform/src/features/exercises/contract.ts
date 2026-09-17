import type { FeedbackEvent } from '../feedback/types'
import type { BaseMotionFeatures, ExerciseFeatureExtractor } from '../motion/types'
import type { NormalizedPoseFrame } from '../pose/PoseNormalizer'
import type { ExerciseId, ExercisePhase, ExerciseState, MotionError, MotionErrorCode, RuleResult } from './types'
import type { CoachDirection, CoachHighlightRegion } from '../coach/types'
import type { ExerciseReferenceProfile } from '../referencePose/types'
import type { ThresholdVersion } from './thresholdVersioning'

export interface ExerciseEngineOutput<TState extends ExerciseState = ExerciseState> {
  result: RuleResult
  state: TState
  feedback?: FeedbackEvent
  confirmedPrimaryFeedback?: MotionError
  recoveredFeedback?: FeedbackEvent
}

export interface CoachCorrectionPresentation {
  errorCode: MotionErrorCode
  highlightRegion: CoachHighlightRegion
  direction?: CoachDirection
}

export interface CoachExercisePresentation {
  preparationText: string
  activeText: string
  corrections: Partial<Record<MotionErrorCode, CoachCorrectionPresentation>>
}

export interface ExerciseEngine<
  TFeatures extends BaseMotionFeatures = BaseMotionFeatures,
  TState extends ExerciseState = ExerciseState,
> {
  process(features: TFeatures): ExerciseEngineOutput<TState>
  reset(): void
}

export interface MetricPresentation {
  key: string
  label: string
  note: string
  icon: 'amplitude' | 'symmetry' | 'coordination' | 'stability' | 'tempo'
  tone: 'blue' | 'green'
}

export interface ExercisePresentation {
  subtitle: string
  guidance: string
  adviceFallback: string
  phaseHint: string
  coach: CoachExercisePresentation
  targetReps: number
  fastTargetReps: number
  durationSeconds: number
  initialPhase: ExercisePhase
  metrics: ReadonlyArray<MetricPresentation>
  phaseLabels: Partial<Record<ExercisePhase, string>>
  cameraDemo: {
    portraitSrc: string
    landscapeSrc: string
    alt: string
    fit?: 'cover' | 'contain'
    sequence?: ReadonlyArray<{ id: string; src: string; durationMs: number }>
  }
}

export interface ExerciseDebugContext<
  TFeatures extends BaseMotionFeatures = BaseMotionFeatures,
  TState extends ExerciseState = ExerciseState,
> {
  features?: TFeatures
  state: TState
  result: RuleResult
}

export interface DebugDatum {
  label: string
  value: string
}

export interface ExerciseDefinition<
  TFeatures extends BaseMotionFeatures = BaseMotionFeatures,
  TState extends ExerciseState = ExerciseState,
> {
  id: ExerciseId
  displayName: string
  specVersion: string
  thresholdVersion: ThresholdVersion
  createFeatureExtractor(): ExerciseFeatureExtractor<TFeatures>
  createEngine(): ExerciseEngine<TFeatures, TState>
  presentation: ExercisePresentation
  reference: ExerciseReferenceProfile
  getDebugData(context: ExerciseDebugContext<TFeatures, TState>): ReadonlyArray<DebugDatum>
  isPoseCompatible(frame: NormalizedPoseFrame): boolean
}
