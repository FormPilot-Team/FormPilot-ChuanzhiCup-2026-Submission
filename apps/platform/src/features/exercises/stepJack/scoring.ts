import type { StepJackFeatures } from '../../motion/types'
import { bandScore, lowerIsBetterScore, metricScore, thresholdScore } from '../scoring'
import type { RuleMetrics } from '../types'
import { STEP_JACK_SCORING, STEP_JACK_V1, type StepJackConfig } from './config'
import type { StepJackStateSnapshot } from './stateMachine'

export function coordinationScore(syncGapMs: number, config: StepJackConfig = STEP_JACK_V1): number {
  const scoring = STEP_JACK_SCORING
  if (syncGapMs <= config.syncExcellentMs) return 100
  if (syncGapMs <= config.syncAcceptableMs) {
    return 100 - ((syncGapMs - config.syncExcellentMs) / (config.syncAcceptableMs - config.syncExcellentMs)) * scoring.syncGoodBandPenalty
  }
  return Math.max(0, 70 - ((syncGapMs - config.syncAcceptableMs) / scoring.syncPoorFalloffMs) * 70)
}

export function calculateStepJackMetrics(
  snapshot: StepJackStateSnapshot,
  features: StepJackFeatures,
  valid = true,
  config: StepJackConfig = STEP_JACK_V1,
): RuleMetrics {
  const scoring = STEP_JACK_SCORING
  const rep = snapshot.completedRep
  const peakRatio = rep?.peakOpenRatio ?? Math.max(snapshot.peakOpenRatio, features.openRatio)
  const peakArm = rep?.peakMeanShoulderAngle ?? Math.max(snapshot.peakMeanShoulderAngle, features.meanShoulderAngle)
  const lean = rep?.maxTorsoLean ?? Math.max(snapshot.maxTorsoLean, features.torsoLean)
  const duration = rep?.durationMs ?? (snapshot.repStartedAt === undefined ? 0 : features.timestamp - snapshot.repStartedAt)
  const liveSync = snapshot.armOpenAt !== undefined && snapshot.legOpenAt !== undefined ? Math.abs(snapshot.armOpenAt - snapshot.legOpenAt) : duration
  const syncGap = rep?.syncGapMs ?? liveSync
  const amplitude = (thresholdScore(peakRatio, config.openMinRatio, config.centerMaxRatio) + thresholdScore(peakArm, config.armTopMinAngle, scoring.armZeroAtDeg)) / 2
  return {
    amplitude: metricScore(peakRatio, amplitude, '×', valid),
    coordination: metricScore(syncGap / 1000, coordinationScore(syncGap, config), 's', valid),
    stability: metricScore(lean, lowerIsBetterScore(lean, scoring.torsoIdealMax, scoring.torsoZeroAt), '°', valid),
    tempo: metricScore(duration / 1000, duration ? bandScore(duration, config.repDurationMinMs, config.repDurationMaxMs, scoring.durationFalloffMs) : scoring.idleTempoScore, 's', valid),
    completion: metricScore(
      rep ? 1 : snapshot.incompleteReturn ? 0 : snapshot.phase === 'CENTER' ? 0 : scoring.inProgressCompletionValue,
      rep ? 100 : snapshot.incompleteReturn ? 0 : snapshot.phase === 'CENTER' ? 0 : scoring.inProgressCompletionScore,
      '',
      valid,
    ),
  }
}

export function weightedStepJackScore(metrics: RuleMetrics): number {
  if (!Object.values(metrics).every((item) => item.valid)) return 0
  const { coordination, amplitude, tempo, stability, completion } = STEP_JACK_SCORING.weights
  return Math.round(
    metrics.coordination.score * coordination +
      metrics.amplitude.score * amplitude +
      metrics.tempo.score * tempo +
      metrics.stability.score * stability +
      metrics.completion.score * completion,
  )
}
