import type { RuleMetrics } from '../types'
import type { LateralRaiseStateSnapshot } from './stateMachine'
import { LATERAL_RAISE_SCORING, LATERAL_RAISE_V1, type LateralRaiseConfig } from './config'
import { bandScore, lowerIsBetterScore, metricScore } from '../scoring'

export function calculateMetrics(
  snapshot: LateralRaiseStateSnapshot,
  current: {
    shoulderL: number
    shoulderR: number
    symmetry: number
    torsoLean: number
    timestamp: number
  },
  valid = true,
  config: LateralRaiseConfig = LATERAL_RAISE_V1,
): RuleMetrics {
  const scoring = LATERAL_RAISE_SCORING
  const rep = snapshot.completedRep
  const leftPeak = rep?.peakShoulderL ?? Math.max(snapshot.peakShoulderL, current.shoulderL)
  const rightPeak = rep?.peakShoulderR ?? Math.max(snapshot.peakShoulderR, current.shoulderR)
  const symmetry = rep?.maxSymmetryDiff ?? Math.max(snapshot.maxSymmetryDiff, current.symmetry)
  const lean = rep?.maxTorsoLean ?? Math.max(snapshot.maxTorsoLean, current.torsoLean)
  const duration = rep?.durationMs ?? (snapshot.repStartedAt ? current.timestamp - snapshot.repStartedAt : 0)
  const durationScore = duration > 0
    ? bandScore(duration, config.repDurationMinMs, config.repDurationMaxMs, scoring.durationFalloffMs)
    : scoring.idleTempoScore
  const topHoldScore = rep
    ? bandScore(rep.topHoldMs, config.topHoldMinMs, config.topHoldMaxMs, scoring.topHoldFalloffMs)
    : snapshot.phase === 'TOP'
      ? bandScore(snapshot.topHoldMs, config.topHoldMinMs, config.topHoldMaxMs, scoring.topHoldFalloffMs)
      : durationScore
  const amplitudeScore = (bandScore(leftPeak, config.topMinAngle, config.topMaxAngle, scoring.amplitudeFalloffDeg) +
    bandScore(rightPeak, config.topMinAngle, config.topMaxAngle, scoring.amplitudeFalloffDeg)) / 2

  return {
    amplitude: metricScore((leftPeak + rightPeak) / 2, amplitudeScore, '°', valid),
    symmetry: metricScore(symmetry, lowerIsBetterScore(symmetry, scoring.symmetryIdealMax, scoring.symmetryZeroAt), '°', valid),
    stability: metricScore(lean, lowerIsBetterScore(lean, scoring.torsoIdealMax, scoring.torsoZeroAt), '°', valid),
    tempo: metricScore(duration / 1000, (durationScore + topHoldScore) / 2, 's', valid),
    completion: metricScore(
      rep ? 1 : snapshot.incomplete ? 0 : snapshot.phase === 'START' ? 0 : scoring.inProgressCompletionValue,
      rep ? 100 : snapshot.incomplete ? 0 : snapshot.phase === 'START' ? 0 : scoring.inProgressCompletionScore,
      '',
      valid,
    ),
  }
}

export function weightedScore(metrics: RuleMetrics): number {
  if (!Object.values(metrics).every((item) => item.valid)) return 0
  const { amplitude, symmetry, stability, tempo, completion } = LATERAL_RAISE_SCORING.weights
  return Math.round(
    metrics.amplitude.score * amplitude +
      metrics.symmetry.score * symmetry +
      metrics.stability.score * stability +
      metrics.tempo.score * tempo +
      metrics.completion.score * completion,
  )
}
