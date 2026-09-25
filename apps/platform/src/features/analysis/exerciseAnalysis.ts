import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import { KNEE_RAISE_V1 } from '../exercises/kneeRaise/config'
import { LATERAL_RAISE_V1 } from '../exercises/lateralRaise/config'
import { OVERHEAD_RAISE_V1 } from '../exercises/overheadRaise/config'
import { SQUAT_V1 } from '../exercises/squat/config'
import { STEP_JACK_V1 } from '../exercises/stepJack/config'
import type { ExerciseId } from '../exercises/types'
import type { ExerciseSessionResult } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import { compareScore } from './comparison'
import { collectIssueEvidence } from './issueEvidence'
import { buildIssueLedger } from './issueLedger'
import { compareIssueTrend } from './issueComparison'
import { REPORT_ISSUE_TAXONOMY } from './issueTaxonomy'
import { analyzedRepetitions, repetitionQuality } from './repetitionValidity'
import type { ExerciseAnalysis } from './types'

function meanRounded(values: readonly number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}
function durationBand(exerciseId: ExerciseId): { min: number; max: number } | null {
  switch (exerciseId) {
    case 'overhead_raise': return { min: OVERHEAD_RAISE_V1.repDurationMinMs, max: OVERHEAD_RAISE_V1.repDurationMaxMs }
    case 'lateral_raise': return { min: LATERAL_RAISE_V1.repDurationMinMs, max: LATERAL_RAISE_V1.repDurationMaxMs }
    case 'step_jack': return { min: STEP_JACK_V1.repDurationMinMs, max: STEP_JACK_V1.repDurationMaxMs }
    case 'squat': return { min: SQUAT_V1.repDurationMinMs, max: SQUAT_V1.repDurationMaxMs }
    case 'knee_raise': return { min: KNEE_RAISE_V1.repDurationMinMs, max: KNEE_RAISE_V1.repDurationMaxMs }
    default: return null
  }
}

function tempoDirection(exercise: ExerciseSessionResult): ExerciseAnalysis['tempoDirection'] {
  const band = durationBand(exercise.exerciseId)
  if (!band) return null
  const reps = analyzedRepetitions(exercise)
  if (reps.length < ANALYSIS_CONFIG_V1.minEvaluableReps) return null
  const fast = reps.filter((item) => item.rep.durationMs < band.min).length
  const slow = reps.filter((item) => item.rep.durationMs > band.max).length
  if (fast * 2 > reps.length) return 'TOO_FAST'
  if (slow * 2 > reps.length) return 'TOO_SLOW'
  return 'APPROPRIATE'
}

function emptyExercise(exerciseId: ExerciseId, role: ExerciseAnalysis['role']): ExerciseAnalysis {
  return {
    exerciseId, role, repetitionQuality: { valid: 0, partial: 0, invalid: 0, total: 0 }, analyzedRepCount: 0,
    score: null, scoreUnavailableReason: 'INSUFFICIENT_VALID_REPS', previousScore: null, scoreDelta: null, scoreTrend: null,
    issues: [], tempoDirection: null, missingEvidence: [],
  }
}

export function analyzeExercise(
  exerciseId: ExerciseId,
  current: ExerciseSessionResult | null,
  previous: ExerciseSessionResult | null,
): ExerciseAnalysis {
  const step = ELECTRONIC_COACH_COURSE_V1.steps.find((item) => item.exerciseId === exerciseId)
  const role = step?.evaluationMode === 'guidance' ? 'guidance' : 'scored'
  if (!current) return emptyExercise(exerciseId, role)
  const quality = repetitionQuality(current)
  const analyzed = analyzedRepetitions(current)
  const score = role === 'scored' && analyzed.length >= ANALYSIS_CONFIG_V1.minScoredReps
    ? meanRounded(analyzed.map((item) => item.score))
    : null
  const previousAnalyzed = previous ? analyzedRepetitions(previous) : []
  const previousScore = role === 'scored' && previousAnalyzed.length >= ANALYSIS_CONFIG_V1.minScoredReps
    ? meanRounded(previousAnalyzed.map((item) => item.score))
    : null
  const previousLedger = previous ? buildIssueLedger(previous) : []
  const issues = role === 'guidance' ? [] : buildIssueLedger(current).map((item) => {
    const before = previousLedger.find((candidate) => candidate.code === item.code)
    return before ? { ...item, previousIncidence: before.incidence, trend: compareIssueTrend(item.incidence, before.incidence) } : item
  })
  const missingEvidence = REPORT_ISSUE_TAXONOMY.filter((definition) => definition.exerciseId === exerciseId)
    .flatMap((definition) => collectIssueEvidence(current, definition).missingEvidenceCount > 0 ? [`${definition.code}:topElbow`] : [])
  return {
    exerciseId,
    role,
    repetitionQuality: quality,
    analyzedRepCount: analyzed.length,
    score,
    scoreUnavailableReason: score === null ? 'INSUFFICIENT_VALID_REPS' : null,
    previousScore,
    scoreDelta: score !== null && previousScore !== null ? score - previousScore : null,
    scoreTrend: score !== null && previousScore !== null ? compareScore(score, previousScore, ANALYSIS_CONFIG_V1.exerciseScoreDeadband) : null,
    issues,
    tempoDirection: role === 'scored' ? tempoDirection(current) : null,
    missingEvidence,
  }
}
