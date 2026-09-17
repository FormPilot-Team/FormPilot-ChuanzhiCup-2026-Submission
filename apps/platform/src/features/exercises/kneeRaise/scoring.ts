import { bandScore, lowerIsBetterScore, metricScore } from '../scoring'
import type { RuleMetrics } from '../types'
import { KNEE_RAISE_SCORING, KNEE_RAISE_V1, type KneeRaiseConfig } from './config'
import type { KneeRaiseStateSnapshot } from './stateMachine'

export function kneeRaiseAmplitudeScore(height: number): number {
  const points = KNEE_RAISE_SCORING.amplitudePoints
  if (height <= points[0][0]) return points[0][1]
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x0, y0] = points[index - 1]
    if (height <= x1) return y0 + ((height - x0) / (x1 - x0)) * (y1 - y0)
  }
  return points.at(-1)?.[1] ?? 100
}

export function calculateKneeRaiseMetrics(
  snapshot: KneeRaiseStateSnapshot,
  current: { leftKneeHeight: number; rightKneeHeight: number; hipHorizontalShift: number; torsoLean: number; timestamp: number },
  valid = true,
  config: KneeRaiseConfig = KNEE_RAISE_V1,
): RuleMetrics {
  const rep = snapshot.completedRep
  const activeHeight = snapshot.currentSide === 'left' ? current.leftKneeHeight : current.rightKneeHeight
  const peak = rep?.peakKneeHeight ?? Math.max(snapshot.peakKneeHeight, activeHeight)
  const hipShift = rep?.hipShiftMax ?? Math.max(snapshot.hipShiftMax, current.hipHorizontalShift)
  const lean = rep?.maxTorsoLean ?? Math.max(snapshot.maxTorsoLean, current.torsoLean)
  const duration = rep?.durationMs ?? (snapshot.repStartedAt === undefined ? 0 : current.timestamp - snapshot.repStartedAt)
  const hipScore = lowerIsBetterScore(hipShift, KNEE_RAISE_SCORING.hipShiftIdealMax, KNEE_RAISE_SCORING.hipShiftZeroAt)
  const torsoScore = lowerIsBetterScore(lean, KNEE_RAISE_SCORING.torsoIdealMax, KNEE_RAISE_SCORING.torsoZeroAt)
  const heightGap = snapshot.lastLeftPeak !== undefined && snapshot.lastRightPeak !== undefined
    ? Math.abs(snapshot.lastLeftPeak - snapshot.lastRightPeak) : 0
  return {
    amplitude: metricScore(peak, kneeRaiseAmplitudeScore(peak), '', valid),
    stability: metricScore(Math.max(hipShift, lean / 100), (hipScore + torsoScore) / 2, '', valid),
    alternation: metricScore(rep?.wrongSideSequence ? 0 : 1, rep?.wrongSideSequence ? 0 : 100, '', valid),
    symmetry: metricScore(heightGap, lowerIsBetterScore(heightGap, KNEE_RAISE_SCORING.heightGapIdealMax, KNEE_RAISE_SCORING.heightGapZeroAt), '', valid),
    tempo: metricScore(duration / 1000, duration ? bandScore(duration, config.repDurationMinMs, config.repDurationMaxMs, 700) : 65, 's', valid),
  }
}

export function weightedKneeRaiseScore(metrics: RuleMetrics): number {
  const w = KNEE_RAISE_SCORING.weights
  return Math.round(metrics.amplitude.score * w.amplitude + metrics.stability.score * w.stability
    + metrics.alternation.score * w.alternation + metrics.symmetry.score * w.symmetry + metrics.tempo.score * w.tempo)
}
