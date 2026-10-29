import type { TrainingDecisionInput, InterventionStrategy } from './protocol.ts'

export interface DecisionScenario {
  id: string
  name: string
  input: TrainingDecisionInput
  mockChoice: InterventionStrategy
  expected: InterventionStrategy
  fault?: 'failure' | 'timeout' | 'invalid'
}
export const NORMAL_INPUT: TrainingDecisionInput = {
  exerciseId: 'squat', phase: 'STANDING', trainingState: 'ACTIVE', poseValid: true, score: 90,
  errors: [], consecutiveErrors: 0, feedbackResponse: 'unknown', elapsedSeconds: 30, completion: .2,
  history: { averageScore: 88, stableSeconds: 5, completedReps: 2 },
}
const repeated: Partial<TrainingDecisionInput> = {
  errors: [{ code: 'DEPTH_INSUFFICIENT', severity: .4 }], consecutiveErrors: 3, feedbackResponse: 'not_corrected', score: 58,
}
function scenario(id: string, name: string, patch: Partial<TrainingDecisionInput>, mockChoice: InterventionStrategy, expected = mockChoice, fault?: DecisionScenario['fault']): DecisionScenario {
  return { id, name, input: { ...NORMAL_INPUT, ...patch }, mockChoice, expected, fault }
}
export const DECISION_SCENARIOS: DecisionScenario[] = [
  scenario('normal', '动作正常', {}, 'CONTINUE_STANDARD'),
  scenario('occasional', '偶发下蹲幅度不足', { ...repeated, consecutiveErrors: 1, feedbackResponse: 'unknown' }, 'CONTINUE_STANDARD'),
  scenario('switch', '两次重复错误，更换提示', { ...repeated, consecutiveErrors: 2 }, 'SWITCH_CUE'),
  scenario('decomposition', '三次重复错误，分解指导', repeated, 'SHOW_DECOMPOSITION'),
  scenario('persistent', '六次重复错误，尚未达到休息时长', { ...repeated, consecutiveErrors: 6, elapsedSeconds: 90 }, 'SHOW_DECOMPOSITION'),
  scenario('pause', '长时间未纠正，站立时建议休息', { ...repeated, consecutiveErrors: 6, elapsedSeconds: 240 }, 'SUGGEST_PAUSE'),
  scenario('recovered', '纠正后恢复正常', { feedbackResponse: 'corrected' }, 'CONTINUE_STANDARD'),
  scenario('stable', '连续稳定完成', { history: { averageScore: 96, stableSeconds: 30, completedReps: 6 }, completion: .8 }, 'CONTINUE_STANDARD'),
  scenario('completed', '训练目标已完成', { completion: 1, trainingState: 'COMPLETE' }, 'CONTINUE_STANDARD'),
  scenario('pose-missing', '关键点检测不完整', { poseValid: false, score: null, errors: [{ code: 'POSE_LOW_CONFIDENCE', severity: .5 }] }, 'SWITCH_CUE', 'CONTINUE_STANDARD'),
  scenario('out-of-frame', '身体出画', { poseValid: false, errors: [{ code: 'BODY_OUT_OF_FRAME', severity: 1 }] }, 'SHOW_DECOMPOSITION', 'CONTINUE_STANDARD'),
  scenario('paused', '用户已暂停', { ...repeated, trainingState: 'PAUSED' }, 'SWITCH_CUE', 'CONTINUE_STANDARD'),
  scenario('preparing', '训练尚未开始', { trainingState: 'PREPARING' }, 'CONTINUE_STANDARD'),
  scenario('knee-priority', '膝盖内扣，保留原纠错', { ...repeated, errors: [{ code: 'KNEE_VALGUS', severity: .3 }] }, 'SWITCH_CUE', 'CONTINUE_STANDARD'),
  scenario('severe', '高严重度纠错优先', { ...repeated, errors: [{ code: 'TORSO_LEAN', severity: .9 }] }, 'SHOW_DECOMPOSITION', 'CONTINUE_STANDARD'),
  scenario('pause-moving', '下蹲中拒绝休息干预', { ...repeated, consecutiveErrors: 6, elapsedSeconds: 240, phase: 'DESCENDING' }, 'SUGGEST_PAUSE', 'CONTINUE_STANDARD'),
  scenario('pause-early', '训练过短拒绝休息干预', { ...repeated, consecutiveErrors: 6, elapsedSeconds: 45 }, 'SUGGEST_PAUSE', 'CONTINUE_STANDARD'),
  scenario('switch-early', '一次错误拒绝过早换提示', { ...repeated, consecutiveErrors: 1 }, 'SWITCH_CUE', 'CONTINUE_STANDARD'),
  scenario('split-early', '两次错误拒绝过早分解', { ...repeated, consecutiveErrors: 2 }, 'SHOW_DECOMPOSITION', 'CONTINUE_STANDARD'),
  scenario('recovery-stale', '恢复后拒绝旧干预', { ...repeated, feedbackResponse: 'corrected' }, 'SHOW_DECOMPOSITION', 'CONTINUE_STANDARD'),
  scenario('arms', '侧平举重复左臂错误', { ...repeated, exerciseId: 'lateral_raise', phase: 'TOP', errors: [{ code: 'ARM_TOO_LOW_L', severity: .3 }], consecutiveErrors: 2 }, 'SWITCH_CUE'),
  scenario('coordination', '侧步开合协调问题', { ...repeated, exerciseId: 'step_jack', phase: 'CENTER', errors: [{ code: 'ARM_LEG_UNSYNCED', severity: .4 }] }, 'SHOW_DECOMPOSITION'),
  scenario('request-failure', '模型请求失败', repeated, 'SHOW_DECOMPOSITION', 'CONTINUE_STANDARD', 'failure'),
  scenario('request-timeout', '模型请求超时', repeated, 'SHOW_DECOMPOSITION', 'CONTINUE_STANDARD', 'timeout'),
  scenario('illegal-result', '模型返回非法策略', repeated, 'SHOW_DECOMPOSITION', 'CONTINUE_STANDARD', 'invalid'),
]

export function mockAnswer(choice: InterventionStrategy) {
  return {
    type: 'choice' as const, choice, confidence: .8,
    probabilities: { CONTINUE_STANDARD: choice === 'CONTINUE_STANDARD' ? .85 : .05,
      SWITCH_CUE: choice === 'SWITCH_CUE' ? .85 : .05,
      SHOW_DECOMPOSITION: choice === 'SHOW_DECOMPOSITION' ? .85 : .05,
      SUGGEST_PAUSE: choice === 'SUGGEST_PAUSE' ? .85 : .05 },
  }
}
