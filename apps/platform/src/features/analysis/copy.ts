import { REPORT_EXERCISE_PRESENTATION } from '../report/presentation'
import type { ExerciseId } from '../exercises/types'
import type { CapabilityDimension, CapabilityLabel, ComparisonReason, IssueThemeId } from './types'

/** User-facing copy only. No runtime codes, canonical ids or engineering terms may appear in these strings. */
export function exerciseName(exerciseId: ExerciseId): string {
  return REPORT_EXERCISE_PRESENTATION[exerciseId].name
}

export function exerciseList(exerciseIds: readonly ExerciseId[]): string {
  return exerciseIds.map(exerciseName).join('、')
}

export const CAPABILITY_LABELS: Readonly<Record<CapabilityDimension, CapabilityLabel>> = Object.freeze({
  AMPLITUDE: '幅度',
  STABILITY: '稳定',
  COORDINATION: '协调',
  TEMPO: '节奏',
  FORM: '动作规范',
})

export const COMPARISON_REASON_TEXT: Readonly<Record<ComparisonReason, string>> = Object.freeze({
  NO_PREVIOUS_SESSION: '这是第一条训练记录，暂无可对比的历史。',
  CURRENT_NOT_LIVE: '本次是演示或测试数据，不参与历史对比。',
  CURRENT_RULES_UNVERSIONED: '本次记录来自旧版本，无法确认评分规则，暂不比较。',
  CURRENT_MODE_UNKNOWN: '本次记录来自旧版本，无法确认评分规则，暂不比较。',
  CURRENT_FAST_MODE: '本次是快速测试模式，不参与历史对比。',
  CURRENT_RULES_UNSUPPORTED: '本次记录的评分规则版本与当前分析不一致，暂不比较。',
  CURRENT_NOT_COURSE_FLOW: '本次不是完整课程流程，暂不比较。',
  CURRENT_NOT_FINALIZED: '本次训练没有正常结束，暂不比较。',
  NO_ELIGIBLE_PREVIOUS: '之前的记录与本次训练条件不同，当前证据不足，暂不比较。',
  INSUFFICIENT_COMMON_EXERCISES: '与之前的记录共同完成的动作少于 2 个，暂不比较。',
  CURRENT_NOT_FULL_SCOPE: '本次有动作未完成或有效次数不足，仅比较双方都完成的 {k} 个动作，不比较综合评分。',
  NO_FULL_SCOPE_PREVIOUS: '上次训练没有完整完成，仅比较双方都完成的 {k} 个动作，不比较综合评分。',
})

/** Bilateral wording used when both sides of one exercise are significant. Never names a single side. */
export const SIDE_PAIR_COPY: Readonly<Record<string, { reportLabel: string; cue: string }>> = Object.freeze({
  'overhead_raise.elbow_extension': { reportLabel: '举到顶部时左右肘均未伸直', cue: '举到头顶时把两侧手肘都伸直' },
  'lateral_raise.arm_height': { reportLabel: '左右臂抬高均不足', cue: '把两侧手臂都抬到与肩同高' },
  'lateral_raise.elbow_extension': { reportLabel: '左右肘弯曲均较多', cue: '抬臂过程中两侧手臂保持伸直，手肘只微弯' },
  'knee_raise.knee_height': { reportLabel: '左右膝抬高均不足', cue: '两侧膝盖都抬到接近髋部高度' },
})

/** Cross-exercise theme wording; the exercise list is appended where it is rendered. */
export const THEME_COPY: Readonly<Record<IssueThemeId, { reportLabel: string; cue: string; issueFreeLabel: string }>> = Object.freeze({
  TORSO_STABILITY: { reportLabel: '身体侧倾或晃动', cue: '收紧核心，动作全程上身保持直立居中', issueFreeLabel: '身体侧倾或晃动' },
  ELBOW_EXTENSION: { reportLabel: '抬臂时手肘未伸直', cue: '抬臂时手臂保持伸直，不要屈肘', issueFreeLabel: '手肘未伸直' },
  ARM_SYMMETRY: { reportLabel: '双臂高度不一致', cue: '两臂同时抬起，到顶时保持同一高度', issueFreeLabel: '双臂高度不一致' },
  TEMPO_TOO_FAST: { reportLabel: '动作节奏偏快', cue: '放慢速度', issueFreeLabel: '动作节奏偏快' },
  ALTERNATION: { reportLabel: '左右顺序不交替', cue: '按左、右、左、右交替进行', issueFreeLabel: '左右顺序不交替' },
})

export function guidanceText(status: 'completed' | 'incomplete' | 'not_started'): string {
  if (status === 'completed') return '热身引导完成'
  if (status === 'incomplete') return '热身引导未完成'
  return '热身引导未开始'
}

export function seconds(ms: number): string {
  const value = ms / 1000
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** Missing TOP-phase elbow evidence must never be described as "no issue". */
export function insufficientElbowEvidenceText(evaluableReps: number, includeExerciseName = false): string {
  const prefix = includeExerciseName ? `${exerciseName('overhead_raise')}：` : ''
  return evaluableReps > 0
    ? `${prefix}手肘伸展仅有 ${evaluableReps} 次可判断，当前证据不足。`
    : `${prefix}缺少可判断的手肘伸展数据，当前证据不足。`
}
