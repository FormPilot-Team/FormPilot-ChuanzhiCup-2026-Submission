import type { ExerciseId, MotionErrorCode } from '../exercises/types'
import type { ReportCapabilityDimension } from './types'

export interface ReportExercisePresentation {
  name: string
  metricKeys: ReadonlyArray<{ key: string; label: string }>
}

export const REPORT_COURSE_NAME = 'AI 电子教练 · 全身训练'

export const REPORT_EXERCISE_PRESENTATION: Record<ExerciseId, ReportExercisePresentation> = {
  shoulder_rotation: { name: '肩部环绕', metricKeys: [] },
  overhead_raise: { name: '双臂上举', metricKeys: [
    { key: 'amplitude', label: '幅度' }, { key: 'elbow', label: '肘部伸展' },
    { key: 'synchronization', label: '双臂同步' }, { key: 'stability', label: '稳定性' }, { key: 'tempo', label: '节奏' },
  ] },
  lateral_raise: { name: '侧平举', metricKeys: [
    { key: 'amplitude', label: '幅度' }, { key: 'symmetry', label: '对称性' },
    { key: 'stability', label: '稳定性' }, { key: 'tempo', label: '节奏' }, { key: 'completion', label: '完成质量' },
  ] },
  step_jack: { name: '侧步开合', metricKeys: [
    { key: 'coordination', label: '协调性' }, { key: 'amplitude', label: '幅度' },
    { key: 'tempo', label: '节奏' }, { key: 'stability', label: '稳定性' }, { key: 'completion', label: '完成度' },
  ] },
  squat: { name: '徒手深蹲', metricKeys: [
    { key: 'amplitude', label: '深度' }, { key: 'stability', label: '稳定性' },
    { key: 'symmetry', label: '对称性' }, { key: 'completion', label: '完成度' }, { key: 'tempo', label: '节奏' },
  ] },
  knee_raise: { name: '交替提膝', metricKeys: [
    { key: 'amplitude', label: '幅度' }, { key: 'stability', label: '稳定性' },
    { key: 'alternation', label: '左右交替' }, { key: 'symmetry', label: '对称性' }, { key: 'tempo', label: '节奏' },
  ] },
}

export const CAPABILITY_LABELS: Record<ReportCapabilityDimension, string> = {
  AMPLITUDE: '动作幅度',
  STABILITY: '稳定性',
  COORDINATION: '协调 / 对称',
  TEMPO: '节奏',
  CONTROL: '完整控制',
}

export const REPORT_ISSUE_LABELS: Partial<Record<MotionErrorCode, string>> = {
  ARM_TOO_LOW_L: '左臂抬高不足', ARM_TOO_LOW_R: '右臂抬高不足', ARM_TOO_LOW: '手臂抬高不足', ARMS_TOO_LOW: '双臂上举高度不足',
  ELBOW_TOO_BENT_L: '左肘弯曲较多', ELBOW_TOO_BENT_R: '右肘弯曲较多', ASYMMETRY: '双臂高度不一致', TORSO_LEAN: '身体出现侧倾',
  STEP_TOO_SMALL: '侧步幅度不足', ARM_LEG_UNSYNCED: '手脚不同步', WRONG_SIDE_SEQUENCE: '左右顺序需要调整', BODY_SWAY: '动作中身体晃动',
  INCOMPLETE_RETURN: '未完整回到中间位置', DEPTH_INSUFFICIENT: '下蹲深度不足', KNEE_VALGUS: '膝盖方向需要调整',
  LEFT_RIGHT_ASYMMETRY: '左右动作不均衡', TORSO_LATERAL_LEAN: '身体出现侧倾', INCOMPLETE_REP: '动作未完整完成',
  KNEE_TOO_LOW_L: '左侧提膝高度不足', KNEE_TOO_LOW_R: '右侧提膝高度不足', LEFT_RIGHT_HEIGHT_GAP: '左右提膝高度差较大',
  MOTION_TOO_SMALL: '动作幅度不足', ARMS_UNSYNCED: '双臂环绕不同步', MOTION_PAUSED: '动作连续性不足', TOO_FAST: '动作节奏偏快',
  POSE_LOW_CONFIDENCE: '姿态识别置信度不足', BODY_OUT_OF_FRAME: '身体未完整入镜',
}

export function scorePresentation(score: number | null): { label: string; description: string } {
  if (score === null) return { label: '暂无评分', description: '当前没有足够的已保存计分结果。' }
  if (score >= 90) return { label: '表现稳定', description: '基于本次已保存的动作评分。' }
  if (score >= 75) return { label: '整体良好', description: '基于本次已保存的动作评分。' }
  if (score >= 60) return { label: '还有提升空间', description: '建议结合本次纠错记录复盘。' }
  return { label: '建议关注动作反馈', description: '可以放慢动作并优先处理已记录的问题。' }
}
