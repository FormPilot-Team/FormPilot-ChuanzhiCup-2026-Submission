import type { ExerciseSessionResult } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { collectIssueEvidence } from './issueEvidence'
import { REPORT_ISSUE_TAXONOMY } from './issueTaxonomy'
import type { WithinSessionInsight } from './types'

export function analyzeWithinSession(exercise: ExerciseSessionResult): WithinSessionInsight[] {
  const candidates = REPORT_ISSUE_TAXONOMY.filter((definition) => definition.exerciseId === exercise.exerciseId).flatMap((definition) => {
    const evidence = collectIssueEvidence(exercise, definition)
    const windowSize = Math.floor(evidence.affectedSequence.length / 2)
    if (windowSize < ANALYSIS_CONFIG_V1.withinSession.minWindowSize) return []
    const firstAffected = evidence.affectedSequence.slice(0, windowSize).filter(Boolean).length
    const lastAffected = evidence.affectedSequence.slice(-windowSize).filter(Boolean).length
    const reduction = firstAffected - lastAffected
    if (firstAffected < ANALYSIS_CONFIG_V1.withinSession.minFirstAffected
      || reduction < ANALYSIS_CONFIG_V1.withinSession.minAffectedReduction) return []
    return [{
      insight: {
        id: `within:${exercise.exerciseId}:${definition.code}`,
        exerciseId: exercise.exerciseId,
        issueCode: definition.code,
        firstWindow: { affected: firstAffected, evaluable: windowSize },
        lastWindow: { affected: lastAffected, evaluable: windowSize },
        text: `${definition.label}：前 ${windowSize} 次中 ${firstAffected} 次，后 ${windowSize} 次中 ${lastAffected} 次。`,
        evidenceRefs: evidence.evidenceRefs,
      } satisfies WithinSessionInsight,
      reduction,
    }]
  }).sort((left, right) => right.reduction - left.reduction || (left.insight.id < right.insight.id ? -1 : left.insight.id > right.insight.id ? 1 : 0))
  return candidates.slice(0, ANALYSIS_CONFIG_V1.withinSession.maxPerExercise).map((item) => item.insight)
}
