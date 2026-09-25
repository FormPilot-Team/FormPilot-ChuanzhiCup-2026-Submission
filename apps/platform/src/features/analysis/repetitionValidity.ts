import type { ExerciseSessionResult, RepetitionResult } from '../training/types'
import type { RepetitionQualityCounts, RepetitionValidity } from './types'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
export function classifyRepetition(result: RepetitionResult, exercise: ExerciseSessionResult): RepetitionValidity {
  const rep = result.rep
  const metrics = Object.values(result.metrics)
  if (rep.exerciseId !== exercise.exerciseId
    || !finite(rep.repIndex)
    || !finite(rep.startedAt)
    || !finite(rep.completedAt)
    || !finite(rep.durationMs)
    || rep.repIndex < 1
    || rep.durationMs <= 0
    || rep.completedAt < rep.startedAt
    || !finite(result.score)
    || result.score < 0
    || result.score > 100
    || metrics.length === 0
    || metrics.some((metric) => !metric.valid || !finite(metric.value) || !finite(metric.score))) return 'INVALID'
  if (result.errors.includes('BODY_OUT_OF_FRAME') || result.errors.includes('POSE_LOW_CONFIDENCE')) return 'INVALID'
  if (rep.exerciseId === 'overhead_raise' && (!finite(rep.topElbowL) || !finite(rep.topElbowR))) return 'PARTIAL'
  return 'VALID'
}

export function repetitionQuality(exercise: ExerciseSessionResult): RepetitionQualityCounts {
  let valid = 0
  let partial = 0
  let invalid = 0
  for (const repetition of exercise.repetitions) {
    const classification = classifyRepetition(repetition, exercise)
    if (classification === 'VALID') valid += 1
    else if (classification === 'PARTIAL') partial += 1
    else invalid += 1
  }
  return { valid, partial, invalid, total: exercise.repetitions.length }
}

export function analyzedRepetitions(exercise: ExerciseSessionResult): RepetitionResult[] {
  return exercise.repetitions.filter((item) => classifyRepetition(item, exercise) !== 'INVALID')
}
