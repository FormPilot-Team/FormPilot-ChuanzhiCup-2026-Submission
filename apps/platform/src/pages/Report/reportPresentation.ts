import type {
  CapabilityDimension, CompletionAnalysis, IssueTrend, Ratio, ScoredExerciseId, Trend,
} from '../../features/analysis'

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
