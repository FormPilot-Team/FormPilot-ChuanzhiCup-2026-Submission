import { bandScore, lowerIsBetterScore, metricScore, thresholdScore } from '../scoring'
import type { RuleMetrics } from '../types'
import { SQUAT_SCORING, SQUAT_V1, type SquatConfig } from './config'
import type { SquatStateSnapshot } from './stateMachine'

export function piecewiseLinear(value: number, points: ReadonlyArray<readonly [number, number]>): number {
  if (points.length === 0) return 0
  if (value <= points[0][0]) return points[0][1]
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1]
    const [x1, y1] = points[index]
    if (value <= x1) {
      const span = x1 - x0
      return span <= 0 ? y1 : y0 + ((value - x0) / span) * (y1 - y0)
    }
  }
  return points[points.length - 1][1]
}

export function depthScore(hipDrop: number, config: SquatConfig = SQUAT_V1): number {
  return piecewiseLinear(hipDrop, [
    [0, 0],
    [config.depthVeryLow, 22],
    [config.depthPartial, 64],
    [config.validDepthHipDrop, 92],
    [config.depthPlateau, 100],
  ])
}

export function calculateSquatMetrics(
  snapshot: SquatStateSnapshot,
  current: { hipDrop: number; kneeSpreadRatio: number; kneeHeightDiff: number; torsoLean: number; timestamp: number },
  valid = true,
  config: SquatConfig = SQUAT_V1,
): RuleMetrics {
  const scoring = SQUAT_SCORING
  const rep = snapshot.completedRep
  const hipDrop = rep?.maxHipDrop ?? Math.max(snapshot.maxHipDrop, current.hipDrop)
  const spread = rep?.minKneeSpreadRatio ?? Math.min(snapshot.minKneeSpreadRatio, current.kneeSpreadRatio)
  const heightDiff = rep?.maxKneeHeightDiff ?? Math.max(snapshot.maxKneeHeightDiff, current.kneeHeightDiff)
  const lean = rep?.maxTorsoLean ?? Math.max(snapshot.maxTorsoLean, current.torsoLean)
  const duration = rep?.durationMs ?? (snapshot.repStartedAt ? current.timestamp - snapshot.repStartedAt : 0)
  const kneeStability = lowerIsBetterScore(heightDiff, scoring.kneeHeightIdealMax, scoring.kneeHeightZeroAt)
  const torsoStability = lowerIsBetterScore(lean, scoring.torsoIdealMax, scoring.torsoZeroAt)
  const stability = kneeStability * scoring.stabilityKneeWeight + torsoStability * scoring.stabilityTorsoWeight
  const inProgress = snapshot.phase !== 'STANDING' && snapshot.phase !== 'COMPLETE'
  return {
    amplitude: metricScore(hipDrop, depthScore(hipDrop, config), '', valid),
    stability: metricScore(heightDiff, stability, '', valid),
    symmetry: metricScore(spread, thresholdScore(spread, scoring.kneeSpreadIdealMin, scoring.kneeSpreadZeroAt), '', valid),
    tempo: metricScore(
      duration / 1000,
      duration ? bandScore(duration, config.repDurationMinMs, config.repDurationMaxMs, scoring.durationFalloffMs) : scoring.idleTempoScore,
      's',
      valid,
    ),
    completion: metricScore(
      rep ? 1 : snapshot.incomplete ? 0 : inProgress ? scoring.inProgressCompletionValue : 0,
      rep ? 100 : snapshot.incomplete ? 0 : inProgress ? scoring.inProgressCompletionScore : 0,
      '',
      valid,
    ),
  }
}

export function weightedSquatScore(metrics: RuleMetrics): number {
  if (!Object.values(metrics).every((item) => item.valid)) return 0
  const { amplitude, stability, symmetry, completion, tempo } = SQUAT_SCORING.weights
  return Math.round(
    metrics.amplitude.score * amplitude +
      metrics.stability.score * stability +
      metrics.symmetry.score * symmetry +
      metrics.completion.score * completion +
      metrics.tempo.score * tempo,
  )
}
