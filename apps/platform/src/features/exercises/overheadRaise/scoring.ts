import type { OverheadRaiseFeatures } from '../../motion/types'
import { bandScore, lowerIsBetterScore, metricScore } from '../scoring'
import type { RuleMetrics } from '../types'
import { OVERHEAD_RAISE_SCORING, OVERHEAD_RAISE_V1, type OverheadRaiseConfig } from './config'
import type { OverheadRaiseStateSnapshot } from './stateMachine'

export interface OverheadRaiseScoreComponents {
  amplitude: number
  elbow: number
  synchronization: number
  stability: number
  tempo: number
  overall: number
}

export function calculateOverheadRaiseScoreComponents(
  peakShoulderL: number,
  peakShoulderR: number,
  topElbowL: number,
  topElbowR: number,
  maxSymmetryDiff: number,
  maxTorsoLean: number,
  durationMs: number,
  config: OverheadRaiseConfig = OVERHEAD_RAISE_V1,
): OverheadRaiseScoreComponents {
  const amplitude = Math.min(100, Math.max(0, ((peakShoulderL + peakShoulderR) / 2 - 90) / 60 * 100))
  const elbow = Math.min(100, Math.max(0, (Math.min(topElbowL, topElbowR) - 110) / 40 * 100))
  const synchronization = lowerIsBetterScore(maxSymmetryDiff, 4, 28)
  const stability = lowerIsBetterScore(maxTorsoLean, 3, 20)
  const tempo = durationMs ? bandScore(durationMs, config.repDurationMinMs, config.repDurationMaxMs, 1500) : 65
  const weights = OVERHEAD_RAISE_SCORING.weights
  const overall = Math.round(amplitude * weights.amplitude + elbow * weights.elbow
    + synchronization * weights.synchronization + stability * weights.stability + tempo * weights.tempo)
  return { amplitude, elbow, synchronization, stability, tempo, overall }
}

export function overheadMetrics(features: OverheadRaiseFeatures, state: OverheadRaiseStateSnapshot, valid = true, config: OverheadRaiseConfig = OVERHEAD_RAISE_V1): RuleMetrics {
  const rep = state.completedRep
  const peakL = rep?.peakShoulderL ?? Math.max(state.peakShoulderL, features.shoulderAngleL)
  const peakR = rep?.peakShoulderR ?? Math.max(state.peakShoulderR, features.shoulderAngleR)
  const topElbowL = rep?.topElbowL ?? state.topElbowL
  const topElbowR = rep?.topElbowR ?? state.topElbowR
  const elbow = topElbowL !== undefined && topElbowR !== undefined ? Math.min(topElbowL, topElbowR) : 0
  const elbowValid = valid && topElbowL !== undefined && topElbowR !== undefined
  const symmetry = rep?.maxSymmetryDiff ?? Math.max(state.maxSymmetryDiff, features.symmetryDiff)
  const lean = rep?.maxTorsoLean ?? Math.max(state.maxTorsoLean, features.torsoLean)
  const duration = rep?.durationMs ?? (state.repStartedAt !== undefined ? features.timestamp - state.repStartedAt : 0)
  const scores = calculateOverheadRaiseScoreComponents(peakL, peakR, elbow, elbow, symmetry, lean, duration, config)
  return {
    amplitude: metricScore((peakL + peakR) / 2, scores.amplitude, '°', valid),
    elbow: metricScore(elbow, scores.elbow, '°', elbowValid),
    synchronization: metricScore(symmetry, scores.synchronization, '°', valid),
    stability: metricScore(lean, scores.stability, '°', valid),
    tempo: metricScore(duration / 1000, scores.tempo, 's', valid),
  }
}

export function overheadWeightedScore(metrics: RuleMetrics): number {
  const w = OVERHEAD_RAISE_SCORING.weights
  if (!Object.values(metrics).every((metric) => metric.valid)) return 0
  return Math.round(metrics.amplitude.score * w.amplitude + metrics.elbow.score * w.elbow
    + metrics.synchronization.score * w.synchronization + metrics.stability.score * w.stability + metrics.tempo.score * w.tempo)
}
