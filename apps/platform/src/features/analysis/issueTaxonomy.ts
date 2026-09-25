import type { ExerciseId, MotionErrorCode } from '../exercises/types'

export interface ReportIssueDefinition {
  exerciseId: ExerciseId
  code: MotionErrorCode
  side: 'left' | 'right' | 'bilateral' | null
  theme: string
  label: string
  cue: string
  technicalPriorityWeight: number
  pairKey: string | null
}
function issue(
  exerciseId: ExerciseId,
  code: MotionErrorCode,
  side: ReportIssueDefinition['side'],
  theme: string,
  label: string,
  cue: string,
  technicalPriorityWeight: number,
  pairKey: string | null = null,
): ReportIssueDefinition {
  return Object.freeze({ exerciseId, code, side, theme, label, cue, technicalPriorityWeight, pairKey })
}

/** Frozen report whitelist. Pose-quality, guidance and incomplete-event codes are intentionally absent. */
export const REPORT_ISSUE_TAXONOMY: readonly ReportIssueDefinition[] = Object.freeze([
  issue('overhead_raise', 'ARMS_TOO_LOW', 'bilateral', 'amplitude', '双臂上举高度不足', '双臂举到头顶上方后再平稳回落。', 1.05),
  issue('overhead_raise', 'ELBOW_TOO_BENT_L', 'left', 'elbow_extension', '左肘伸展不足', '到达顶部时让左肘自然伸展。', 1.1, 'overhead_raise:elbow_extension'),
  issue('overhead_raise', 'ELBOW_TOO_BENT_R', 'right', 'elbow_extension', '右肘伸展不足', '到达顶部时让右肘自然伸展。', 1.1, 'overhead_raise:elbow_extension'),
  issue('overhead_raise', 'ASYMMETRY', 'bilateral', 'coordination', '双臂高度不一致', '双臂同步上举并保持接近同一高度。', 1),
  issue('overhead_raise', 'TORSO_LEAN', null, 'stability', '躯干侧倾', '上举时保持躯干直立。', 1.05),
  issue('overhead_raise', 'TOO_FAST', null, 'tempo', '单次动作时长偏快', '放慢抬起与回落，让单次时长进入推荐区间。', 0.9),

  issue('lateral_raise', 'ARM_TOO_LOW_L', 'left', 'amplitude', '左臂抬高不足', '侧平举顶部让左臂到达目标高度。', 1, 'lateral_raise:arm_height'),
  issue('lateral_raise', 'ARM_TOO_LOW_R', 'right', 'amplitude', '右臂抬高不足', '侧平举顶部让右臂到达目标高度。', 1, 'lateral_raise:arm_height'),
  issue('lateral_raise', 'ELBOW_TOO_BENT_L', 'left', 'elbow_extension', '左肘伸展不足', '侧平举顶部让左肘自然伸展。', 1, 'lateral_raise:elbow_extension'),
  issue('lateral_raise', 'ELBOW_TOO_BENT_R', 'right', 'elbow_extension', '右肘伸展不足', '侧平举顶部让右肘自然伸展。', 1, 'lateral_raise:elbow_extension'),
  issue('lateral_raise', 'ASYMMETRY', 'bilateral', 'coordination', '双臂高度不一致', '两侧同时抬起并保持接近同一高度。', 1),
  issue('lateral_raise', 'TORSO_LEAN', null, 'stability', '躯干侧倾', '侧平举时保持身体直立。', 1.05),
  issue('lateral_raise', 'TOO_FAST', null, 'tempo', '单次动作时长偏快', '放慢动作，让单次时长进入推荐区间。', 0.9),

  issue('step_jack', 'STEP_TOO_SMALL', null, 'amplitude', '侧步幅度不足', '侧步打开到目标幅度后再回到中间。', 1),
  issue('step_jack', 'ARM_LEG_UNSYNCED', null, 'coordination', '手脚打开不同步', '手臂和侧步尽量同时打开。', 1.1),
  issue('step_jack', 'ARM_TOO_LOW', 'bilateral', 'amplitude', '手臂抬高不足', '打开侧步时同步抬高双臂。', 0.95),
  issue('step_jack', 'BODY_SWAY', null, 'stability', '身体晃动', '保持身体居中，控制左右晃动。', 1.05),
  issue('step_jack', 'WRONG_SIDE_SEQUENCE', null, 'coordination', '左右顺序不连续', '左右侧步交替完成。', 1),
  issue('step_jack', 'TOO_FAST', null, 'tempo', '单次动作时长偏快', '放慢动作，让单次时长进入推荐区间。', 0.9),

  issue('squat', 'DEPTH_INSUFFICIENT', null, 'amplitude', '下蹲深度不足', '保持稳定的同时到达目标下蹲深度。', 1.05),
  issue('squat', 'KNEE_VALGUS', 'bilateral', 'form', '膝盖方向需要调整', '下蹲时让膝盖方向与脚尖保持一致。', 1.15),
  issue('squat', 'LEFT_RIGHT_ASYMMETRY', 'bilateral', 'coordination', '左右动作不均衡', '下蹲时保持左右重心均衡。', 1),
  issue('squat', 'TORSO_LATERAL_LEAN', null, 'stability', '躯干侧倾', '下蹲与起身时保持身体居中。', 1.05),
  issue('squat', 'TOO_FAST', null, 'tempo', '单次动作时长偏快', '放慢下蹲与起身，让单次时长进入推荐区间。', 0.9),

  issue('knee_raise', 'KNEE_TOO_LOW_L', 'left', 'amplitude', '左侧提膝高度不足', '左侧提膝到目标高度后再回落。', 1, 'knee_raise:knee_height'),
  issue('knee_raise', 'KNEE_TOO_LOW_R', 'right', 'amplitude', '右侧提膝高度不足', '右侧提膝到目标高度后再回落。', 1, 'knee_raise:knee_height'),
  issue('knee_raise', 'WRONG_SIDE_SEQUENCE', null, 'coordination', '左右交替顺序不连续', '左右提膝交替完成。', 1.05),
  issue('knee_raise', 'BODY_SWAY', null, 'stability', '身体晃动', '提膝时保持身体居中。', 1.05),
  issue('knee_raise', 'LEFT_RIGHT_HEIGHT_GAP', 'bilateral', 'coordination', '左右提膝高度差较大', '左右两侧尽量抬到接近的高度。', 1),
  issue('knee_raise', 'TOO_FAST', null, 'tempo', '单次动作时长偏快', '放慢动作，让单次时长进入推荐区间。', 0.9),
])

export function issueDefinition(exerciseId: ExerciseId, code: MotionErrorCode): ReportIssueDefinition | null {
  return REPORT_ISSUE_TAXONOMY.find((item) => item.exerciseId === exerciseId && item.code === code) ?? null
}
