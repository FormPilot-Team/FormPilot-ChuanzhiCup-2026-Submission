import type { LandmarkName } from '../pose/types'
import type {
  CustomActionBodyArea, FeatureTemplateId, PhaseThresholds, RecognitionProfile, RequirementId, SignalSource,
} from './types'

export interface BodyAreaOption {
  label: string
  hint: string
  profile: RecognitionProfile
  requirements: ReadonlyArray<RequirementId>
}

/** 训练部位: decides the camera framing and which 识别重点 are suggested first. */
export const BODY_AREAS: Readonly<Record<CustomActionBodyArea, BodyAreaOption>> = Object.freeze({
  upper: { label: '上肢', hint: '手臂、肩部为主', profile: 'upper-body', requirements: ['arms-straight', 'torso-stable', 'full-return'] },
  lower: { label: '下肢', hint: '腿部、髋部为主', profile: 'lower-body', requirements: ['knees-bent', 'torso-stable', 'full-return'] },
  full: { label: '全身', hint: '手脚一起动', profile: 'full-body', requirements: ['torso-stable', 'full-return'] },
  core: { label: '核心与躯干', hint: '弯腰、转体、卷腹', profile: 'full-body', requirements: ['full-return'] },
})

export const BODY_AREA_ORDER: ReadonlyArray<CustomActionBodyArea> = ['upper', 'lower', 'full', 'core']

export interface RequirementThreshold {
  label: string
  unit: string
  defaultValue: number
  min: number
  max: number
  step: number
}

export interface RequirementOption {
  label: string
  /** Shown under the label: what FormPilot checks, in plain words. */
  description: string
  /** Live and report feedback when it is not met. */
  feedback: string
  /** Checked at the finish pose of each repetition, or over the whole repetition. */
  timing: 'peak' | 'throughout' | 'cycle'
  threshold?: RequirementThreshold
}

export const REQUIREMENTS: Readonly<Record<RequirementId, RequirementOption>> = Object.freeze({
  'arms-straight': {
    label: '手臂保持伸直',
    description: '到位时手肘尽量伸直。',
    feedback: '手臂再伸直一些',
    timing: 'peak',
    threshold: { label: '手肘角度至少', unit: '°', defaultValue: 150, min: 110, max: 175, step: 5 },
  },
  'hands-above-shoulders': {
    label: '双手抬到肩部以上',
    description: '到位时双手都高过肩膀。',
    feedback: '双手再抬高一些，超过肩膀',
    timing: 'peak',
  },
  'knees-bent': {
    label: '膝盖弯曲到合适位置',
    description: '到位时膝盖弯到足够的角度。',
    feedback: '膝盖再弯曲一些',
    timing: 'peak',
    threshold: { label: '膝盖角度不大于', unit: '°', defaultValue: 125, min: 60, max: 165, step: 5 },
  },
  'torso-stable': {
    label: '保持躯干稳定',
    description: '整个动作中上身不明显前倾或侧倒。',
    feedback: '保持躯干稳定，上身不要晃',
    timing: 'throughout',
    threshold: { label: '躯干倾斜不超过', unit: '°', defaultValue: 20, min: 8, max: 60, step: 2 },
  },
  symmetric: {
    label: '左右两侧动作一致',
    description: '到位时左右两侧的高度或角度接近。',
    feedback: '左右两侧再一致一些',
    timing: 'peak',
    threshold: { label: '左右差不超过', unit: '°', defaultValue: 20, min: 5, max: 60, step: 5 },
  },
  'full-return': {
    label: '完成一次完整往返',
    description: '从开始姿势到完成姿势，再回到开始姿势，才算一次。',
    feedback: '回到开始姿势，再做下一次',
    timing: 'cycle',
  },
})

export const REQUIREMENT_ORDER: ReadonlyArray<RequirementId> = ['arms-straight', 'hands-above-shoulders', 'knees-bent', 'torso-stable', 'symmetric', 'full-return']

/** Advanced: the six camera regions of the workbench, in user language. */
export const PROFILE_OPTIONS: Readonly<Record<RecognitionProfile, { label: string; framing: string }>> = Object.freeze({
  'upper-body': { label: '上半身 + 髋部', framing: '上半身和髋部' },
  'hip-lateral': { label: '躯干 + 髋部 + 脚踝（侧向移动）', framing: '肩膀、髋部和脚踝' },
  'hip-rotation': { label: '上半身 + 髋部（旋转、绕环）', framing: '上半身和髋部' },
  'lower-body': { label: '躯干 + 髋部 + 膝部 + 脚踝', framing: '肩膀、髋部、膝部和脚踝' },
  'full-body': { label: '全身（手臂 + 下肢）', framing: '全身' },
  mixed: { label: '混合（可见关键部位组合）', framing: '全身' },
})

export const PROFILE_ORDER: ReadonlyArray<RecognitionProfile> = ['upper-body', 'hip-lateral', 'hip-rotation', 'lower-body', 'full-body', 'mixed']

/** Advanced: how the movement is measured. The workbench's twelve templates follow the recommended pose match. */
export const SIGNAL_SOURCE_OPTIONS: Readonly<Record<SignalSource, { label: string; description: string }>> = Object.freeze({
  'pose-match': { label: '按我的示范姿势（推荐）', description: '用你记录的开始姿势和完成姿势判断动作进行到哪里，适合大多数动作。' },
  generic: { label: '通用动作幅度', description: '按身体区域的整体移动幅度判断。' },
  'arm-raise': { label: '双臂抬举', description: '看手腕高度和手肘伸展，适合直臂上举、慢速上下。' },
  'arm-circle': { label: '手臂绕环', description: '看手腕绕肩的角度变化，绕满一圈算一次。' },
  'punch-horizontal': { label: '左右出拳', description: '看手腕向前向侧的伸展，左右交替各算一次。' },
  'squat-depth': { label: '下蹲深度', description: '看膝盖弯曲和髋部下沉。' },
  'lunge-single-leg': { label: '单侧弓步', description: '看两侧膝盖角度差和髋部下沉。' },
  'toe-raise': { label: '踮脚', description: '看脚踝相对膝部的抬起。' },
  'seated-leg-raise': { label: '坐姿抬腿', description: '看膝部相对髋部的抬起，不要求脚踝入镜。' },
  'core-flexion': { label: '躯干屈曲', description: '看上身倾斜和手肘靠近膝部，适合卷腹、前屈。' },
  'plank-shoulder-tap': { label: '平板摸肩', description: '看手腕移向对侧肩，左右交替各算一次。' },
  'mountain-climber': { label: '登山跑', description: '看膝盖沿身体方向向胸口靠近。' },
  'stretch-hold': { label: '拉伸保持', description: '进入目标姿势并保持住才算一次。' },
})

export const SIGNAL_SOURCE_ORDER: ReadonlyArray<SignalSource> = [
  'pose-match', 'generic', 'arm-raise', 'arm-circle', 'punch-horizontal', 'squat-depth', 'lunge-single-leg', 'toe-raise',
  'seated-leg-raise', 'core-flexion', 'plank-shoulder-tap', 'mountain-climber', 'stretch-hold',
]

export const FEATURE_TEMPLATE_IDS: ReadonlyArray<FeatureTemplateId> = SIGNAL_SOURCE_ORDER.filter((item): item is FeatureTemplateId => item !== 'pose-match')

/** Phase thresholds for a calibrated action: the recorded finish pose is 100 %. */
export const CALIBRATED_THRESHOLDS: Readonly<PhaseThresholds> = Object.freeze({ moving: 0.3, peak: 0.8, returnThreshold: 0.25 })

export const GOAL_LIMITS = Object.freeze({ reps: { min: 1, max: 50, defaultValue: 10 }, duration: { min: 5, max: 180, defaultValue: 30 } })

/** Phase names for the advanced view and diagnostics. */
export const PHASE_LABELS = Object.freeze({
  READY: '准备',
  MOVING: '动作中',
  PEAK: '到位',
  RETURNING: '回到起始',
  HOLDING: '保持中',
})

export const JOINT_LABEL: Readonly<Record<LandmarkName, string>> = Object.freeze({
  nose: '头部', leftShoulder: '左肩', rightShoulder: '右肩', leftElbow: '左手肘', rightElbow: '右手肘', leftWrist: '左手腕', rightWrist: '右手腕',
  leftHip: '左髋', rightHip: '右髋', leftKnee: '左膝', rightKnee: '右膝', leftAnkle: '左脚踝', rightAnkle: '右脚踝',
})
