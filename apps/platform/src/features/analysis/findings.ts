import { ANALYSIS_CONFIG_V1 } from './config'
import { CAPABILITY_LABELS, exerciseName, THEME_COPY } from './copy'
import { REPORT_ISSUE_TAXONOMY } from './issueTaxonomy'
import { compareCodeUnits, ratioText } from './ratio'
import type { CapabilityAnalysis, ExerciseAnalysis, Finding, IssueAnalysis, IssueThemeId, Overall, ScoredExerciseId } from './types'

const STRENGTH = ANALYSIS_CONFIG_V1.strength
const ORDER = ANALYSIS_CONFIG_V1.scoredExerciseIds

function courseIndex(exerciseId: ScoredExerciseId): number {
  return ORDER.indexOf(exerciseId)
}

function allIssues(exercises: readonly ExerciseAnalysis[]): IssueAnalysis[] {
  return exercises.flatMap((exercise) => exercise.issues)
}

function resolvedFinding(issue: IssueAnalysis): Finding | null {
  const previous = issue.comparison?.previous
  if (issue.comparison?.trend !== 'RESOLVED' || !previous || !issue.stats) return null
  return {
    id: `resolved:${issue.canonicalId}`,
    kind: 'HISTORICAL_RESOLVED',
    exerciseIds: [issue.exerciseId],
    canonicalIds: [issue.canonicalId],
    dimension: issue.dimension,
    evidence: { type: 'ISSUE_CHANGE', current: issue.stats, previous, unit: issue.unit },
    text: `${exerciseName(issue.exerciseId)}：${issue.reportLabel}，上次 ${ratioText(previous, issue.unit)}，本次未再出现。`,
  }
}

function improvedFinding(issue: IssueAnalysis): Finding | null {
  const previous = issue.comparison?.previous
  if (issue.comparison?.trend !== 'IMPROVED' || !previous || !issue.stats) return null
  return {
    id: `improved:${issue.canonicalId}`,
    kind: 'HISTORICAL_ISSUE_IMPROVED',
    exerciseIds: [issue.exerciseId],
    canonicalIds: [issue.canonicalId],
    dimension: issue.dimension,
    evidence: { type: 'ISSUE_CHANGE', current: issue.stats, previous, unit: issue.unit },
    text: `${exerciseName(issue.exerciseId)}：${issue.reportLabel}，从上次 ${ratioText(previous, issue.unit)}减少到本次 ${ratioText(issue.stats, issue.unit)}。`,
  }
}

function scoreFinding(exercise: ExerciseAnalysis): Finding | null {
  if (exercise.scoreTrend !== 'IMPROVED' || exercise.score === null || exercise.previousScore === null || exercise.scoreDelta === null) return null
  if (exercise.scoreDelta < STRENGTH.historicalMinScoreDelta) return null
  return {
    id: `score:${exercise.exerciseId}`,
    kind: 'HISTORICAL_SCORE_IMPROVED',
    exerciseIds: [exercise.exerciseId],
    canonicalIds: [],
    dimension: null,
    evidence: { type: 'SCORE_CHANGE', current: exercise.score, previous: exercise.previousScore, delta: exercise.scoreDelta },
    text: `${exercise.displayName}评分比上次提高 ${exercise.scoreDelta} 分（${exercise.previousScore} 分 → ${exercise.score} 分）。`,
  }
}

/** Historical progress, ordered RESOLVED > IMPROVED issue > exercise score (largest Δ first) > overall. */
export function buildImprovements(exercises: readonly ExerciseAnalysis[], overall: Overall): Finding[] {
  const issues = allIssues(exercises)
  const resolved = issues
    .filter((issue) => issue.comparison?.trend === 'RESOLVED')
    .sort((left, right) => right.technicalPriorityWeight - left.technicalPriorityWeight
      || courseIndex(left.exerciseId) - courseIndex(right.exerciseId)
      || compareCodeUnits(left.canonicalId, right.canonicalId))
    .map(resolvedFinding)
  const drop = (issue: IssueAnalysis) => (issue.comparison?.previous?.affected ?? 0) - (issue.stats?.affected ?? 0)
  const improved = issues
    .filter((issue) => issue.comparison?.trend === 'IMPROVED')
    .sort((left, right) => drop(right) - drop(left)
      || right.technicalPriorityWeight - left.technicalPriorityWeight
      || courseIndex(left.exerciseId) - courseIndex(right.exerciseId)
      || compareCodeUnits(left.canonicalId, right.canonicalId))
    .map(improvedFinding)
  const scores = [...exercises]
    .sort((left, right) => (right.scoreDelta ?? 0) - (left.scoreDelta ?? 0) || courseIndex(left.exerciseId) - courseIndex(right.exerciseId))
    .map(scoreFinding)
  const overallFinding: Finding | null = overall.trend === 'IMPROVED' && overall.score !== null && overall.previousScore !== null && overall.delta !== null
    ? {
        id: 'overall',
        kind: 'HISTORICAL_OVERALL_IMPROVED',
        exerciseIds: [],
        canonicalIds: [],
        dimension: null,
        evidence: { type: 'SCORE_CHANGE', current: overall.score, previous: overall.previousScore, delta: overall.delta },
        text: `综合评分比上次提高 ${overall.delta} 分。`,
      }
    : null
  return [...resolved, ...improved, ...scores, overallFinding].filter((item): item is Finding => item !== null)
}

function hasSignificantIssue(exercise: ExerciseAnalysis): boolean {
  return exercise.issues.some((issue) => issue.significance === 'SIGNIFICANT')
}

function exerciseStrength(exercise: ExerciseAnalysis): Finding | null {
  if (exercise.completion.status !== 'completed' || exercise.score === null || !exercise.consistency) return null
  if (exercise.reps.analyzed < STRENGTH.exerciseMinValidReps) return null
  if (exercise.score < STRENGTH.exerciseMinScore || exercise.consistency.minRepScore < STRENGTH.exerciseMinRepScore) return null
  // Contradiction guard: an exercise with any significant issue can never be a strength.
  if (hasSignificantIssue(exercise)) return null
  return {
    id: `exercise:${exercise.exerciseId}`,
    kind: 'EXERCISE_STRENGTH',
    exerciseIds: [exercise.exerciseId],
    canonicalIds: [],
    dimension: null,
    evidence: { type: 'EXERCISE_SCORE', score: exercise.score, minRepScore: exercise.consistency.minRepScore, validReps: exercise.reps.analyzed },
    text: `${exercise.displayName}：${exercise.reps.analyzed} 次有效动作平均 ${exercise.score} 分，单次最低 ${exercise.consistency.minRepScore} 分，未检测到需要优先纠正的问题。`,
  }
}

function capabilityStrengths(capability: CapabilityAnalysis, issues: readonly IssueAnalysis[]): Finding[] {
  return capability.dimensions
    .filter((dimension) => dimension.value !== null
      && dimension.value >= STRENGTH.capabilityMinValue
      && dimension.contributors.length >= STRENGTH.capabilityMinContributors
      && dimension.contributors.every((item) => item.value >= STRENGTH.capabilityMinContributorValue)
      && !issues.some((issue) => issue.dimension === dimension.dimension && issue.significance === 'SIGNIFICANT'))
    .sort((left, right) => (right.value as number) - (left.value as number))
    .map((dimension) => {
      const minContributorValue = Math.min(...dimension.contributors.map((item) => item.value))
      return {
        id: `capability:${dimension.dimension}`,
        kind: 'CAPABILITY_STRENGTH' as const,
        exerciseIds: dimension.contributors.map((item) => item.exerciseId),
        canonicalIds: [],
        dimension: dimension.dimension,
        evidence: { type: 'CAPABILITY' as const, value: dimension.value as number, contributorCount: dimension.contributors.length, minContributorValue },
        text: `${CAPABILITY_LABELS[dimension.dimension]}：${dimension.value} 分，参与计算的 ${dimension.contributors.length} 个动作中最低 ${minContributorValue} 分。`,
      }
    })
}

const ISSUE_FREE_THEMES: readonly IssueThemeId[] = ['TORSO_STABILITY', 'ARM_SYMMETRY', 'TEMPO_TOO_FAST']

function issueFreeStrengths(exercises: readonly ExerciseAnalysis[]): Finding[] {
  const findings: Finding[] = []
  for (const themeId of ISSUE_FREE_THEMES) {
    const members = REPORT_ISSUE_TAXONOMY.filter((definition) => definition.themeId === themeId)
    if (new Set(members.map((definition) => definition.exerciseId)).size < STRENGTH.issueFreeMinExercises) continue
    const memberIssues = members.flatMap((definition) => {
      const exercise = exercises.find((item) => item.exerciseId === definition.exerciseId)
      const issue = exercise?.issues.find((item) => item.canonicalId === definition.canonicalId)
      return exercise && issue ? [{ exercise, issue }] : []
    })
    const totalAffected = memberIssues.reduce((sum, item) => sum + (item.issue.stats?.affected ?? 0), 0)
    const qualifying = memberIssues.filter((item) => item.exercise.completion.status === 'completed'
      && (item.issue.stats?.evaluable ?? 0) >= STRENGTH.issueFreeMinEvaluablePerExercise)
    if (totalAffected !== 0 || qualifying.length < STRENGTH.issueFreeMinExercises) continue
    const evaluable = qualifying.reduce((sum, item) => sum + (item.issue.stats?.evaluable ?? 0), 0)
    findings.push({
      id: `issue-free:${themeId}`,
      kind: 'ISSUE_FREE_STRENGTH',
      exerciseIds: qualifying.map((item) => item.exercise.exerciseId),
      canonicalIds: qualifying.map((item) => item.issue.canonicalId),
      dimension: members[0].dimension,
      evidence: { type: 'ISSUE_FREE', exercises: qualifying.length, evaluable },
      text: `${qualifying.length} 个动作共 ${evaluable} 次可评估动作中均未检测到${THEME_COPY[themeId].issueFreeLabel}。`,
    })
  }
  return findings
}

const EXERCISE_SPECIFIC = new Set<Finding['kind']>(['HISTORICAL_RESOLVED', 'HISTORICAL_SCORE_IMPROVED', 'EXERCISE_STRENGTH'])

/** 8F-1A §18: at most 2, at most 1 per exercise, fixed source order, never padded. */
export function selectStrengths(input: {
  exercises: readonly ExerciseAnalysis[]
  capability: CapabilityAnalysis
  improvements: readonly Finding[]
}): Finding[] {
  const exerciseCandidates = [...input.exercises]
    .map(exerciseStrength)
    .filter((item): item is Finding => item !== null)
    .sort((left, right) => (right.evidence.type === 'EXERCISE_SCORE' && left.evidence.type === 'EXERCISE_SCORE' ? right.evidence.score - left.evidence.score : 0)
      || courseIndex(left.exerciseIds[0]) - courseIndex(right.exerciseIds[0]))
  const candidates = [
    ...input.improvements.filter((item) => item.kind === 'HISTORICAL_RESOLVED'),
    ...input.improvements.filter((item) => item.kind === 'HISTORICAL_SCORE_IMPROVED'),
    ...exerciseCandidates,
    ...(input.capability.available ? capabilityStrengths(input.capability, allIssues(input.exercises)) : []),
    ...issueFreeStrengths(input.exercises),
  ]
  const perExercise = new Map<ScoredExerciseId, number>()
  const selected: Finding[] = []
  for (const candidate of candidates) {
    if (selected.length >= STRENGTH.maxItems) break
    if (EXERCISE_SPECIFIC.has(candidate.kind)) {
      const exerciseId = candidate.exerciseIds[0]
      if ((perExercise.get(exerciseId) ?? 0) >= STRENGTH.maxPerExercise) continue
      perExercise.set(exerciseId, (perExercise.get(exerciseId) ?? 0) + 1)
    }
    selected.push(candidate)
  }
  return selected
}
