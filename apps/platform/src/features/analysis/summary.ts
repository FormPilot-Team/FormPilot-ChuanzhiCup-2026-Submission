import { ANALYSIS_CONFIG_V1 } from './config'
import { exerciseList, insufficientElbowEvidenceText } from './copy'
import { compareCodeUnits } from './ratio'
import type {
  Comparison, ExerciseAnalysis, Finding, Overall, PriorityIssue, RulesSupport, ScoredExerciseId, SummarySentence,
} from './types'

const ORDER = ANALYSIS_CONFIG_V1.scoredExerciseIds

function overallSentence(overall: Overall, comparison: Comparison, courseComplete: boolean, exercises: readonly ExerciseAnalysis[]): SummarySentence {
  const refs = ['overall', ...exercises.map((item) => `exercise:${item.exerciseId}`)]
  if (overall.scope === 'FULL_COURSE' && overall.score !== null) {
    let change = ''
    if (comparison.level === 'FULL' && overall.trend && overall.delta !== null) {
      if (overall.trend === 'IMPROVED') change = `，比上次提高 ${overall.delta} 分`
      else if (overall.trend === 'DECLINED') change = `，比上次降低 ${Math.abs(overall.delta)} 分`
      else change = '，与上次基本持平'
    }
    return { slot: 'OVERALL', text: `本次完成全部 6 个动作，综合评分 ${overall.score} 分${change}。`, evidenceRefs: refs }
  }
  if (courseComplete) {
    return { slot: 'OVERALL', text: '本次完成全部 6 个动作，部分动作有效识别次数不足，暂不给出综合评分。', evidenceRefs: refs }
  }
  const completed = exercises.filter((item) => item.completion.status === 'completed').length
  if (completed === 0) return { slot: 'OVERALL', text: '本次训练未完成，暂无达到目标次数的计分动作。', evidenceRefs: refs }
  let average = ''
  if (overall.scope === 'COMPLETED_EXERCISES' && overall.score !== null) {
    if (overall.scoredExerciseCount === 1) average = completed === 1 ? `，得分 ${overall.score} 分` : `，其中 1 个有评分，得分 ${overall.score} 分`
    else if (overall.scoredExerciseCount === completed) average = `，平均 ${overall.score} 分`
    else average = `，其中 ${overall.scoredExerciseCount} 个有评分，平均 ${overall.score} 分`
  }
  return { slot: 'OVERALL', text: `本次训练未完成，已完成 ${completed} 个计分动作${average}。`, evidenceRefs: refs }
}

function findingSentence(slot: SummarySentence['slot'], finding: Finding): SummarySentence {
  return { slot, text: finding.text, evidenceRefs: [finding.id, ...finding.canonicalIds.map((id) => `issue:${id}`)] }
}

function withinSessionBest(exercises: readonly ExerciseAnalysis[]): Finding | null {
  const items = exercises.flatMap((item) => item.withinExerciseImprovement ? [item.withinExerciseImprovement] : [])
  const drop = (finding: Finding) => finding.evidence.type === 'WITHIN_SESSION'
    ? finding.evidence.firstHalf.affected - finding.evidence.secondHalf.affected : 0
  return [...items].sort((left, right) => drop(right) - drop(left)
    || ORDER.indexOf(left.exerciseIds[0]) - ORDER.indexOf(right.exerciseIds[0])
    || compareCodeUnits(left.id, right.id))[0] ?? null
}

/** Deterministic 2–4 sentence summary in frozen slot order (8F-1A §21). Every sentence carries evidence refs. */
export function buildSummary(input: {
  overall: Overall
  comparison: Comparison
  courseComplete: boolean
  rulesSupport: RulesSupport
  exercises: readonly ExerciseAnalysis[]
  improvements: readonly Finding[]
  priorityIssues: readonly PriorityIssue[]
  strengths: readonly Finding[]
}): SummarySentence[] {
  const sentences: SummarySentence[] = [overallSentence(input.overall, input.comparison, input.courseComplete, input.exercises)]

  const improvement = input.improvements.find((item) => item.kind !== 'HISTORICAL_OVERALL_IMPROVED') ?? null
  if (improvement) sentences.push(findingSentence('IMPROVEMENT', improvement))

  const top = input.priorityIssues[0]
  if (input.rulesSupport === 'UNSUPPORTED') {
    sentences.push({
      slot: 'LIMITED_DATA',
      text: '本次记录的评分规则版本与当前分析不一致，只展示评分，不分析动作问题。',
      evidenceRefs: ['dataQuality:rulesSupport'],
    })
  } else if (top) {
    // Always kept, whatever the overall trend.
    sentences.push({ slot: 'PRIORITY', text: `本次最需要关注：${top.text}。`, evidenceRefs: [`priority:${top.id}`, ...top.canonicalIds.map((id) => `issue:${id}`)] })
  } else {
    const elbowEvidence = input.exercises.flatMap((exercise) => exercise.issues
      .filter((issue) => issue.groupId === 'overhead_raise.elbow_extension'
        && issue.significance === 'INSUFFICIENT_EVIDENCE' && issue.missingEvidenceReps > 0))
    if (elbowEvidence.length > 0) {
      const evaluable = Math.min(...elbowEvidence.map((issue) => issue.stats?.evaluable ?? 0))
      sentences.push({
        slot: 'LIMITED_DATA',
        text: insufficientElbowEvidenceText(evaluable, true),
        evidenceRefs: elbowEvidence.map((issue) => `issue:${issue.canonicalId}`),
      })
    } else {
      const minReps = ANALYSIS_CONFIG_V1.issue.minEvaluableReps
      const analyzable = input.exercises.filter((item) => item.reps.analyzed >= minReps)
      const limited: ScoredExerciseId[] = input.exercises
        .filter((item) => item.completion.status !== 'not_started' && item.reps.analyzed < minReps)
        .map((item) => item.exerciseId)
      if (analyzable.length >= ANALYSIS_CONFIG_V1.summary.noPriorityMinExercises) {
        const qualifier = limited.length ? `（${exerciseList(limited)}有效识别次数不足，未纳入分析）` : ''
        sentences.push({
          slot: 'NO_PRIORITY',
          text: `本次没有需要优先纠正的问题${qualifier}。`,
          evidenceRefs: analyzable.map((item) => `exercise:${item.exerciseId}`),
        })
      } else {
        const notStarted = input.exercises.some((item) => item.completion.status === 'not_started')
        sentences.push({
          slot: 'LIMITED_DATA',
          text: notStarted ? '本次有动作未开始或有效识别次数不足，分析范围有限。' : '部分动作有效识别次数不足，本次分析范围有限。',
          evidenceRefs: ['dataQuality:limitedExercises'],
        })
      }
    }
  }

  const within = input.rulesSupport === 'UNSUPPORTED' ? null : withinSessionBest(input.exercises)
  const strength = input.strengths.find((item) => item.id !== improvement?.id) ?? null
  if (within) sentences.push(findingSentence('WITHIN_SESSION', within))
  else if (strength) sentences.push(findingSentence('STRENGTH', strength))

  return sentences.slice(0, ANALYSIS_CONFIG_V1.summary.maxSentences)
}
