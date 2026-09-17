import type { ExerciseSessionResult } from '../training/types'
import { REPORT_EXERCISE_PRESENTATION, REPORT_ISSUE_LABELS } from './presentation'
import type { ReportIssue } from './types'

export function aggregateConfirmedIssues(exercises: ReadonlyArray<ExerciseSessionResult>): ReportIssue[] {
  const grouped = new Map<string, ReportIssue>()
  for (const exercise of exercises) {
    for (const event of exercise.feedbackEvents) {
      if (event.kind !== 'correction' || !event.code) continue
      const key = `${exercise.exerciseId}:${event.code}`
      const existing = grouped.get(key)
      if (existing) {
        existing.count += 1
        existing.maxSeverity = Math.max(existing.maxSeverity, event.severity)
        existing.firstTimestamp = Math.min(existing.firstTimestamp, event.timestamp)
        if (existing.side !== event.side) delete existing.side
        continue
      }
      grouped.set(key, {
        id: key,
        exerciseId: exercise.exerciseId,
        exerciseName: REPORT_EXERCISE_PRESENTATION[exercise.exerciseId].name,
        errorCode: event.code,
        reportLabel: REPORT_ISSUE_LABELS[event.code] ?? event.message,
        message: event.message,
        count: 1,
        side: event.side,
        maxSeverity: event.severity,
        firstTimestamp: event.timestamp,
      })
    }
  }
  return [...grouped.values()].sort((left, right) =>
    right.count - left.count
    || right.maxSeverity - left.maxSeverity
    || left.firstTimestamp - right.firstTimestamp
    || left.id.localeCompare(right.id),
  )
}

export function topConfirmedIssues(exercises: ReadonlyArray<ExerciseSessionResult>, limit = 3): ReportIssue[] {
  return aggregateConfirmedIssues(exercises).slice(0, limit)
}
