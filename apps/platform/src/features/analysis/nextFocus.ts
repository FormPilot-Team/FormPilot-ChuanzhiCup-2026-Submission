import { ELECTRONIC_COACH_COURSE_V1 } from '../course/CourseDefinition'
import { ANALYSIS_CONFIG_V1 } from './config'
import { exerciseName } from './copy'
import { issueDefinition, tempoRangeText, tooSlowCue } from './issueTaxonomy'
import { compareCodeUnits } from './ratio'
import type {
  CapabilityAnalysis, ExerciseAnalysis, FocusItem, FocusTarget, IssueUnit, PriorityIssue, PriorityMember, ScoredExerciseId,
} from './types'

const ISSUE = ANALYSIS_CONFIG_V1.issue
const ORDER = ANALYSIS_CONFIG_V1.scoredExerciseIds

/** Planned repetitions of one exercise in the course definition (step jack cycles count two reps each). */
function plannedReps(exerciseId: ScoredExerciseId): number {
  const step = ELECTRONIC_COACH_COURSE_V1.steps.find((item) => item.exerciseId === exerciseId)
  if (!step) return 0
  return step.target.type === 'cycles' ? step.target.value * 2 : step.target.value
}

/** N for the target: the number of units the course plan will produce for this issue next time. */
export function plannedUnits(canonicalId: string): number {
  const definition = issueDefinition(canonicalId)
  if (!definition) return 0
  const reps = plannedReps(definition.exerciseId)
  if (canonicalId === 'knee_raise.height_gap') return Math.floor(reps / 2)
  if (definition.side && definition.exerciseId === 'knee_raise') return Math.floor(reps / 2)
  if (definition.groupId.endsWith('.alternation')) return reps - 1
  return reps
}

/**
 * Largest affected count that the next session could have and still be judged IMPROVED against (a, n):
 *   a1 ≤ a − trendMinCountDelta  AND  den·(a·N − a1·n) ≥ num·n·N  (rate drop ≥ 1/4, cross-multiplied).
 * For N = n this is exactly 8F-1A §20 (4/6 → "6 次中至少 4 次", 6/12 → "12 次中至少 9 次").
 */
export function maxAffectedForImprovement(affected: number, evaluable: number, planned: number): number {
  const { num, den } = ISSUE.trendMinRateDelta
  const byCount = affected - ISSUE.trendMinCountDelta
  const byRate = Math.floor((planned * (den * affected - num * evaluable)) / (den * evaluable))
  return Math.max(0, Math.min(byCount, byRate))
}

function memberTarget(item: PriorityMember): { outOf: number; compliantAtLeast: number; unit: IssueUnit } {
  const outOf = plannedUnits(item.canonicalId)
  return { outOf, compliantAtLeast: outOf - maxAffectedForImprovement(item.stats.affected, item.stats.evaluable, outOf), unit: item.unit }
}

function sideName(side: PriorityMember['side']): string {
  return side === 'left' ? '左侧' : side === 'right' ? '右侧' : ''
}

function priorityTarget(entry: PriorityIssue): FocusTarget {
  if (entry.kind === 'SIDE_PAIR') {
    const targets = entry.members.map((item) => ({ item, target: memberTarget(item) }))
    const top = [...targets].sort((left, right) => right.item.technicalPriority - left.item.technicalPriority)[0]
    const same = targets.every(({ target }) => target.outOf === top.target.outOf && target.compliantAtLeast === top.target.compliantAtLeast)
    const text = same
      ? `下次目标：左右两侧各 ${top.target.outOf} ${top.target.unit}中至少 ${top.target.compliantAtLeast} ${top.target.unit}做到。`
      : `下次目标：${targets.map(({ item, target }) => `${sideName(item.side)} ${target.outOf} ${target.unit}中至少 ${target.compliantAtLeast} ${target.unit}`).join('，')}做到。`
    return { ...top.target, text }
  }
  const top = [...entry.members].sort((left, right) => right.technicalPriority - left.technicalPriority
    || ORDER.indexOf(left.exerciseId) - ORDER.indexOf(right.exerciseId)
    || compareCodeUnits(left.canonicalId, right.canonicalId))[0]
  const target = memberTarget(top)
  const prefix = entry.kind === 'THEME' ? `${exerciseName(top.exerciseId)}${top.side ? sideName(top.side) : ''} ` : ''
  return { ...target, text: `下次目标：${prefix}${target.outOf} ${target.unit}中至少 ${target.compliantAtLeast} ${target.unit}做到。` }
}

function fromPriority(entry: PriorityIssue, rank: 1 | 2): FocusItem {
  const target = priorityTarget(entry)
  const lead = entry.kind === 'THEME' ? entry.cue : `${exerciseName(entry.exerciseIds[0])}：${entry.cue}`
  return {
    rank,
    source: 'PRIORITY_ISSUE',
    exerciseIds: entry.exerciseIds,
    canonicalIds: entry.canonicalIds,
    bodyRegion: entry.bodyRegion,
    cue: entry.cue,
    target,
    text: `${lead}。${target.text}`,
  }
}

function weakCapability(capability: CapabilityAnalysis, exercises: readonly ExerciseAnalysis[]): FocusItem | null {
  const threshold = ANALYSIS_CONFIG_V1.capability.weakThreshold
  const dimensions = capability.dimensions
    .filter((item) => item.value !== null && item.value < threshold)
    .sort((left, right) => (left.value as number) - (right.value as number))
  for (const dimension of dimensions) {
    const lowest = [...dimension.contributors]
      .filter((item) => item.value < threshold)
      .sort((left, right) => left.value - right.value || ORDER.indexOf(left.exerciseId) - ORDER.indexOf(right.exerciseId))[0]
    const exercise = lowest && exercises.find((item) => item.exerciseId === lowest.exerciseId)
    if (!exercise) continue
    const name = exercise.displayName
    if (dimension.dimension === 'TEMPO') {
      const direction = exercise.tempo.direction
      if (direction !== 'TOO_FAST' && direction !== 'TOO_SLOW') continue
      const tooFast = exercise.issues.find((issue) => issue.groupId === `${exercise.exerciseId}.too_fast`)
      if (!tooFast) continue
      const cue = direction === 'TOO_FAST' ? tooFast.cue : tooSlowCue(exercise.exerciseId)
      const outOf = plannedReps(exercise.exerciseId)
      const compliantAtLeast = Math.ceil((2 * outOf) / 3)
      const target: FocusTarget = {
        compliantAtLeast,
        outOf,
        unit: '次',
        text: `下次目标：${outOf} 次中至少 ${compliantAtLeast} 次在 ${tempoRangeText(exercise.exerciseId)} 秒内完成。`,
      }
      return {
        rank: 1, source: 'WEAK_CAPABILITY', exerciseIds: [exercise.exerciseId], canonicalIds: [tooFast.canonicalId],
        bodyRegion: tooFast.bodyRegion, cue, target, text: `${name}：${cue}。${target.text}`,
      }
    }
    const issue = exercise.issues
      .filter((item) => item.dimension === dimension.dimension && (item.stats?.affected ?? 0) >= 1)
      .sort((left, right) => (right.stats?.affected ?? 0) - (left.stats?.affected ?? 0)
        || right.technicalPriorityWeight - left.technicalPriorityWeight)[0]
    if (!issue) continue
    return {
      rank: 1, source: 'WEAK_CAPABILITY', exerciseIds: [exercise.exerciseId], canonicalIds: [issue.canonicalId],
      bodyRegion: issue.bodyRegion, cue: issue.cue, target: null, text: `${name}：${issue.cue}。`,
    }
  }
  return null
}

/** 8F-1A §20: top 2 priority entries; otherwise at most one weak-capability item; otherwise []. */
export function buildNextFocus(priorityIssues: readonly PriorityIssue[], capability: CapabilityAnalysis, exercises: readonly ExerciseAnalysis[]): FocusItem[] {
  if (priorityIssues.length > 0) {
    return priorityIssues.slice(0, ANALYSIS_CONFIG_V1.focus.maxItems).map((entry, index) => fromPriority(entry, (index + 1) as 1 | 2))
  }
  const hasSignificant = exercises.some((exercise) => exercise.issues.some((issue) => issue.significance === 'SIGNIFICANT'))
  if (hasSignificant || !capability.available) return []
  const weak = weakCapability(capability, exercises)
  return weak ? [weak] : []
}
