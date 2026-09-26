import { freeTrainingPath } from '../../app/routes'
import { ELECTRONIC_COACH_COURSE_V1, type CourseStep } from '../../features/course/CourseDefinition'
import type { ExerciseId } from '../../features/exercises/types'
import { REPORT_EXERCISE_PRESENTATION } from '../../features/report/presentation'

export interface FreeTrainingOption {
  exerciseId: ExerciseId
  name: string
  focus: string
  target: string
  href: string
}

/** Plain-language training focus shown on each free-training card. */
const FOCUS: Readonly<Record<ExerciseId, string>> = Object.freeze({
  shoulder_rotation: '热身 · 肩部活动',
  overhead_raise: '上肢活动 · 肩部与手臂',
  lateral_raise: '肩部控制',
  step_jack: '全身协调',
  squat: '下肢力量与控制',
  knee_raise: '下肢协调与稳定',
})

export function courseTargetText(step: CourseStep): string {
  const unit = step.target.type === 'duration' ? '秒' : step.target.type === 'cycles' ? '组' : '次'
  return `目标 ${step.target.value} ${unit}`
}

/** The course steps in course order; free training uses each step's own target. */
export const FREE_TRAINING_OPTIONS: readonly FreeTrainingOption[] = Object.freeze(ELECTRONIC_COACH_COURSE_V1.steps.map((step) => ({
  exerciseId: step.exerciseId,
  name: REPORT_EXERCISE_PRESENTATION[step.exerciseId].name,
  focus: FOCUS[step.exerciseId],
  target: courseTargetText(step),
  href: freeTrainingPath(step.exerciseId),
})))
