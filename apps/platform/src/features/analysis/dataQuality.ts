import type { TrainingSessionState } from '../training/types'
import { ANALYSIS_CONFIG_V1 } from './config'
import type { ComparisonSelection, DataQuality, RepetitionQualityCounts } from './types'
import { assessRulesSupport, resolveAnalysisMode } from './rulesSupport'
import { repetitionQuality } from './repetitionValidity'

export function buildDataQuality(session: TrainingSessionState, comparison: ComparisonSelection): DataQuality {
  const rules = assessRulesSupport(session)
  const mode = resolveAnalysisMode(session)
  const reps = session.exercises.map(repetitionQuality).reduce<RepetitionQualityCounts>((total, item) => ({
    valid: total.valid + item.valid,
    partial: total.partial + item.partial,
    invalid: total.invalid + item.invalid,
    total: total.total + item.total,
  }), { valid: 0, partial: 0, invalid: 0, total: 0 })
  const missingTopElbow = session.exercises.filter((item) => item.exerciseId === 'overhead_raise').flatMap((item) => item.repetitions)
    .filter((item) => item.rep.exerciseId === 'overhead_raise' && (!Number.isFinite(item.rep.topElbowL) || !Number.isFinite(item.rep.topElbowR))).length
  const poseCodes = new Set(['POSE_LOW_CONFIDENCE', 'BODY_OUT_OF_FRAME'])
  const poseQualityEvents = session.exercises.reduce((sum, exercise) => sum
    + exercise.feedbackEvents.filter((event) => event.code && poseCodes.has(event.code)).length
    + exercise.repetitions.reduce((repSum, item) => repSum + item.errors.filter((code) => poseCodes.has(code)).length, 0), 0)
  const poseThreshold = ANALYSIS_CONFIG_V1.dataQuality.poseQualityHintMinRate
  const showEnvironmentHint = poseQualityEvents >= ANALYSIS_CONFIG_V1.dataQuality.poseQualityHintMinCount
    && poseQualityEvents * poseThreshold.denominator >= Math.max(reps.total, 1) * poseThreshold.numerator
  const notices: DataQuality['notices'] = []
  if (rules.support === 'LEGACY_UNVERSIONED') notices.push({ code: 'LEGACY_RULES', severity: 'warning', count: null, text: '该记录缺少规则版本，可做静态分析但不能用于历史比较。' })
  if (rules.support === 'UNSUPPORTED') notices.push({ code: 'UNSUPPORTED_RULES', severity: 'warning', count: null, text: '该记录的规则版本不受 analysis-v1 支持。' })
  if (mode === 'unknown') notices.push({ code: 'MODE_UNKNOWN', severity: 'warning', count: null, text: '该记录缺少训练模式，不能用于历史比较。' })
  if (mode === 'fast') notices.push({ code: 'FAST_MODE', severity: 'info', count: null, text: '快速模式记录不参与历史比较。' })
  if (session.source !== 'live') notices.push({ code: 'NON_LIVE_SOURCE', severity: 'info', count: null, text: '非实时训练记录不参与历史比较。' })
  if (reps.invalid > 0) notices.push({ code: 'INVALID_REPS', severity: 'warning', count: reps.invalid, text: '无效次数已排除，未按 0 分计入。' })
  if (missingTopElbow > 0) notices.push({ code: 'MISSING_TOP_ELBOW', severity: 'warning', count: missingTopElbow, text: '部分双臂上举缺少 TOP 肘角证据，未使用其他字段回退。' })
  if (poseQualityEvents > 0) notices.push({ code: 'POSE_QUALITY', severity: 'info', count: poseQualityEvents, text: '姿态质量事件只用于数据质量说明，未进入动作问题。' })
  notices.push({ code: 'GUIDANCE_EXCLUDED', severity: 'info', count: 1, text: '肩部环绕为引导动作，不进入计分与能力聚合。' })
  if (comparison.level !== 'FULL') notices.push({ code: 'COMPARISON_LIMITED', severity: 'info', count: null, text: comparison.level === 'PARTIAL' ? '仅比较双方共同的计分动作，不计算总分差。' : '本次没有可用的历史比较。' })
  return {
    rules, mode, source: session.source, reps, missingTopElbow, poseQualityEvents,
    environmentHint: showEnvironmentHint ? '多次出现姿态质量事件，请检查光线、镜头距离与全身入镜情况。' : null,
    guidanceExerciseIds: ['shoulder_rotation'], comparisonLimitation: comparison.unavailableReason, notices,
  }
}
