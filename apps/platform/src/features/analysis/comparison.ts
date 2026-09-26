import type { TrainingSessionState } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { COMPARISON_REASON_TEXT } from './copy'
import { compareCodeUnits, finite } from './ratio'
import { sameRulesVersion } from './rulesSupport'
import { buildSessionFacts, exerciseComparable, sessionConditions, type SessionFacts } from './sessionFacts'
import type { CandidateExclusion, Comparison, ComparisonReason, ScoredExerciseId } from './types'

export interface ComparisonSelection {
  comparison: Comparison
  previous: SessionFacts | null
}

function candidateExclusions(candidate: TrainingSessionState, current: TrainingSessionState): CandidateExclusion[] {
  const conditions = sessionConditions(candidate)
  const reasons: CandidateExclusion[] = []
  if (conditions.source !== 'live') reasons.push('NOT_LIVE')
  if (conditions.mode === 'fast') reasons.push('FAST_MODE')
  if (conditions.mode === 'unknown') reasons.push('MODE_UNKNOWN')
  if (conditions.rulesSupport === 'LEGACY_UNVERSIONED') reasons.push('RULES_UNVERSIONED')
  // A blocked (unversioned/unsupported) current never reaches candidate selection; do not blame the candidate for it.
  else if (conditions.rulesSupport !== 'SUPPORTED' || (current.rulesVersion && !sameRulesVersion(candidate, current))) reasons.push('RULES_MISMATCH')
  if (!conditions.courseFlow) reasons.push('NOT_COURSE_FLOW')
  if (!conditions.finalized) reasons.push('NOT_FINALIZED')
  return reasons
}

/**
 * Current-session gate. 8F-1A §4 lists MODE_UNKNOWN before RULES_UNVERSIONED, but §26 fixture 10 requires a real
 * legacy session (no rulesVersion, no mode) to report CURRENT_RULES_UNVERSIONED, so the missing rules version is
 * checked first and is never masked by the missing mode (SPEC_CONFLICT resolved in 8F-1D).
 */
function currentReason(current: TrainingSessionState): ComparisonReason | null {
  const conditions = sessionConditions(current)
  if (conditions.source !== 'live') return 'CURRENT_NOT_LIVE'
  if (conditions.rulesSupport === 'LEGACY_UNVERSIONED') return 'CURRENT_RULES_UNVERSIONED'
  if (conditions.mode === 'unknown') return 'CURRENT_MODE_UNKNOWN'
  if (conditions.mode === 'fast') return 'CURRENT_FAST_MODE'
  if (conditions.rulesSupport === 'UNSUPPORTED') return 'CURRENT_RULES_UNSUPPORTED'
  if (!conditions.courseFlow) return 'CURRENT_NOT_COURSE_FLOW'
  if (!conditions.finalized) return 'CURRENT_NOT_FINALIZED'
  return null
}

function none(reason: ComparisonReason, excluded: Comparison['excluded']): ComparisonSelection {
  return {
    comparison: {
      level: 'NONE',
      reason,
      reasonText: COMPARISON_REASON_TEXT[reason],
      previousSessionId: null,
      previousStartedAt: null,
      commonExerciseIds: [],
      overallDeltaAllowed: false,
      excluded,
    },
    previous: null,
  }
}

function commonComparable(current: SessionFacts, previous: SessionFacts): ScoredExerciseId[] {
  return current.exercises
    .filter((item, index) => exerciseComparable(item) && exerciseComparable(previous.exercises[index]))
    .map((item) => item.exerciseId)
}

export function selectPreviousComparable(current: SessionFacts, history: readonly TrainingSessionState[]): ComparisonSelection {
  const session = current.session
  const prior = history
    .filter((item) => item && item.id !== session.id && finite(item.startedAt) && item.startedAt < session.startedAt)
    .sort((left, right) => right.startedAt - left.startedAt || compareCodeUnits(right.id, left.id))
  if (prior.length === 0) return none('NO_PREVIOUS_SESSION', [])

  const excluded: Comparison['excluded'] = []
  const candidates: TrainingSessionState[] = []
  for (const item of prior) {
    const reasons = candidateExclusions(item, session)
    if (reasons.length) excluded.push({ sessionId: item.id, reasons })
    else candidates.push(item)
  }

  const blocked = currentReason(session)
  if (blocked) return none(blocked, excluded)
  if (candidates.length === 0) return none('NO_ELIGIBLE_PREVIOUS', excluded)

  const facts = candidates.map((item) => buildSessionFacts(item))
  const select = (previous: SessionFacts, level: 'FULL' | 'PARTIAL', reason: ComparisonReason | null, common: ScoredExerciseId[]): ComparisonSelection => ({
    comparison: {
      level,
      reason,
      reasonText: reason ? COMPARISON_REASON_TEXT[reason].replace('{k}', String(common.length)) : null,
      previousSessionId: previous.session.id,
      previousStartedAt: previous.session.startedAt,
      commonExerciseIds: common,
      overallDeltaAllowed: level === 'FULL',
      excluded,
    },
    previous,
  })

  if (current.fullScope) {
    const full = facts.find((item) => item.fullScope)
    if (full) return select(full, 'FULL', null, [...ANALYSIS_CONFIG_V1.scoredExerciseIds])
  }
  for (const previous of facts) {
    const common = commonComparable(current, previous)
    if (common.length >= ANALYSIS_CONFIG_V1.comparison.partialMinCommonExercises) {
      return select(previous, 'PARTIAL', current.fullScope ? 'NO_FULL_SCOPE_PREVIOUS' : 'CURRENT_NOT_FULL_SCOPE', common)
    }
  }
  return none('INSUFFICIENT_COMMON_EXERCISES', excluded)
}
