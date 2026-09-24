import type { CourseSnapshot, CourseState } from '../course/CourseController'
import type { ExerciseId } from '../exercises/types'

export interface DemonstrationSource {
  exerciseId: ExerciseId
  displayName: string
  src: string
  type: 'video/mp4'
}

export const DEMONSTRATION_SOURCES: Readonly<Record<ExerciseId, DemonstrationSource>> = Object.freeze({
  shoulder_rotation: { exerciseId: 'shoulder_rotation', displayName: '肩部环绕', src: '/assets/demos/shoulder-rotation.mp4', type: 'video/mp4' },
  overhead_raise: { exerciseId: 'overhead_raise', displayName: '双臂上举', src: '/assets/demos/overhead-raise.mp4', type: 'video/mp4' },
  lateral_raise: { exerciseId: 'lateral_raise', displayName: '侧平举', src: '/assets/demos/lateral-raise.mp4', type: 'video/mp4' },
  step_jack: { exerciseId: 'step_jack', displayName: 'Step Jack', src: '/assets/demos/step-jack.mp4', type: 'video/mp4' },
  squat: { exerciseId: 'squat', displayName: '深蹲', src: '/assets/demos/squat.mp4', type: 'video/mp4' },
  knee_raise: { exerciseId: 'knee_raise', displayName: '交替提膝', src: '/assets/demos/alternating-knee-raise.mp4', type: 'video/mp4' },
})

export type DemonstrationPlayback = 'preview' | 'playing' | 'paused' | 'stopped'

export interface DemonstrationDirective {
  exerciseId: ExerciseId
  playback: DemonstrationPlayback
}

function playbackForState(state: CourseState): DemonstrationPlayback {
  if (state === 'ACTIVE') return 'playing'
  if (state === 'PAUSED') return 'paused'
  if (state === 'COURSE_COMPLETE' || state === 'COURSE_INCOMPLETE') return 'stopped'
  return 'preview'
}

export function resolveDemonstrationDirective(
  snapshot: CourseSnapshot,
  currentExerciseId: ExerciseId,
  nextExerciseId?: ExerciseId,
): DemonstrationDirective {
  const transition = snapshot.state === 'TRANSITION'
    || (snapshot.state === 'PAUSED' && snapshot.previousState === 'TRANSITION')

  return {
    exerciseId: transition && nextExerciseId ? nextExerciseId : currentExerciseId,
    playback: playbackForState(snapshot.state),
  }
}

export function getDemonstrationSource(exerciseId: ExerciseId): DemonstrationSource | undefined {
  return DEMONSTRATION_SOURCES[exerciseId]
}
