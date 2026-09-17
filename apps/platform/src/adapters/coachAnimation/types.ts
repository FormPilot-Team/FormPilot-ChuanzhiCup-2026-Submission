export interface CoachAnimationFrame {
  src: string
  alt: string
  caption: string
  canonicalPoseId: string
  poseAnchorSrc: string
  motionFrames?: ReadonlyArray<CoachMotionFrame>
}

export interface CoachMotionFrame {
  id: string
  src: string
  durationMs: number
}

export type CoachMotionMode = 'playing' | 'paused' | 'static'

export interface CoachAnimationAdapter {
  loadExercise(exerciseId: ExerciseId): void
  play(): void
  pause(): void
  reset(): void
  setLoop(loop: boolean): void
  getFrame(): CoachAnimationFrame
}
import type { ExerciseId } from '../../features/exercises/types'
