import { ANALYSIS_CONFIG_V1 } from './config'
import type { IssueSignificance, IssueTrend, IssueUnit, Ratio, Trend } from './types'

const ISSUE = ANALYSIS_CONFIG_V1.issue

/** Integer-only: a ≥ minCount AND a/n ≥ 1/3 AND n ≥ 4. */
export function isSignificant(ratio: Ratio | null): boolean {
  if (!ratio) return false
  const { affected: a, evaluable: n } = ratio
  return n >= ISSUE.minEvaluableReps
    && a >= ISSUE.significantMinCount
    && a * ISSUE.significantMinRate.den >= n * ISSUE.significantMinRate.num
}

export function significanceOf(ratio: Ratio | null): IssueSignificance {
  if (!ratio || ratio.evaluable < ISSUE.minEvaluableReps) return 'INSUFFICIENT_EVIDENCE'
  return isSignificant(ratio) ? 'SIGNIFICANT' : 'NOT_SIGNIFICANT'
}

/** a0/n0 − a1/n1 ≥ 1/4, cross-multiplied. */
function rateDropAtLeast(a0: number, n0: number, a1: number, n1: number): boolean {
  const { num, den } = ISSUE.trendMinRateDelta
  return den * (a0 * n1 - a1 * n0) >= num * n0 * n1
}

/** 8F-1A §12, evaluated strictly in order; the first hit wins. */
export function issueTrend(previous: Ratio | null, current: Ratio | null): IssueTrend | null {
  const a0 = previous?.affected ?? 0
  const n0 = previous?.evaluable ?? 0
  const a1 = current?.affected ?? 0
  const n1 = current?.evaluable ?? 0
  const min = ISSUE.minEvaluableReps
  if (n0 < min || n1 < min) return a0 + a1 > 0 ? 'INSUFFICIENT_DATA' : null
  const prevSig = isSignificant({ affected: a0, evaluable: n0 })
  const curSig = isSignificant({ affected: a1, evaluable: n1 })
  const minDelta = ISSUE.trendMinCountDelta
  if (prevSig && a1 === 0) return 'RESOLVED'
  if (prevSig && a1 > 0 && a0 - a1 >= minDelta && rateDropAtLeast(a0, n0, a1, n1)) return 'IMPROVED'
  if (curSig && a0 === 0) return 'NEW'
  if (curSig && a0 > 0 && a1 - a0 >= minDelta && rateDropAtLeast(a1, n1, a0, n0)) return 'WORSENED'
  if (curSig && a0 > 0) return 'PERSISTENT'
  return null
}

export function scoreTrend(current: number, previous: number, deadband: number): Trend {
  const delta = current - previous
  if (delta >= deadband) return 'IMPROVED'
  if (delta <= -deadband) return 'DECLINED'
  return 'STABLE'
}

export function ratioOrNull(affected: number, evaluable: number): Ratio | null {
  return evaluable > 0 ? { affected, evaluable } : null
}

/** "6 次中 4 次" / "5 组中 2 组". */
export function ratioText(ratio: Ratio, unit: IssueUnit): string {
  return `${ratio.evaluable} ${unit}中 ${ratio.affected} ${unit}`
}

export function meanRounded(values: readonly number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Code-unit comparison (no localeCompare) for deterministic tie-breaks. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
