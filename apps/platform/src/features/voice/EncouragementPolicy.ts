import type { CourseState } from '../course/CourseController'
import type { ExerciseId } from '../exercises/types'
import type { VoicePriority } from './VoiceGuidePolicy'

const ENCOURAGEMENTS = [
  '很好，保持这个节奏。',
  '动作不错，继续保持。',
  '很好，保持稳定。',
] as const

export interface EncouragementInput {
  exerciseId: ExerciseId
  exerciseIndex: number
  courseState: CourseState
  poseValid: boolean
  hasCorrection: boolean
  hasRecovery: boolean
  currentVoicePriority?: VoicePriority
  at: number
}

export class EncouragementPolicy {
  private stableSince?: number
  private encouragedExercise?: ExerciseId

  constructor(private readonly stableDurationMs = 6000) {}

  update(input: EncouragementInput): string | undefined {
    const eligible = input.courseState === 'ACTIVE'
      && input.poseValid
      && !input.hasCorrection
      && !input.hasRecovery
      && (input.currentVoicePriority === undefined || input.currentVoicePriority === 5)

    if (!eligible) {
      this.stableSince = undefined
      return undefined
    }
    if (this.encouragedExercise === input.exerciseId) return undefined
    this.stableSince ??= input.at
    if (input.at - this.stableSince < this.stableDurationMs) return undefined
    this.encouragedExercise = input.exerciseId
    this.stableSince = undefined
    return ENCOURAGEMENTS[input.exerciseIndex % ENCOURAGEMENTS.length]
  }

  resetForExercise(): void {
    this.stableSince = undefined
  }
}
