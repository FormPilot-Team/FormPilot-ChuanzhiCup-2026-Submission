import { ANALYSIS_CONFIG_V1 } from './config'
import type { Incidence, IssueTrend } from './types'

export function isSignificantIssue(incidence: Incidence): boolean {
  const { significantMinCount, minEvaluableReps, significantMinRateRatio } = ANALYSIS_CONFIG_V1
  return incidence.affected >= significantMinCount
    && incidence.evaluable >= minEvaluableReps
    && incidence.affected * significantMinRateRatio.denominator >= incidence.evaluable * significantMinRateRatio.numerator
}

function rateDeltaAtLeast(current: Incidence, previous: Incidence): boolean {
  const deltaNumerator = Math.abs(current.affected * previous.evaluable - previous.affected * current.evaluable)
  const threshold = ANALYSIS_CONFIG_V1.issueTrendRateDeltaRatio
  return deltaNumerator * threshold.denominator >= current.evaluable * previous.evaluable * threshold.numerator
}

export function compareIssueTrend(current: Incidence, previous: Incidence): IssueTrend | null {
  if (current.evaluable < ANALYSIS_CONFIG_V1.minEvaluableReps || previous.evaluable < ANALYSIS_CONFIG_V1.minEvaluableReps) return 'INSUFFICIENT_DATA'
  const currentSignificant = isSignificantIssue(current)
  const previousSignificant = isSignificantIssue(previous)
  const countDelta = current.affected - previous.affected
  const rateMoved = rateDeltaAtLeast(current, previous)
  if (previous.affected === 0 && currentSignificant) return 'NEW'
  if (current.affected === 0 && previousSignificant) return 'RESOLVED'
  if (countDelta <= -ANALYSIS_CONFIG_V1.issueTrendCountDelta && rateMoved) return 'IMPROVED'
  if (countDelta >= ANALYSIS_CONFIG_V1.issueTrendCountDelta && rateMoved) return 'WORSENED'
  if (currentSignificant && previousSignificant) return 'PERSISTENT'
  return null
}
