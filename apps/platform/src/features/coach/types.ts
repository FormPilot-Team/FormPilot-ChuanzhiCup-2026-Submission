import type { CoachAnimationFrame } from '../../adapters/coachAnimation/types'
import type { CourseState, CourseSnapshot } from '../course/CourseController'
import type { CourseTargetType } from '../course/CourseDefinition'
import type { ExercisePresentation } from '../exercises/contract'
import type { ExerciseId, MotionError } from '../exercises/types'
import type { FeedbackEvent } from '../feedback/types'
import type { ExerciseReferenceProfile } from '../referencePose/types'

export type CoachCardState = 'PREPARING' | 'ACTIVE' | 'CORRECTING' | 'POSITIVE' | 'TRANSITION'

export type CoachHighlightRegion =
  | 'left_arm'
  | 'right_arm'
  | 'left_elbow'
  | 'right_elbow'
  | 'both_arms'
  | 'left_knee'
  | 'right_knee'
  | 'knees'
  | 'hip_depth'
  | 'core'
  | 'full_body'
  | 'none'

export type CoachDirection = 'up' | 'down'

export interface CoachTargetViewModel {
  type: CourseTargetType
  current: number
  value: number
  label: string
}

export interface CoachExerciseInput {
  id: ExerciseId
  name: string
  presentation: ExercisePresentation
  asset: CoachAnimationFrame
  referenceProfile: ExerciseReferenceProfile
}

export interface CoachCardResolverInput {
  now: number
  courseSnapshot: Pick<CourseSnapshot, 'state' | 'previousState' | 'countdown'>
  exerciseReady: boolean
  exercise: CoachExerciseInput
  targetType: CourseTargetType
  currentProgress: number
  targetValue: number
  confirmedPrimaryFeedback?: MotionError
  recoveredFeedback?: FeedbackEvent
  nextExercise?: CoachExerciseInput
}

export interface CoachCardViewModel {
  state: CoachCardState
  exerciseId: ExerciseId
  exerciseName: string
  statusLabel: '准备中' | '训练中' | '动作纠正' | '已调整' | '本动作完成'
  primaryMessage: string
  secondaryMessage?: string
  target: CoachTargetViewModel
  coachAsset: CoachAnimationFrame
  referenceProfile: ExerciseReferenceProfile
  highlightRegion: CoachHighlightRegion
  direction?: CoachDirection
  countdown?: number
  paused: boolean
  positiveSourceError?: string
  positiveRemainingMs: number
  nextExercise?: { id: ExerciseId; name: string; preparationText: string }
}

export function effectiveCourseState(snapshot: CoachCardResolverInput['courseSnapshot']): CourseState {
  return snapshot.state === 'PAUSED' ? snapshot.previousState ?? 'PREPARING' : snapshot.state
}
