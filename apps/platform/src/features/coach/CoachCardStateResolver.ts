import type { CoachCardResolverInput, CoachCardState, CoachCardViewModel, CoachTargetViewModel } from './types'
import { effectiveCourseState } from './types'

export const DEFAULT_POSITIVE_DISPLAY_MS = 1200

const STATUS_LABEL: Record<CoachCardState, CoachCardViewModel['statusLabel']> = {
  PREPARING: '准备中',
  ACTIVE: '训练中',
  CORRECTING: '动作纠正',
  POSITIVE: '已调整',
  TRANSITION: '本动作完成',
}

function targetViewModel(input: CoachCardResolverInput): CoachTargetViewModel {
  const current = Math.max(0, Math.floor(input.currentProgress))
  const value = Math.max(0, Math.floor(input.targetValue))
  const label = input.targetType === 'duration'
    ? `剩余 ${Math.max(0, value - current).toString().padStart(2, '0')}s`
    : input.targetType === 'cycles'
      ? `${current} / ${value} 组`
      : `${current} / ${value}`
  return { type: input.targetType, current, value, label }
}

function stableView(previous: CoachCardViewModel | undefined, next: CoachCardViewModel): CoachCardViewModel {
  if (!previous) return next
  const unchanged = previous.state === next.state
    && previous.exerciseId === next.exerciseId
    && previous.exerciseName === next.exerciseName
    && previous.statusLabel === next.statusLabel
    && previous.primaryMessage === next.primaryMessage
    && previous.secondaryMessage === next.secondaryMessage
    && previous.target.type === next.target.type
    && previous.target.current === next.target.current
    && previous.target.value === next.target.value
    && previous.target.label === next.target.label
    && previous.coachAsset.src === next.coachAsset.src
    && previous.highlightRegion === next.highlightRegion
    && previous.direction === next.direction
    && previous.countdown === next.countdown
    && previous.paused === next.paused
    && previous.positiveSourceError === next.positiveSourceError
    && previous.positiveRemainingMs === next.positiveRemainingMs
    && previous.nextExercise?.id === next.nextExercise?.id
  return unchanged ? previous : next
}

export class CoachCardStateResolver {
  private positiveRemainingMs = 0
  private positiveSourceError?: string
  private positiveMessage?: string
  private lastRecoveryId?: string
  private lastNow?: number
  private wasPaused = false
  private exerciseId?: CoachCardResolverInput['exercise']['id']
  private viewModel?: CoachCardViewModel

  constructor(private readonly positiveDisplayMs = DEFAULT_POSITIVE_DISPLAY_MS) {}

  reset(): void {
    this.positiveRemainingMs = 0
    this.positiveSourceError = undefined
    this.positiveMessage = undefined
    this.lastRecoveryId = undefined
    this.lastNow = undefined
    this.wasPaused = false
    this.exerciseId = undefined
    this.viewModel = undefined
  }

  resolve(input: CoachCardResolverInput): CoachCardViewModel {
    if (this.exerciseId !== input.exercise.id) {
      this.reset()
      this.exerciseId = input.exercise.id
    }

    const paused = input.courseSnapshot.state === 'PAUSED'
    if (paused) {
      if (!this.wasPaused && this.lastNow !== undefined) {
        this.positiveRemainingMs = Math.max(0, this.positiveRemainingMs - Math.max(0, input.now - this.lastNow))
      }
      this.wasPaused = true
      this.lastNow = input.now
      if (this.viewModel) {
        this.viewModel = stableView(this.viewModel, {
          ...this.viewModel,
          paused: true,
          positiveRemainingMs: this.viewModel.state === 'POSITIVE' ? Math.ceil(this.positiveRemainingMs) : 0,
        })
        return this.viewModel
      }
    } else {
      if (!this.wasPaused && this.lastNow !== undefined) {
        this.positiveRemainingMs = Math.max(0, this.positiveRemainingMs - Math.max(0, input.now - this.lastNow))
      }
      this.wasPaused = false
      this.lastNow = input.now
    }

    if (!paused && input.recoveredFeedback && input.recoveredFeedback.id !== this.lastRecoveryId) {
      this.lastRecoveryId = input.recoveredFeedback.id
      this.positiveRemainingMs = this.positiveDisplayMs
      this.positiveSourceError = input.recoveredFeedback.code
      this.positiveMessage = input.recoveredFeedback.message
    }

    if (!paused && input.confirmedPrimaryFeedback) {
      this.positiveRemainingMs = 0
      this.positiveSourceError = undefined
      this.positiveMessage = undefined
    }

    const courseState = effectiveCourseState(input.courseSnapshot)
    let state: CoachCardState
    if (courseState === 'TRANSITION') state = 'TRANSITION'
    else if (!input.exerciseReady || courseState === 'PREPARING' || courseState === 'COUNTDOWN') state = 'PREPARING'
    else if (input.confirmedPrimaryFeedback) state = 'CORRECTING'
    else if (this.positiveRemainingMs > 0) state = 'POSITIVE'
    else state = 'ACTIVE'

    const correction = input.confirmedPrimaryFeedback
      ? input.exercise.presentation.coach.corrections[input.confirmedPrimaryFeedback.code]
      : undefined
    const transitionAsset = state === 'TRANSITION' && input.nextExercise ? input.nextExercise : input.exercise
    const target = targetViewModel(input)
    const nextExercise = input.nextExercise ? {
      id: input.nextExercise.id,
      name: input.nextExercise.name,
      preparationText: input.nextExercise.presentation.coach.preparationText,
    } : undefined

    const primaryMessage = state === 'TRANSITION'
      ? `✓ ${input.exercise.name}完成`
      : state === 'PREPARING'
        ? input.exercise.presentation.coach.preparationText
        : state === 'CORRECTING'
          ? input.confirmedPrimaryFeedback?.message ?? input.exercise.presentation.coach.activeText
          : state === 'POSITIVE'
            ? this.positiveMessage ?? '很好，保持这个状态'
            : input.exercise.presentation.coach.activeText
    const secondaryMessage = state === 'TRANSITION'
      ? nextExercise
        ? `下一动作：${nextExercise.name} · ${nextExercise.preparationText}`
        : '下一步：课程总结'
      : undefined

    const next: CoachCardViewModel = {
      state,
      exerciseId: input.exercise.id,
      exerciseName: input.exercise.name,
      statusLabel: STATUS_LABEL[state],
      primaryMessage,
      secondaryMessage,
      target,
      coachAsset: transitionAsset.asset,
      referenceProfile: transitionAsset.referenceProfile,
      highlightRegion: state === 'CORRECTING' ? correction?.highlightRegion ?? 'none' : 'none',
      direction: state === 'CORRECTING' ? correction?.direction : undefined,
      countdown: state === 'PREPARING' && courseState === 'COUNTDOWN' ? input.courseSnapshot.countdown : undefined,
      paused,
      positiveSourceError: state === 'POSITIVE' ? this.positiveSourceError : undefined,
      positiveRemainingMs: state === 'POSITIVE' ? Math.ceil(this.positiveRemainingMs) : 0,
      nextExercise: state === 'TRANSITION' ? nextExercise : undefined,
    }
    this.viewModel = stableView(this.viewModel, next)
    return this.viewModel
  }
}
