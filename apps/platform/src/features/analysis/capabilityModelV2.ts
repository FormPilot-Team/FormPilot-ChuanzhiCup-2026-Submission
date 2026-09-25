import { KNEE_RAISE_SCORING } from '../exercises/kneeRaise/config'
import { KNEE_RAISE_V1 } from '../exercises/kneeRaise/config'
import { LATERAL_RAISE_V1 } from '../exercises/lateralRaise/config'
import { OVERHEAD_RAISE_V1 } from '../exercises/overheadRaise/config'
import { lowerIsBetterScore } from '../exercises/scoring'
import { SQUAT_V1 } from '../exercises/squat/config'
import { SQUAT_SCORING } from '../exercises/squat/config'
import { STEP_JACK_V1 } from '../exercises/stepJack/config'
import type { ExerciseId } from '../exercises/types'
import type { ExerciseSessionResult, RepetitionResult, TrainingSessionState } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { compareScore, SCORED_EXERCISE_IDS } from './comparison'
import { collectIssueEvidence } from './issueEvidence'
import { REPORT_ISSUE_TAXONOMY } from './issueTaxonomy'
import { analyzedRepetitions } from './repetitionValidity'
import type { CapabilityAnalysis, CapabilityContribution, CapabilityDimension, CapabilityModelV2 } from './types'

export const CAPABILITY_DIMENSIONS: readonly CapabilityDimension[] = Object.freeze(['AMPLITUDE', 'STABILITY', 'COORDINATION', 'TEMPO', 'FORM'])

function roundedMean(values: readonly number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function metricValues(reps: readonly RepetitionResult[], key: string): number[] {
  return reps.flatMap((item) => {
    const metric = item.metrics[key]
    return metric?.valid && Number.isFinite(metric.score) ? [metric.score] : []
  })
}

function amplitude(reps: readonly RepetitionResult[]): number[] {
  return metricValues(reps, 'amplitude')
}

function stability(exercise: ExerciseSessionResult, reps: readonly RepetitionResult[]): number[] {
  if (exercise.exerciseId !== 'squat') return metricValues(reps, 'stability')
  return reps.flatMap((item) => item.rep.exerciseId === 'squat'
    ? [lowerIsBetterScore(item.rep.maxTorsoLean, SQUAT_SCORING.torsoIdealMax, SQUAT_SCORING.torsoZeroAt)] : [])
}

function coordination(exercise: ExerciseSessionResult, reps: readonly RepetitionResult[]): number[] {
  switch (exercise.exerciseId) {
    case 'overhead_raise': return metricValues(reps, 'synchronization')
    case 'lateral_raise': return metricValues(reps, 'symmetry')
    case 'step_jack': return metricValues(reps, 'coordination')
    case 'squat': return reps.flatMap((item) => item.rep.exerciseId === 'squat'
      ? [lowerIsBetterScore(item.rep.maxKneeHeightDiff, SQUAT_SCORING.kneeHeightIdealMax, SQUAT_SCORING.kneeHeightZeroAt)] : [])
    case 'knee_raise': {
      const kneeReps = reps.filter((item) => item.rep.exerciseId === 'knee_raise')
      const values: number[] = []
      for (let index = 1; index < kneeReps.length; index += 1) {
        const previous = kneeReps[index - 1]
        const current = kneeReps[index]
        if (previous.rep.exerciseId !== 'knee_raise' || current.rep.exerciseId !== 'knee_raise') continue
        if (previous.rep.side === current.rep.side) values.push(0)
        else {
          const symmetry = lowerIsBetterScore(
            Math.abs(previous.rep.peakKneeHeight - current.rep.peakKneeHeight),
            KNEE_RAISE_SCORING.heightGapIdealMax,
            KNEE_RAISE_SCORING.heightGapZeroAt,
          )
          values.push((100 + symmetry) / 2)
        }
      }
      return values
    }
    default: return []
  }
}

function tempo(exercise: ExerciseSessionResult, reps: readonly RepetitionResult[]): number[] {
  const band = exercise.exerciseId === 'overhead_raise' ? OVERHEAD_RAISE_V1
    : exercise.exerciseId === 'lateral_raise' ? LATERAL_RAISE_V1
      : exercise.exerciseId === 'step_jack' ? STEP_JACK_V1
        : exercise.exerciseId === 'squat' ? SQUAT_V1
          : exercise.exerciseId === 'knee_raise' ? KNEE_RAISE_V1
            : null
  if (!band) return []
  return reps.map((item) => item.rep.durationMs >= band.repDurationMinMs && item.rep.durationMs <= band.repDurationMaxMs ? 100 : 0)
}

function form(exercise: ExerciseSessionResult, reps: readonly RepetitionResult[]): number[] {
  if (exercise.exerciseId === 'overhead_raise' && reps.some((item) => item.rep.exerciseId === 'overhead_raise'
    && (!Number.isFinite(item.rep.topElbowL) || !Number.isFinite(item.rep.topElbowR)))) return []
  const definitions = REPORT_ISSUE_TAXONOMY.filter((item) => item.exerciseId === exercise.exerciseId && item.theme !== 'tempo')
  const totals = definitions.map((definition) => collectIssueEvidence(exercise, definition).incidence)
  const evaluable = totals.reduce((sum, item) => sum + item.evaluable, 0)
  const affected = totals.reduce((sum, item) => sum + item.affected, 0)
  if (evaluable === 0) return []
  const perRepUnits = Math.max(...totals.map((item) => item.evaluable), 0)
  return Array.from({ length: perRepUnits }, () => 100 * (evaluable - affected) / evaluable)
}

export function exerciseCapabilityContribution(exercise: ExerciseSessionResult, dimension: CapabilityDimension): CapabilityContribution | null {
  const reps = analyzedRepetitions(exercise)
  const values = dimension === 'AMPLITUDE' ? amplitude(reps)
    : dimension === 'STABILITY' ? stability(exercise, reps)
      : dimension === 'COORDINATION' ? coordination(exercise, reps)
        : dimension === 'TEMPO' ? tempo(exercise, reps)
          : form(exercise, reps)
  if (values.length < ANALYSIS_CONFIG_V1.capability.minEvaluableUnitsPerExercise) return null
  return { exerciseId: exercise.exerciseId, value: roundedMean(values), evaluableUnits: values.length }
}

function sessionContributions(session: TrainingSessionState, dimension: CapabilityDimension): CapabilityContribution[] {
  return SCORED_EXERCISE_IDS.flatMap((exerciseId) => {
    const exercise = session.exercises.find((item) => item.exerciseId === exerciseId)
    return exercise ? [exerciseCapabilityContribution(exercise, dimension)].filter((item): item is CapabilityContribution => item !== null) : []
  })
}

function dimensionAnalysis(current: TrainingSessionState, previous: TrainingSessionState | null, dimension: CapabilityDimension): CapabilityAnalysis {
  const contributors = sessionContributions(current, dimension)
  const value = contributors.length >= ANALYSIS_CONFIG_V1.capability.minExerciseContributors
    ? roundedMean(contributors.map((item) => item.value)) : null
  const previousContributors = previous ? sessionContributions(previous, dimension) : []
  const comparisonIds = contributors.map((item) => item.exerciseId).filter((id) => previousContributors.some((item) => item.exerciseId === id))
  const comparable = comparisonIds.length >= ANALYSIS_CONFIG_V1.capability.minComparisonContributors
  const currentCommon = comparable ? roundedMean(comparisonIds.map((id) => contributors.find((item) => item.exerciseId === id)?.value ?? 0)) : null
  const previousCommon = comparable ? roundedMean(comparisonIds.map((id) => previousContributors.find((item) => item.exerciseId === id)?.value ?? 0)) : null
  return {
    dimension,
    value,
    contributors,
    unavailableReason: value === null ? 'INSUFFICIENT_EXERCISE_CONTRIBUTORS' : null,
    previousValue: previousCommon,
    comparisonContributors: comparisonIds,
    delta: currentCommon !== null && previousCommon !== null ? currentCommon - previousCommon : null,
    trend: currentCommon !== null && previousCommon !== null
      ? compareScore(currentCommon, previousCommon, ANALYSIS_CONFIG_V1.capabilityScoreDeadband) : null,
  }
}

export function buildCapabilityModel(current: TrainingSessionState, previous: TrainingSessionState | null): CapabilityModelV2 {
  const dimensions = CAPABILITY_DIMENSIONS.map((dimension) => dimensionAnalysis(current, previous, dimension))
  return { dimensions, radarAvailable: dimensions.every((item) => item.value !== null) }
}

export function capabilityContributorIds(session: TrainingSessionState, dimension: CapabilityDimension): ExerciseId[] {
  return sessionContributions(session, dimension).map((item) => item.exerciseId)
}
