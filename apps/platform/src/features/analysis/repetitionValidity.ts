import type { RepSummary } from '../exercises/types'
import type { ExerciseSessionResult, RepetitionResult } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { finite } from './ratio'
import type { RepetitionValidity } from './types'

/**
 * Required raw fields per exercise (8F-1A §5). JSON persistence turns NaN into null, so every one of these is
 * checked with Number.isFinite; a missing or non-finite value makes the whole repetition INVALID.
 */
const REQUIRED_NUMBERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  overhead_raise: ['peakShoulderL', 'peakShoulderR', 'minElbowL', 'minElbowR', 'maxSymmetryDiff'],
  lateral_raise: ['peakShoulderL', 'peakShoulderR', 'minElbowL', 'minElbowR', 'maxSymmetryDiff', 'topHoldMs'],
  step_jack: ['peakOpenRatio', 'peakMeanShoulderAngle', 'maxArmAngleDiff', 'syncGapMs'],
  squat: ['maxHipDrop', 'minKneeSpreadRatio', 'maxKneeHeightDiff'],
  knee_raise: ['peakKneeHeight', 'hipShiftMax'],
})

const REQUIRED_BOOLEANS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  step_jack: ['wrongSideSequence', 'incompleteReturn'],
  knee_raise: ['wrongSideSequence', 'incompleteReturn'],
})

const SIDED = new Set(['step_jack', 'knee_raise'])
const POSE_QUALITY = new Set<string>(ANALYSIS_CONFIG_V1.poseQualityCodes)

function field(rep: RepSummary, key: string): unknown {
  return (rep as unknown as Record<string, unknown>)[key]
}

function hasRequiredRawFields(rep: RepSummary): boolean {
  if (!(REQUIRED_NUMBERS[rep.exerciseId] ?? []).every((key) => finite(field(rep, key)))) return false
  if (!(REQUIRED_BOOLEANS[rep.exerciseId] ?? []).every((key) => typeof field(rep, key) === 'boolean')) return false
  if (SIDED.has(rep.exerciseId)) {
    const side = field(rep, 'side')
    if (side !== 'left' && side !== 'right') return false
  }
  return true
}

export function hasPoseQualityError(result: RepetitionResult): boolean {
  return Array.isArray(result.errors) && result.errors.some((code) => POSE_QUALITY.has(code))
}

export function classifyRepetition(result: RepetitionResult | null | undefined, exercise: ExerciseSessionResult): RepetitionValidity {
  const rep = result?.rep
  if (!result || !rep || rep.exerciseId !== exercise.exerciseId) return 'INVALID'
  if (!finite(rep.startedAt) || !finite(rep.completedAt) || !finite(rep.maxTorsoLean) || !finite(result.score)) return 'INVALID'
  if (!finite(rep.durationMs) || rep.durationMs <= 0) return 'INVALID'
  const metrics = result.metrics && typeof result.metrics === 'object' ? Object.values(result.metrics) : []
  // Object.values({}).every(...) is vacuously true: an empty metrics object is INVALID, not VALID.
  if (metrics.length === 0 || !metrics.every((metric) => metric && metric.valid === true && finite(metric.score))) return 'INVALID'
  if (hasPoseQualityError(result)) return 'INVALID'
  if (!hasRequiredRawFields(rep)) return 'INVALID'
  if (rep.exerciseId === 'overhead_raise' && (!finite(rep.topElbowL) || !finite(rep.topElbowR))) return 'PARTIAL'
  return 'VALID'
}
