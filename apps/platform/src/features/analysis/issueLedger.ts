import type { ExerciseSessionResult } from '../training/types'
import { collectIssueEvidence } from './issueEvidence'
import { isSignificantIssue } from './issueComparison'
import { REPORT_ISSUE_TAXONOMY } from './issueTaxonomy'
import type { AnalysisIssue } from './types'

export function buildIssueLedger(exercise: ExerciseSessionResult): AnalysisIssue[] {
  return REPORT_ISSUE_TAXONOMY.filter((definition) => definition.exerciseId === exercise.exerciseId).map((definition) => {
    const evidence = collectIssueEvidence(exercise, definition)
    const reminderCount = exercise.feedbackEvents.filter((event) => event.kind === 'correction' && event.code === definition.code).length
    return {
      id: `${definition.exerciseId}:${definition.code}`,
      exerciseId: definition.exerciseId,
      code: definition.code,
      side: definition.side,
      theme: definition.theme,
      label: definition.label,
      cue: definition.cue,
      incidence: evidence.incidence,
      rate: evidence.incidence.evaluable > 0 ? evidence.incidence.affected / evidence.incidence.evaluable : null,
      significant: isSignificantIssue(evidence.incidence),
      reminderCount,
      trend: null,
      previousIncidence: null,
      evidenceRefs: evidence.evidenceRefs,
    }
  })
}
