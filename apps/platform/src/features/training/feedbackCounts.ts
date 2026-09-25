import type { FeedbackEvent } from '../feedback/types'
import type { TrainingSessionState } from './types'

export function countFeedbackEvents(
  session: TrainingSessionState,
  kind: FeedbackEvent['kind'],
): number {
  return session.exercises.reduce(
    (total, exercise) => total + exercise.feedbackEvents.filter((event) => event.kind === kind).length,
    0,
  )
}
