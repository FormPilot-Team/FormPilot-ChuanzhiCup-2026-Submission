import { ANALYSIS_CONFIG_V1 } from '../../features/analysis'
import type {
  CapabilityDimension, CompletionAnalysis, IssueTrend, Ratio, ScoredExerciseId, SummarySentence, TrainingAnalysis, Trend,
} from '../../features/analysis'
import type { ExerciseId } from '../../features/exercises/types'
import { REPORT_EXERCISE_PRESENTATION } from '../../features/report/presentation'
import type { ScoreTone } from './reportShell'

export const EXERCISE_NAMES: Readonly<Record<ScoredExerciseId, string>> = {
  overhead_raise: '双臂上举',
  lateral_raise: '侧平举',
  step_jack: 'Step Jack',
  squat: '徒手深蹲',
  knee_raise: '交替提膝',
}

export const CAPABILITY_EXPLANATIONS: Readonly<Record<CapabilityDimension, string>> = {
  AMPLITUDE: '动作是否达到目标范围',
  STABILITY: '动作过程中身体是否保持稳定',
  COORDINATION: '左右或上下肢动作是否一致',
  TEMPO: '单次动作速度是否处于建议范围',
  FORM: '关键动作要求是否做到',
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(timestamp)
}

export function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '暂未记录'
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${minutes} 分 ${seconds.toString().padStart(2, '0')} 秒` : `${seconds} 秒`
}

export function completionProgress(completion: CompletionAnalysis): string {
  const unit = completion.unit === 'cycles' ? '组' : '次'
  return `${completion.progress} / ${completion.target} ${unit}`
}

/** Free training is NOT_COURSE_FLOW in analysis-v1; say so in product terms instead of course terms. */
export const FREE_TRAINING_COMPARISON_TEXT = '自由训练只评估本次动作，不参与完整课程的历史对比和长期趋势。'

export function freeTrainingProgressText(analysis: TrainingAnalysis, exerciseId: ExerciseId): string {
  if (exerciseId === 'shoulder_rotation') return analysis.guidance.status === 'completed' ? '已完成' : '未完成'
  const exercise = analysis.exercises.find((item) => item.exerciseId === exerciseId)
  return exercise ? completionProgress(exercise.completion) : '未开始'
}

export function freeTrainingUnscoredText(exerciseId: ExerciseId): string {
  return exerciseId === 'shoulder_rotation' ? '热身引导，不计分' : '暂不评分'
}

function freeTrainingOverallText(analysis: TrainingAnalysis, exerciseId: ExerciseId): string {
  const name = REPORT_EXERCISE_PRESENTATION[exerciseId].name
  if (exerciseId === 'shoulder_rotation') {
    return analysis.guidance.status === 'completed'
      ? `本次自由训练完成了${name}热身引导，该动作不计分。`
      : `本次自由训练提前结束，${name}热身引导未完成，该动作不计分。`
  }
  const exercise = analysis.exercises.find((item) => item.exerciseId === exerciseId)
  if (!exercise || exercise.completion.status === 'not_started') return `本次自由训练没有记录到${name}的有效动作。`
  const progress = completionProgress(exercise.completion)
  if (exercise.completion.status !== 'completed') return `本次自由训练提前结束，${name}完成 ${progress}。`
  return exercise.score === null
    ? `本次自由训练完成${name} ${progress}，有效识别次数不足，暂不评分。`
    : `本次自由训练完成${name} ${progress}，得分 ${exercise.score} 分。`
}

function freeTrainingLimitedText(analysis: TrainingAnalysis, exerciseId: ExerciseId): string {
  if (exerciseId === 'shoulder_rotation') return '肩部环绕属于热身引导，不做动作问题分析。'
  const exercise = analysis.exercises.find((item) => item.exerciseId === exerciseId)
  return !exercise || exercise.reps.analyzed < ANALYSIS_CONFIG_V1.issue.minEvaluableReps
    ? `本次${REPORT_EXERCISE_PRESENTATION[exerciseId].name}有效识别次数不足，分析范围有限。`
    : '自由训练只包含一个动作，本次分析范围有限。'
}

/**
 * analysis-v1 has no free-training scope: its OVERALL sentence ("本次训练未完成…") and its "some exercises not started"
 * limited-data sentence are written for the six-step course. For free training the report restates those two for its
 * one exercise from the same analysis numbers; every other sentence is shown exactly as analysed.
 */
export function freeTrainingSummary(analysis: TrainingAnalysis, exerciseId: ExerciseId): SummarySentence[] {
  return analysis.summary.map((sentence) => {
    if (sentence.slot === 'OVERALL') return { ...sentence, text: freeTrainingOverallText(analysis, exerciseId) }
    if (sentence.slot === 'LIMITED_DATA' && sentence.evidenceRefs.includes('dataQuality:limitedExercises')) {
      return { ...sentence, text: freeTrainingLimitedText(analysis, exerciseId) }
    }
    return sentence
  })
}

/** Visual tone of a 0–100 value (ring and bar colour only; the report text never grades by it). */
export function scoreTone(score: number | null): ScoreTone {
  if (score === null) return 'none'
  return score >= 80 ? 'good' : score >= 60 ? 'fair' : 'low'
}

export function scoreTrendText(trend: Trend | null, delta: number | null): string | null {
  if (trend === null || delta === null) return null
  if (trend === 'IMPROVED') return `↑ 比上次提高 ${delta} 分`
  if (trend === 'DECLINED') return `↓ 比上次降低 ${Math.abs(delta)} 分`
  return '与上次基本持平'
}

export function issueTrendText(trend: IssueTrend | null): string | null {
  if (trend === 'NEW') return '本次新出现'
  if (trend === 'PERSISTENT') return '连续两次训练存在'
  if (trend === 'WORSENED') return '比上次更频繁'
  if (trend === 'IMPROVED') return '已比上次减少'
  if (trend === 'RESOLVED') return '本次已解决'
  return null
}

export function ratioText(ratio: Ratio, unit: '次' | '组'): string {
  return `${ratio.evaluable} ${unit}中 ${ratio.affected} ${unit}`
}

export function comparisonRatioText(previous: Ratio, current: Ratio, unit: '次' | '组'): string {
  return `${previous.affected}/${previous.evaluable} → ${current.affected}/${current.evaluable} ${unit}`
}
