import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import type { ExerciseSessionResult, TrainingSessionState } from '../training/types'
import { exerciseContributions } from './capability'
import { ANALYSIS_CONFIG_V1 } from './config'
import { collectIssueEvidence, type AnalyzedRep, type IssueEvidence } from './issueEvidence'
import { definitionsFor } from './issueTaxonomy'
import { finite, meanRounded, ratioOrNull } from './ratio'
import { classifyRepetition } from './repetitionValidity'
import { assessRulesSupport, isCourseFlow, isFinalized, resolveAnalysisMode, resolveSource } from './rulesSupport'
import { analyzeTempo } from './tempo'
import type {
  AnalysisMode, CapabilityDimension, CompletionAnalysis, DimensionContribution, Ratio, RepetitionValidity,
  RulesSupport, ScoredExerciseId, TempoAnalysis,
} from './types'

/** Everything analysis-v1 derives from one session on its own, before any history is consulted. */
export interface ExerciseFacts {
  exerciseId: ScoredExerciseId
  record: ExerciseSessionResult | null
  validities: RepetitionValidity[]
  analyzed: AnalyzedRep[]
  counts: { recorded: number; valid: number; partial: number; invalid: number; analyzed: number }
  completion: CompletionAnalysis
  score: number | null
  evidence: Map<string, IssueEvidence>
  stats: Map<string, Ratio | null>
  contribution: Record<CapabilityDimension, DimensionContribution>
  tempo: TempoAnalysis
}

export interface SessionFacts {
  session: TrainingSessionState
  rulesSupport: RulesSupport
  mode: AnalysisMode
  exercises: ExerciseFacts[]
  guidanceStatus: CompletionAnalysis['status']
  completedExercises: number
  courseComplete: boolean
  fullScope: boolean
}

const STEPS = ELECTRONIC_COACH_COURSE_V1.steps

function findExercise(session: TrainingSessionState, exerciseId: string): ExerciseSessionResult | null {
  return Array.isArray(session.exercises) ? session.exercises.find((item) => item?.exerciseId === exerciseId) ?? null : null
}

function completionOf(exerciseId: ScoredExerciseId, record: ExerciseSessionResult | null): CompletionAnalysis {
  const step = STEPS.find((item) => item.exerciseId === exerciseId)
  const unit = step?.target.type === 'cycles' ? 'cycles' : 'reps'
  const planned = step?.target.value ?? 0
  if (!record) return { status: 'not_started', progress: 0, target: planned, unit }
  // Fast mode stores the normal target, so a 1-rep fast exercise is correctly incomplete here.
  const target = finite(record.targetValue) && record.targetValue > 0 ? record.targetValue : planned
  const recorded = Array.isArray(record.repetitions) ? record.repetitions.length : 0
  const progress = unit === 'cycles' ? Math.floor(recorded / 2) : recorded
  return { status: progress >= target ? 'completed' : 'incomplete', progress, target, unit }
}

function exerciseFacts(exerciseId: ScoredExerciseId, record: ExerciseSessionResult | null, rulesSupport: RulesSupport): ExerciseFacts {
  const repetitions = record && Array.isArray(record.repetitions) ? record.repetitions : []
  const validities = record ? repetitions.map((item) => classifyRepetition(item, record)) : []
  const analyzed: AnalyzedRep[] = []
  validities.forEach((validity, index) => {
    if (validity !== 'INVALID') analyzed.push({ index, result: repetitions[index], validity })
  })
  const counts = {
    recorded: repetitions.length,
    valid: validities.filter((item) => item === 'VALID').length,
    partial: validities.filter((item) => item === 'PARTIAL').length,
    invalid: validities.filter((item) => item === 'INVALID').length,
    analyzed: analyzed.length,
  }
  const completion = completionOf(exerciseId, record)
  // Stored aggregates (overallScore, metricAverages, ...) are ignored; INVALID reps never count as 0.
  const score = analyzed.length >= ANALYSIS_CONFIG_V1.exerciseScore.minAnalyzedReps ? meanRounded(analyzed.map((item) => item.result.score)) : null
  const evidence = new Map<string, IssueEvidence>()
  const stats = new Map<string, Ratio | null>()
  for (const definition of definitionsFor(exerciseId)) {
    const collected = collectIssueEvidence(definition, analyzed, { legacy: rulesSupport === 'LEGACY_UNVERSIONED' })
    evidence.set(definition.canonicalId, collected)
    stats.set(definition.canonicalId, ratioOrNull(collected.units.filter((unit) => unit.affected).length, collected.units.length))
  }
  const rulesSupported = rulesSupport !== 'UNSUPPORTED'
  return {
    exerciseId,
    record,
    validities,
    analyzed,
    counts,
    completion,
    score,
    evidence,
    stats,
    contribution: exerciseContributions({ exerciseId, completion, analyzed, evidence, rulesSupported }),
    tempo: analyzeTempo(exerciseId, analyzed, rulesSupported),
  }
}

export function buildSessionFacts(session: TrainingSessionState): SessionFacts {
  const rulesSupport = assessRulesSupport(session)
  const exercises = ANALYSIS_CONFIG_V1.scoredExerciseIds.map((id) => exerciseFacts(id, findExercise(session, id), rulesSupport))
  const guidance = findExercise(session, 'shoulder_rotation')
  const guidanceStatus: CompletionAnalysis['status'] = !guidance ? 'not_started' : guidance.completed ? 'completed' : 'incomplete'
  const completedExercises = exercises.filter((item) => item.completion.status === 'completed').length + (guidanceStatus === 'completed' ? 1 : 0)
  const courseComplete = session.courseStatus === 'completed' && completedExercises === STEPS.length
  return {
    session,
    rulesSupport,
    mode: resolveAnalysisMode(session),
    exercises,
    guidanceStatus,
    completedExercises,
    courseComplete,
    fullScope: courseComplete && exercises.every((item) => item.score !== null),
  }
}

/** Current-session eligibility facts shared by comparison and data quality. */
export function sessionConditions(session: TrainingSessionState) {
  return {
    source: resolveSource(session),
    mode: resolveAnalysisMode(session),
    rulesSupport: assessRulesSupport(session),
    courseFlow: isCourseFlow(session),
    finalized: isFinalized(session),
  }
}

export function exerciseComparable(facts: ExerciseFacts): boolean {
  return facts.completion.status === 'completed' && facts.score !== null
}
