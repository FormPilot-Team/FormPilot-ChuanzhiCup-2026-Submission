import type { CourseState } from '../course/CourseController'
import type { RoutineFeedback } from '../routines/followAlong/feedbackPolicy'
import type { FollowAlongMatch } from '../routines/followAlong/matcher'
import { chapterDisplayName } from '../routines/scope'
import type { RoutineChapter, RoutineProgram } from '../routines/types'
import type { CoachContext, RecentReportSummary } from './types'

export interface RoutineCoachContextInput {
  program: RoutineProgram
  chapter: RoutineChapter
  chapterPosition: { index: number; total: number }
  courseState: CourseState
  elapsedSeconds: number
  totalSeconds: number
  coveredSeconds: number
  match?: FollowAlongMatch
  feedback?: RoutineFeedback
  recentReports: ReadonlyArray<RecentReportSummary>
}

/** Live context of a follow-along routine for the future AI Coach. Pure: everything comes from the runtime. */
export function buildRoutineCoachContext(input: RoutineCoachContextInput): CoachContext {
  const { program, chapter, match, feedback } = input
  const measured = match && match.status !== 'insufficient'
  return {
    currentMode: { id: program.id, title: program.title, kind: 'routine' },
    currentExercise: {
      id: chapter.id,
      name: chapterDisplayName(chapter),
      position: `${input.chapterPosition.index + 1} / ${input.chapterPosition.total}`,
      cue: chapter.cue,
    },
    currentFeedback: feedback ? { code: feedback.code, message: feedback.message, tone: feedback.tone } : null,
    sessionStats: {
      state: input.courseState,
      elapsedSeconds: Math.max(0, Math.round(input.elapsedSeconds)),
      totalSeconds: Math.round(input.totalSeconds),
      metrics: {
        similarity: measured ? Math.round(match.similarity * 100) : null,
        timingOffsetMs: measured ? Math.round(match.timingOffsetMs) : null,
        arms: measured && match.regionScores.arms !== null ? Math.round(match.regionScores.arms * 100) : null,
        torso: measured && match.regionScores.torso !== null ? Math.round(match.regionScores.torso * 100) : null,
        legs: measured && match.regionScores.legs !== null ? Math.round(match.regionScores.legs * 100) : null,
        coverage: input.totalSeconds > 0 ? Math.round((input.coveredSeconds / input.totalSeconds) * 100) : null,
      },
    },
    recentReports: input.recentReports,
  }
}
