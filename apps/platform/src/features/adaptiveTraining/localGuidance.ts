import type { ErrorCode, InterventionStrategy } from './protocol'

export const STRATEGY_LABELS: Record<InterventionStrategy, string> = {
  CONTINUE_STANDARD: '常规反馈', SWITCH_CUE: '换个提示方式',
  SHOW_DECOMPOSITION: '分解动作指导', SUGGEST_PAUSE: '建议短暂休息',
}
export const ISSUE_LABELS: Record<ErrorCode, string> = {
  ARM_TOO_LOW_L: '左臂高度不足', ARM_TOO_LOW_R: '右臂高度不足', ELBOW_TOO_BENT_L: '左手肘弯曲过多',
  ELBOW_TOO_BENT_R: '右手肘弯曲过多', ASYMMETRY: '双臂高度不一致', TORSO_LEAN: '躯干倾斜',
  TOO_FAST: '动作节奏过快', INCOMPLETE_REP: '动作未完整完成', POSE_LOW_CONFIDENCE: '姿态检测不完整',
  BODY_OUT_OF_FRAME: '身体未完整入镜', STEP_TOO_SMALL: '侧步幅度不足', ARM_TOO_LOW: '手臂高度不足',
  ARM_LEG_UNSYNCED: '手脚节奏不一致', WRONG_SIDE_SEQUENCE: '左右顺序需调整', BODY_SWAY: '身体晃动',
  INCOMPLETE_RETURN: '未完整回位', DEPTH_INSUFFICIENT: '下蹲幅度不足', KNEE_VALGUS: '膝盖向内偏移',
  LEFT_RIGHT_ASYMMETRY: '左右不均衡', TORSO_LATERAL_LEAN: '身体侧倾', KNEE_TOO_LOW_L: '左膝高度不足',
  KNEE_TOO_LOW_R: '右膝高度不足', LEFT_RIGHT_HEIGHT_GAP: '左右提膝高度不同', MOTION_TOO_SMALL: '环绕幅度不足',
  ARMS_UNSYNCED: '双臂节奏不一致', MOTION_PAUSED: '环绕动作中断', ARMS_TOO_LOW: '双臂高度不足',
}
// Reviewed local templates; the decision layer never generates training copy or movement thresholds.
const CUES: Partial<Record<ErrorCode, string>> = {
  ARM_TOO_LOW_L: '想象左手向身体左侧伸远，再平稳抬起。', ARM_TOO_LOW_R: '想象右手向身体右侧伸远，再平稳抬起。',
  ELBOW_TOO_BENT_L: '让左手与肩膀之间的距离更长，避免耸肩。', ELBOW_TOO_BENT_R: '让右手与肩膀之间的距离更长，避免耸肩。',
  ASYMMETRY: '把两只手想象放在同一条水平线上。', TOO_FAST: '跟着示范的抬起和回落节奏，慢一点再做。',
  ARM_LEG_UNSYNCED: '脚向侧面迈出时，双手一起打开；回位时一起收回。',
  ARMS_UNSYNCED: '想象两只手沿同一个时钟一起画圈。', STEP_TOO_SMALL: '先看清示范的侧步位置，再平稳迈出。',
  DEPTH_INSUFFICIENT: '想象身后有座椅，让髋部平稳向后下方移动；以舒适范围为准。',
  KNEE_TOO_LOW_L: '先稳住身体，再让左膝向前上方抬起，不用手拉。',
  KNEE_TOO_LOW_R: '先稳住身体，再让右膝向前上方抬起，不用手拉。',
  INCOMPLETE_RETURN: '先回到示范的起始站姿，再开始下一次。',
}
export function switchedCue(code?: ErrorCode): string {
  return (code && CUES[code]) || '先看示范的起始位置，只关注当前这一处调整，再平稳完成一次。'
}

// Text decomposition of existing exercises; no invented footage, generated poses or external assets.
export const ACTION_STEPS = {
  shoulder_rotation: ['放松肩颈，站稳并保持躯干居中。', '双臂同步、平稳地环绕，保持自然呼吸。', '跟随现有示范继续，避免侧倾借力。'],
  overhead_raise: ['双臂自然下垂，保持身体稳定。', '双臂同步向上抬起，手肘舒展，避免耸肩。', '平稳放回起始位置，再完成下一次。'],
  lateral_raise: ['站稳，双臂自然下垂。', '向两侧平稳抬起双臂，保持左右一致。', '缓慢回落到起始位置。'],
  step_jack: ['双脚回到中间，保持身体稳定。', '向一侧迈步，同时打开双臂。', '收回到中间，再换另一侧。'],
  squat: ['双脚约肩宽，先自然站稳。', '髋部平稳向后下沉，膝盖避免向内夹。', '在舒适范围内完整站起，再开始下一次。'],
  knee_raise: ['自然站稳，身体保持居中。', '抬起一侧膝盖，避免侧倾借力。', '完整回到中间位置，再换另一侧。'],
} as const
