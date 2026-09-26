import { KNEE_RAISE_SCORING } from '../exercises/kneeRaise/config'
import { lowerIsBetterScore } from '../exercises/scoring'
import { SQUAT_SCORING } from '../exercises/squat/config'
import { ANALYSIS_CONFIG_V1 } from './config'
import { CAPABILITY_LABELS } from './copy'
import { kneeRaisePairGap, kneeRaisePairs, stepJackSyncEvaluable, type AnalyzedRep, type IssueEvidence } from './issueEvidence'
import { finite, meanRounded, scoreTrend } from './ratio'
import type {
  CapabilityAnalysis, CapabilityDimension, CapabilityDimensionAnalysis, CompletionAnalysis, DimensionContribution,
  ScoredExerciseId,
} from './types'

export const CAPABILITY_DIMENSIONS: readonly CapabilityDimension[] = Object.freeze(['AMPLITUDE', 'STABILITY', 'COORDINATION', 'TEMPO', 'FORM'])

const CAP = ANALYSIS_CONFIG_V1.capability

/** FORM uses exactly these checks (8F-1A §14), with the same evidence as the issues. */
export const FORM_CHECKS: Readonly<Record<ScoredExerciseId, readonly string[]>> = Object.freeze({
  overhead_raise: ['overhead_raise.elbow_extension.left', 'overhead_raise.elbow_extension.right'],
  lateral_raise: ['lateral_raise.elbow_extension.left', 'lateral_raise.elbow_extension.right'],
  step_jack: ['step_jack.alternation'],
  squat: ['squat.knee_alignment'],
  knee_raise: ['knee_raise.alternation', 'knee_raise.return_to_center'],
})

function storedMetric(item: AnalyzedRep, key: string): number | null {
  const metric = item.result.metrics[key]
  return metric && metric.valid && finite(metric.score) ? metric.score : null
}

function recomputed(value: number, idealMax: number, zeroAt: number): number {
  return Math.round(lowerIsBetterScore(value, idealMax, zeroAt))
}

/** Per-unit values for one continuous dimension (reps, or knee-raise pairs for knee COORDINATION). */
function unitValues(exerciseId: ScoredExerciseId, dimension: Exclude<CapabilityDimension, 'FORM'>, analyzed: readonly AnalyzedRep[]): number[] {
  const values = (pick: (item: AnalyzedRep) => number | null) => analyzed.map(pick).filter((value): value is number => value !== null)
  switch (dimension) {
    case 'AMPLITUDE':
      return values((item) => storedMetric(item, 'amplitude'))
    case 'STABILITY':
      // Stored squat "stability" mixes 0.6 × knee-height difference; recompute torso only.
      if (exerciseId === 'squat') return values((item) => recomputed(item.result.rep.maxTorsoLean, SQUAT_SCORING.torsoIdealMax, SQUAT_SCORING.torsoZeroAt))
      return values((item) => storedMetric(item, 'stability'))
    case 'COORDINATION':
      if (exerciseId === 'overhead_raise') return values((item) => storedMetric(item, 'synchronization'))
      if (exerciseId === 'lateral_raise') return values((item) => storedMetric(item, 'symmetry'))
      if (exerciseId === 'step_jack') {
        return values((item) => item.result.rep.exerciseId === 'step_jack' && stepJackSyncEvaluable(item.result.rep) ? storedMetric(item, 'coordination') : null)
      }
      if (exerciseId === 'squat') {
        // Stored squat "symmetry" is knee valgus, not left/right balance.
        return values((item) => item.result.rep.exerciseId === 'squat'
          ? recomputed(item.result.rep.maxKneeHeightDiff, SQUAT_SCORING.kneeHeightIdealMax, SQUAT_SCORING.kneeHeightZeroAt) : null)
      }
      // Knee raise: left/right height consistency over non-overlapping pairs only. Alternation belongs to FORM.
      return kneeRaisePairs(analyzed).map((pair) => recomputed(kneeRaisePairGap(pair), KNEE_RAISE_SCORING.heightGapIdealMax, KNEE_RAISE_SCORING.heightGapZeroAt))
    case 'TEMPO':
      // Stored tempo is the exercise's own tempo scoring (lateral raise includes top hold).
      return values((item) => storedMetric(item, 'tempo'))
  }
}

function formContribution(exerciseId: ScoredExerciseId, evidence: ReadonlyMap<string, IssueEvidence>): DimensionContribution {
  const usable: Array<{ n: number; a: number }> = []
  let missing = 0
  let maxEvaluable = 0
  for (const canonicalId of FORM_CHECKS[exerciseId]) {
    const check = evidence.get(canonicalId)
    if (!check) continue
    missing += check.missingEvidenceReps
    const n = check.units.length
    maxEvaluable = Math.max(maxEvaluable, n)
    if (n >= ANALYSIS_CONFIG_V1.issue.minEvaluableReps) usable.push({ n, a: check.units.filter((unit) => unit.affected).length })
  }
  if (usable.length === 0) {
    return {
      value: null,
      evaluableReps: maxEvaluable,
      unavailableReason: maxEvaluable === 0 && missing > 0 ? 'EVIDENCE_MISSING' : 'INSUFFICIENT_EVALUABLE_REPS',
    }
  }
  const compliance = usable.reduce((sum, check) => sum + (check.n - check.a) / check.n, 0) / usable.length
  return { value: Math.round(100 * compliance), evaluableReps: Math.max(...usable.map((check) => check.n)), unavailableReason: null }
}

export function exerciseContributions(input: {
  exerciseId: ScoredExerciseId
  completion: CompletionAnalysis
  analyzed: readonly AnalyzedRep[]
  evidence: ReadonlyMap<string, IssueEvidence>
  rulesSupported: boolean
}): Record<CapabilityDimension, DimensionContribution> {
  const entries = CAPABILITY_DIMENSIONS.map((dimension): [CapabilityDimension, DimensionContribution] => {
    if (!input.rulesSupported) return [dimension, { value: null, evaluableReps: 0, unavailableReason: 'RULES_UNSUPPORTED' }]
    const computed: DimensionContribution = dimension === 'FORM'
      ? formContribution(input.exerciseId, input.evidence)
      : (() => {
          const values = unitValues(input.exerciseId, dimension, input.analyzed)
          return values.length >= CAP.minEvaluablePerContributor
            ? { value: meanRounded(values), evaluableReps: values.length, unavailableReason: null }
            : { value: null, evaluableReps: values.length, unavailableReason: 'INSUFFICIENT_EVALUABLE_REPS' as const }
        })()
    // Only a completed exercise may contribute to the session capability.
    if (input.completion.status !== 'completed') {
      return [dimension, { value: null, evaluableReps: computed.evaluableReps, unavailableReason: 'EXERCISE_NOT_COMPLETED' }]
    }
    return [dimension, computed]
  })
  return Object.fromEntries(entries) as Record<CapabilityDimension, DimensionContribution>
}

export interface CapabilitySource {
  exercises: ReadonlyArray<{ exerciseId: ScoredExerciseId; contribution: Record<CapabilityDimension, DimensionContribution> }>
}

function contributorsOf(source: CapabilitySource, dimension: CapabilityDimension) {
  return source.exercises.flatMap((exercise) => {
    const item = exercise.contribution[dimension]
    return item.value === null || item.unavailableReason !== null ? [] : [{ exerciseId: exercise.exerciseId, value: item.value, evaluableReps: item.evaluableReps }]
  })
}

export function buildCapability(
  current: CapabilitySource,
  previous: CapabilitySource | null,
  commonExerciseIds: readonly ScoredExerciseId[],
  rulesSupported: boolean,
): CapabilityAnalysis {
  if (!rulesSupported) return { available: false, unavailableReason: 'RULES_UNSUPPORTED', radarAvailable: false, dimensions: [] }
  const dimensions = CAPABILITY_DIMENSIONS.map((dimension): CapabilityDimensionAnalysis => {
    const contributors = contributorsOf(current, dimension)
    const value = contributors.length >= CAP.dimensionMinContributors ? meanRounded(contributors.map((item) => item.value)) : null
    let comparison: CapabilityDimensionAnalysis['comparison'] = null
    let comparisonUnavailableReason: CapabilityDimensionAnalysis['comparisonUnavailableReason'] = 'NO_COMPARISON'
    if (previous) {
      const previousValues = new Map(contributorsOf(previous, dimension).map((item) => [item.exerciseId, item.value]))
      const common = contributors.filter((item) => previousValues.has(item.exerciseId) && commonExerciseIds.includes(item.exerciseId))
      if (common.length >= CAP.comparisonMinCommonContributors) {
        // Both sides are re-aggregated over the same common contributor set.
        const currentCommon = meanRounded(common.map((item) => item.value))
        const previousCommon = meanRounded(common.map((item) => previousValues.get(item.exerciseId) as number))
        comparison = {
          commonExerciseIds: common.map((item) => item.exerciseId),
          current: currentCommon,
          previous: previousCommon,
          delta: currentCommon - previousCommon,
          trend: scoreTrend(currentCommon, previousCommon, ANALYSIS_CONFIG_V1.deadband.capability),
        }
        comparisonUnavailableReason = null
      } else {
        comparisonUnavailableReason = 'COMMON_SCOPE_TOO_SMALL'
      }
    }
    return {
      dimension,
      label: CAPABILITY_LABELS[dimension],
      value,
      contributors,
      unavailableReason: value === null ? 'INSUFFICIENT_CONTRIBUTORS' : null,
      comparison,
      comparisonUnavailableReason,
    }
  })
  return {
    available: true,
    unavailableReason: null,
    radarAvailable: dimensions.every((item) => item.value !== null),
    dimensions,
  }
}
