import type { ExerciseId } from '../exercises/types'

export type CourseTargetType = 'duration' | 'reps' | 'cycles'
export type EvaluationMode = 'guidance' | 'scored'

export interface CourseStep {
  exerciseId: ExerciseId
  target: { type: CourseTargetType; value: number }
  evaluationMode: EvaluationMode
  preparation: 'pose_ready' | 'standing_baseline'
}

export interface CourseDefinition {
  id: string
  version: string
  displayName: string
  countdownSeconds: number
  transitionMs: number
  steps: ReadonlyArray<CourseStep>
}

export const ELECTRONIC_COACH_COURSE_V1: Readonly<CourseDefinition> = Object.freeze({
  id: 'electronic-coach-six-step', version: '1.0.0', displayName: 'AI 电子教练 · 全身训练',
  countdownSeconds: 3, transitionMs: 2000,
  steps: Object.freeze([
    { exerciseId: 'shoulder_rotation', target: { type: 'duration', value: 15 }, evaluationMode: 'guidance', preparation: 'pose_ready' },
    { exerciseId: 'overhead_raise', target: { type: 'reps', value: 6 }, evaluationMode: 'scored', preparation: 'pose_ready' },
    { exerciseId: 'lateral_raise', target: { type: 'reps', value: 6 }, evaluationMode: 'scored', preparation: 'pose_ready' },
    { exerciseId: 'step_jack', target: { type: 'cycles', value: 6 }, evaluationMode: 'scored', preparation: 'pose_ready' },
    { exerciseId: 'squat', target: { type: 'reps', value: 6 }, evaluationMode: 'scored', preparation: 'standing_baseline' },
    { exerciseId: 'knee_raise', target: { type: 'reps', value: 10 }, evaluationMode: 'scored', preparation: 'standing_baseline' },
  ] satisfies CourseStep[]),
})

export function resolveCourseTarget(step: CourseStep, fastMode: boolean): number {
  if (!fastMode) return step.target.value
  return step.target.type === 'duration' ? 1 : step.target.type === 'cycles' ? 1 : 1
}
