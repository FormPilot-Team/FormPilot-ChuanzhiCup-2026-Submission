import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../exercises/thresholdVersioning'
import type { ScoredExerciseId } from './types'

/** Frozen analysis-v1 constants (8F-1A §25). Exercise thresholds are read from each exercise config, never copied here. */
export const ANALYSIS_CONFIG_V1 = Object.freeze({
  scoredExerciseIds: Object.freeze(['overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise'] as const) as readonly ScoredExerciseId[],
  guidanceExerciseIds: Object.freeze(['shoulder_rotation'] as const),
  supportedRulesVersions: Object.freeze([Object.freeze({ spec: EXERCISE_SPEC_VERSION, threshold: ENGINEERING_THRESHOLD_VERSION })]),
  poseQualityCodes: Object.freeze(['BODY_OUT_OF_FRAME', 'POSE_LOW_CONFIDENCE'] as const),
  comparison: Object.freeze({ partialMinCommonExercises: 2 }),
  exerciseScore: Object.freeze({ minAnalyzedReps: 3 }),
  issue: Object.freeze({
    significantMinCount: 2,
    significantMinRate: Object.freeze({ num: 1, den: 3 }),
    minEvaluableReps: 4,
    trendMinCountDelta: 2,
    trendMinRateDelta: Object.freeze({ num: 1, den: 4 }),
  }),
  deadband: Object.freeze({ exercise: 5, overall: 3, capability: 5 }),
  withinSession: Object.freeze({ minHalfReps: 3, minFirstHalfAffected: 2, minAffectedDrop: 2, maxPerExercise: 1 }),
  capability: Object.freeze({
    minEvaluablePerContributor: 3,
    dimensionMinContributors: 3,
    comparisonMinCommonContributors: 3,
    radarRequiresAllDimensions: true,
    weakThreshold: 75,
  }),
  tempo: Object.freeze({
    directionMinReps: 4,
    directionMinCount: 2,
    directionMinRate: Object.freeze({ num: 1, den: 3 }),
    appropriateMinRate: Object.freeze({ num: 2, den: 3 }),
  }),
  strength: Object.freeze({
    exerciseMinScore: 85,
    exerciseMinRepScore: 75,
    exerciseMinValidReps: 4,
    capabilityMinValue: 85,
    capabilityMinContributors: 3,
    capabilityMinContributorValue: 75,
    issueFreeMinExercises: 3,
    issueFreeMinEvaluablePerExercise: 4,
    historicalMinScoreDelta: 5,
    maxItems: 2,
    maxPerExercise: 1,
  }),
  priority: Object.freeze({
    historyFactor: Object.freeze({ NEW: 1, PERSISTENT: 1.25, WORSENED: 1.5, IMPROVED: 0.75, NONE: 1 }),
    withinSessionImprovedFactor: 0.8,
    maxItems: 3,
    maxPerExercise: 2,
    themeMinMembers: 2,
  }),
  focus: Object.freeze({ maxItems: 2, maxCapabilityItems: 1 }),
  summary: Object.freeze({ minSentences: 2, maxSentences: 4, noPriorityMinExercises: 3 }),
  dataQuality: Object.freeze({ environmentHintMinPrompts: 3, environmentHintMinInvalidReps: 2 }),
})
