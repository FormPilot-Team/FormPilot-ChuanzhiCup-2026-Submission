import type { ExerciseId } from '../exercises/types'
import type { ExerciseSessionResult } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { exerciseName } from './copy'
import { hasPoseQualityError } from './repetitionValidity'
import { sessionConditions, type SessionFacts } from './sessionFacts'
import type {
  CapabilityAnalysis, Comparison, ComparisonLimitation, DataQuality, ExerciseAnalysis, PoseQualityCounts, SessionFlag,
} from './types'

const DQ = ANALYSIS_CONFIG_V1.dataQuality

function poseCounts(record: ExerciseSessionResult | null): PoseQualityCounts {
  const events = record && Array.isArray(record.feedbackEvents) ? record.feedbackEvents : []
  const corrections = events.filter((event) => event?.kind === 'correction')
  const invalid = record && Array.isArray(record.repetitions)
    ? record.repetitions.filter((item) => item && hasPoseQualityError(item))
    : []
  return {
    outOfFramePrompts: corrections.filter((event) => event.code === 'BODY_OUT_OF_FRAME').length,
    lowConfidencePrompts: corrections.filter((event) => event.code === 'POSE_LOW_CONFIDENCE').length,
    outOfFrameInvalidReps: invalid.filter((item) => item.errors.includes('BODY_OUT_OF_FRAME')).length,
    lowConfidenceInvalidReps: invalid.filter((item) => item.errors.includes('POSE_LOW_CONFIDENCE')).length,
  }
}

function sessionFlags(facts: SessionFacts): SessionFlag[] {
  const session = facts.session
  const conditions = sessionConditions(session)
  const flags: SessionFlag[] = []
  if (facts.rulesSupport === 'LEGACY_UNVERSIONED') flags.push('LEGACY_RULES_UNVERSIONED')
  if (facts.rulesSupport === 'UNSUPPORTED') flags.push('RULES_UNSUPPORTED')
  if (conditions.mode === 'unknown') flags.push('MODE_UNKNOWN')
  if (conditions.mode === 'fast') flags.push('FAST_MODE')
  // Heuristic hint only: a completed legacy course where some scored exercise never reached its stored target.
  if (facts.rulesSupport === 'LEGACY_UNVERSIONED' && session.courseStatus === 'completed'
    && facts.exercises.some((item) => item.completion.progress < item.completion.target)) flags.push('LEGACY_FAST_SUSPECTED')
  if (conditions.source !== 'live') flags.push('NON_LIVE_SOURCE')
  if (!conditions.courseFlow) flags.push('NOT_COURSE_FLOW')
  if (!conditions.finalized) flags.push('NOT_FINALIZED')
  return flags
}

export function buildDataQuality(input: {
  facts: SessionFacts
  exercises: readonly ExerciseAnalysis[]
  comparison: Comparison
  capability: CapabilityAnalysis
}): DataQuality {
  const { facts, exercises, comparison, capability } = input
  const session = facts.session
  const guidanceRecord = Array.isArray(session.exercises) ? session.exercises.find((item) => item?.exerciseId === 'shoulder_rotation') ?? null : null
  const byExercise = [
    { exerciseId: 'shoulder_rotation' as ExerciseId, ...poseCounts(guidanceRecord) },
    ...facts.exercises.map((item) => ({ exerciseId: item.exerciseId as ExerciseId, ...poseCounts(item.record) })),
  ]
  const total = (key: keyof PoseQualityCounts) => byExercise.reduce((sum, item) => sum + item[key], 0)
  const pose: PoseQualityCounts = {
    outOfFramePrompts: total('outOfFramePrompts'),
    lowConfidencePrompts: total('lowConfidencePrompts'),
    outOfFrameInvalidReps: total('outOfFrameInvalidReps'),
    lowConfidenceInvalidReps: total('lowConfidenceInvalidReps'),
  }
  const prompts = pose.outOfFramePrompts + pose.lowConfidencePrompts
  const poseInvalidReps = facts.exercises.reduce((sum, item) => sum + (item.record?.repetitions ?? []).filter((rep) => rep && hasPoseQualityError(rep)).length, 0)
  let environmentHint: DataQuality['poseQuality']['environmentHint'] = null
  if (prompts >= DQ.environmentHintMinPrompts || poseInvalidReps >= DQ.environmentHintMinInvalidReps) {
    // Prompts decide the hint; when there are no prompts, the invalid reps' own codes decide it.
    const framing = prompts > 0 ? pose.outOfFramePrompts : pose.outOfFrameInvalidReps
    const visibility = prompts > 0 ? pose.lowConfidencePrompts : pose.lowConfidenceInvalidReps
    environmentHint = framing > visibility ? 'FRAMING' : 'VISIBILITY'
  }

  const missingEvidence: DataQuality['missingEvidence'] = exercises.flatMap((exercise) => exercise.issues
    .filter((issue) => issue.missingEvidenceReps > 0)
    .map((issue) => ({
      exerciseId: exercise.exerciseId,
      canonicalId: issue.canonicalId,
      reps: issue.missingEvidenceReps,
      reason: facts.rulesSupport === 'LEGACY_UNVERSIONED' ? 'LEGACY_SESSION_NO_TOP_ELBOW' as const : 'TOP_ELBOW_NOT_CAPTURED' as const,
    })))

  const limitedExercises = exercises
    .filter((item) => item.completion.status !== 'not_started' && item.reps.analyzed < ANALYSIS_CONFIG_V1.issue.minEvaluableReps)
    .map((item) => ({ exerciseId: item.exerciseId, analyzedReps: item.reps.analyzed }))

  const limitations: ComparisonLimitation[] = []
  if (comparison.level === 'PARTIAL') limitations.push('NO_OVERALL_DELTA_PARTIAL')
  if (exercises.some((exercise) => exercise.issues.some((issue) => issue.comparison?.trend === 'INSUFFICIENT_DATA'))) limitations.push('ISSUE_PREVIOUS_INSUFFICIENT')
  if (capability.dimensions.some((item) => item.comparisonUnavailableReason === 'COMMON_SCOPE_TOO_SMALL')) limitations.push('CAPABILITY_COMMON_SCOPE_TOO_SMALL')
  if (comparison.level !== 'NONE' && comparison.commonExerciseIds.length < ANALYSIS_CONFIG_V1.scoredExerciseIds.length) limitations.push('EXERCISE_NOT_COMMON')

  const notes: string[] = []
  if (pose.outOfFramePrompts > 0) notes.push(`本次有 ${pose.outOfFramePrompts} 次身体未完整入镜提示。`)
  if (pose.lowConfidencePrompts > 0) notes.push(`本次有 ${pose.lowConfidencePrompts} 次动作识别不清提示。`)
  const invalid = exercises.reduce((sum, item) => sum + item.reps.invalid, 0)
  if (invalid > 0) notes.push(`有 ${invalid} 次动作因识别无效未计入分析。`)
  const missingByExercise = new Map<string, number>()
  for (const item of missingEvidence) missingByExercise.set(item.exerciseId, Math.max(missingByExercise.get(item.exerciseId) ?? 0, item.reps))
  for (const [exerciseId, reps] of missingByExercise) notes.push(`${exerciseName(exerciseId as ExerciseId)}有 ${reps} 次未能判断举到顶部时的手肘伸展。`)

  return {
    rulesSupport: facts.rulesSupport,
    sessionFlags: sessionFlags(facts),
    poseQuality: { ...pose, byExercise, environmentHint },
    reps: {
      recorded: exercises.reduce((sum, item) => sum + item.reps.recorded, 0),
      valid: exercises.reduce((sum, item) => sum + item.reps.valid, 0),
      partial: exercises.reduce((sum, item) => sum + item.reps.partial, 0),
      invalid,
      byExercise: exercises.map((item) => ({
        exerciseId: item.exerciseId, recorded: item.reps.recorded, valid: item.reps.valid, partial: item.reps.partial, invalid: item.reps.invalid,
      })),
    },
    missingEvidence,
    limitedExercises,
    guidance: { exerciseId: 'shoulder_rotation', status: facts.guidanceStatus, scored: false },
    comparisonLimitations: limitations,
    notes,
  }
}
