import type { ExerciseId } from '../features/exercises/types'
import type { TrainingScope } from '../features/training/trainingScope'

export const HOME_PATH = '/'
/** Smart-training entry: full course or one exercise, chosen before the camera starts. */
export const SMART_TRAINING_PATH = '/smart-training'
/** The one training page. Without `exercise` it runs the standard six-step course. */
export const TRAINING_PATH = '/train'
export const HISTORY_PATH = '/history'

export function reportPath(sessionId: string): string {
  return `/report/${encodeURIComponent(sessionId)}`
}

/** Product free-training entry. Never carries `fast`, which stays a DEV-only test switch. */
export function freeTrainingPath(exerciseId: ExerciseId): string {
  return `${TRAINING_PATH}?exercise=${encodeURIComponent(exerciseId)}`
}

/** Where "train again" leads for a saved session: the same exercise for free training, otherwise the full course. */
export function trainingEntryPath(scope: TrainingScope): string {
  return scope.kind === 'free_training' ? freeTrainingPath(scope.exerciseId) : TRAINING_PATH
}

const LEGACY_TRAINING_PARAMS = ['demo', 'course', 'debug', 'fast', 'exercise', 'fixture', 'coachFixture']

/** `/train`, plus the pre-`/train` diagnostic URLs that still open the training page from `/?demo=1…`. */
export function isTrainingRoute(pathname: string, search: string): boolean {
  if (pathname === TRAINING_PATH) return true
  if (pathname !== HOME_PATH) return false
  const params = new URLSearchParams(search)
  return LEGACY_TRAINING_PARAMS.some((key) => params.has(key))
}
