import type { EvaluationCriterion } from '../types'
import { notObservable, referenceOnly } from './define'
import { COMMON_NOT_OBSERVABLE_REASONS, poseCheck } from './routineHelpers'

// 易筋经：依据官方肩髋易犯错误分析中能看到的部分（第一势耸肩抬肘、第二势两臂不平、三盘落地下蹲不足与两膝内合外展）
const ERRORS = 'gsqc-yjj-errors'
const SHOULDER_HIP = 'gsqc-yjj-shoulder-hip-2018'
const check = poseCheck.bind(null, 'yijinjing')

const PALMS_AT_CHEST = { label: '合掌胸前', when: [{ metric: 'elbowAngleMin', max: 110 }, { metric: 'wristsAboveHead', max: -0.3 }], minSeconds: 2 } as const
const ARMS_SIDEWAYS = {
  label: '两臂侧平举',
  when: [{ metric: 'armAbduction', min: 70 }, { metric: 'armsLevelDeviation', max: 0.3 }, { metric: 'elbowAngleMin', min: 120 }],
  minSeconds: 1,
  maxSeconds: 8,
} as const
const PALMS_UP = { label: '两掌上托', when: [{ metric: 'wristsAboveHead', min: 0.4 }], minSeconds: 1, maxSeconds: 8 } as const
const SQUAT = { label: '屈膝下蹲', when: [{ metric: 'kneeAngleMean', max: 150 }], minSeconds: 1 } as const

export const YIJINJING_CRITERIA: ReadonlyArray<EvaluationCriterion> = Object.freeze([
  check({
    id: 'yjj.1.elbows_down', exercise: 'yjj-1', name: '合掌时沉肩坠肘',
    description: '合掌胸前时两臂张开角（髋—肩—肘，左右平均）。',
    requirement: '两掌内收胸前时不要耸肩抬肘。',
    sourceId: SHOULDER_HIP, additionalSourceIds: [ERRORS], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'armAbduction', aggregation: 'typical', window: PALMS_AT_CHEST,
    target: { kind: 'atMost', value: 40, zeroAt: 70, unit: '°' },
    thresholdBasis: '示范者合掌胸前时两臂张开约 22°；达标线取 40°，70° 为 0 分。',
    weight: 2,
    feedback: { issue: '合掌时抬肘', cue: '沉肩坠肘，两掌合于胸前' },
    limitations: ['“耸肩”需要肩—耳距离的个体标定，本项只检查抬肘。'],
  }),
  check({
    id: 'yjj.2.arms_level', exercise: 'yjj-2', name: '两臂侧举呈水平',
    description: '两臂侧平举时两腕偏离肩高的最大距离（以躯干长为单位）。',
    requirement: '两臂侧举应呈水平状（肩部常见错误：两臂侧举不呈水平）。',
    sourceId: SHOULDER_HIP, additionalSourceIds: [ERRORS], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'armsLevelDeviation', aggregation: 'typical', window: ARMS_SIDEWAYS,
    target: { kind: 'atMost', value: 0.2, zeroAt: 0.5, unit: '躯干长' },
    thresholdBasis: '示范者侧平举时两腕偏离肩高 0.03–0.10 个躯干长；达标线取 0.2，0.5 为 0 分。',
    weight: 3, severity: 'major',
    feedback: { issue: '两臂侧举不在水平位置', cue: '两臂侧平举，与肩同高' },
  }),
  check({
    id: 'yjj.2.elbow_extension', exercise: 'yjj-2', name: '立掌外撑、两臂伸展',
    description: '两臂侧平举时肘角（取较弯一侧）。',
    requirement: '两臂侧平举，立掌外撑。',
    sourceId: ERRORS, additionalSourceIds: [SHOULDER_HIP], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'elbowAngleMin', aggregation: 'high', window: ARMS_SIDEWAYS,
    target: { kind: 'atLeast', value: 145, zeroAt: 110, unit: '°' },
    thresholdBasis: '示范者侧平举时肘角约 153°；达标线取 145°，110° 为 0 分。',
    feedback: { issue: '侧平举时手臂弯曲', cue: '两臂向两侧伸展，立掌外撑' },
  }),
  check({
    id: 'yjj.3.lift_height', exercise: 'yjj-3', name: '两掌上托于头顶',
    description: '上托时两腕高出头部的距离（取较低一侧）。',
    requirement: '两掌上托于头顶，力达四肢。',
    sourceId: ERRORS, evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'wristsAboveHead', aggregation: 'high', window: PALMS_UP,
    target: { kind: 'atLeast', value: 0.4, zeroAt: 0.05, unit: '躯干长' },
    thresholdBasis: '示范者上托时两腕高出鼻尖约 0.62 个躯干长；达标线取 0.4，0.05 为 0 分。',
    weight: 2,
    feedback: { issue: '两掌上托不到位', cue: '两掌继续上托至头顶上方' },
  }),
  check({
    id: 'yjj.3.elbow_extension', exercise: 'yjj-3', name: '上托时避免屈肘',
    description: '上托时肘角（取较弯一侧）。',
    requirement: '上托时两臂伸展，避免屈肘。',
    sourceId: ERRORS, evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'elbowAngleMin', aggregation: 'high', window: PALMS_UP,
    target: { kind: 'atLeast', value: 145, zeroAt: 115, unit: '°' },
    thresholdBasis: '示范者上托时肘角 158–162°；达标线取 145°，115° 为 0 分。',
    weight: 2,
    feedback: { issue: '上托时屈肘', cue: '上托时两臂伸展，不要屈肘' },
  }),
  check({
    id: 'yjj.8.squat_depth', exercise: 'yjj-8', name: '逐步下蹲充分',
    description: '三盘落地每次下蹲时两膝关节角的平均值（按保持住的最低程度计）。',
    requirement: '缓慢、有阶段性屈膝，微蹲—半蹲—全蹲，避免下蹲不充分；量力而行。',
    sourceId: SHOULDER_HIP, additionalSourceIds: [ERRORS], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'kneeAngleMean', aggregation: 'low', window: SQUAT,
    target: { kind: 'atMost', value: 150, zeroAt: 172, unit: '°' },
    thresholdBasis: '示范者三次下蹲分别约 141°、133°、76°；只要求每次明显屈膝（≤150°），不要求达到示范者的全蹲深度。',
    weight: 2,
    feedback: { issue: '下蹲不充分', cue: '缓慢屈膝下蹲，量力而行' },
  }),
  check({
    id: 'yjj.8.knee_alignment', exercise: 'yjj-8', name: '两膝不过度内合或外展',
    description: '下蹲时两膝间距与两踝间距之比。',
    requirement: '下蹲时两膝不要过度内合或外展。',
    sourceId: SHOULDER_HIP, evidenceLevel: 'A', observable: 'PROXY',
    metric: 'kneeOverAnkleRatio', aggregation: 'typical', window: SQUAT,
    target: { kind: 'between', min: 0.65, max: 1.15, tolerance: 0.25, unit: '' },
    thresholdBasis: '示范者下蹲时两膝 / 两踝间距为 0.87–0.95；允许 0.65–1.15，超出 0.25 为 0 分。',
    weight: 2,
    feedback: { issue: '下蹲时两膝方向不正', cue: '两膝对准脚尖方向，不内合也不外展' },
    limitations: ['用两膝与两踝的水平间距之比近似膝的方向；脚尖朝向本身无法判断。'],
  }),
  check({
    id: 'yjj.8.torso_upright', exercise: 'yjj-8', name: '上体中正',
    description: '下蹲时躯干侧倾角。',
    requirement: '下蹲时上体不前倾，松腰裹臀。',
    sourceId: SHOULDER_HIP, evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: SQUAT,
    target: { kind: 'atMost', value: 8, zeroAt: 20, unit: '°' },
    thresholdBasis: '示范者下蹲时躯干侧倾 1–3°；达标线取 8°，20° 为 0 分。',
    feedback: { issue: '下蹲时上体倾斜', cue: '上体保持中正，松腰裹臀' },
    limitations: ['官方指出的是“上体前倾”（前后方向），正面画面只能检查左右侧倾。'],
  }),
  // 规范参考（尚未进入视觉评分）
  referenceOnly({
    id: 'yjj.4.hips_centered', mode: 'yijinjing', exercise: 'yjj-4', name: '摘星换斗：屈膝时髋部中正、扩胸展肩',
    requirement: '屈膝下蹲时保持髋关节中正，重心不移至一侧；扩胸展肩要充分，呼吸自然。', sourceId: SHOULDER_HIP,
    reason: '重心偏移可以估计，但转体动作中二维投影误差较大，需要真人数据标定；扩胸展肩无法可靠判断。',
  }),
  referenceOnly({
    id: 'yjj.5.pull_ox', mode: 'yijinjing', exercise: 'yjj-5', name: '倒拽九牛尾：用力不僵、前弓后蹬',
    requirement: '两臂屈拽用力不僵硬，用力在于两膀；俯身时不耸肩含胸，重心稳定。', sourceId: SHOULDER_HIP,
    reason: '用力状态无法判断；步型与转体需要真人标定。',
  }),
  referenceOnly({
    id: 'yjj.6.claws', mode: 'yijinjing', exercise: 'yjj-6', name: '出爪亮翅：扩胸展肩充分',
    requirement: '两掌前推如出爪，扩胸展肩要充分。', sourceId: SHOULDER_HIP,
    reason: '前推方向朝向镜头，扩胸展肩在正面画面中无法可靠判断。',
  }),
  referenceOnly({
    id: 'yjj.7.draw_sabre', mode: 'yijinjing', exercise: 'yjj-7', name: '九鬼拔马刀：身后之臂不放松、髋部中正',
    requirement: '屈膝合臂时身后之臂不要放松；屈膝下蹲时髋部中正、重心不偏移。', sourceId: SHOULDER_HIP,
    reason: '身后手臂被身体遮挡，二维画面无法可靠观察。',
  }),
  referenceOnly({
    id: 'yjj.9.dragon_claw', mode: 'yijinjing', exercise: 'yjj-9', name: '青龙探爪：身体前俯幅度适度、重心稳定',
    requirement: '屈膝下蹲时重心不偏移，身体前俯幅度不过大；下肢支撑稳定。', sourceId: SHOULDER_HIP,
    reason: '前俯属前后方向；需要真人数据标定后才能进入评分。',
  }),
  referenceOnly({
    id: 'yjj.10.tiger_pounce', mode: 'yijinjing', exercise: 'yjj-10', name: '卧虎扑食：俯身不耸肩含胸',
    requirement: '前弓后蹬，俯身时不耸肩、不含胸，骨盆适度前倾，重心稳定。', sourceId: SHOULDER_HIP,
    reason: '俯身姿态属前后方向，正面画面无法可靠判断。',
  }),
  referenceOnly({
    id: 'yjj.11.bow', mode: 'yijinjing', exercise: 'yjj-11', name: '打躬：脊柱逐节屈伸',
    requirement: '身体缓缓前屈和起身，从尾椎向上逐节伸展，颈部不僵硬。', sourceId: SHOULDER_HIP,
    reason: '脊柱逐节屈伸属前后方向，正面二维画面无法可靠判断。',
  }),
  referenceOnly({
    id: 'yjj.12.tail_swing', mode: 'yijinjing', exercise: 'yjj-12', name: '掉尾：交叉手与重心不左右移动',
    requirement: '摇头摆臀时交叉手与重心不要左右移动；脊柱屈伸顺序正确。', sourceId: SHOULDER_HIP,
    reason: '俯身摇摆时躯干朝向镜头，二维投影误差大，需要真人标定。',
  }),
  notObservable({
    id: 'yjj.all.breathing', mode: 'yijinjing', exercise: '*', name: '呼吸自然',
    requirement: '呼吸自然、柔和、流畅，不喘不滞。', sourceId: ERRORS, reason: COMMON_NOT_OBSERVABLE_REASONS.breathing,
  }),
  notObservable({
    id: 'yjj.all.force', mode: 'yijinjing', exercise: '*', name: '用力适度（力留三分）',
    requirement: '拔骨伸筋中用力不蛮不硬，刚柔相济。', sourceId: ERRORS, reason: '用力状态与肌肉张力无法从画面判断。',
  }),
  notObservable({
    id: 'yjj.all.intent', mode: 'yijinjing', exercise: '*', name: '意识专一',
    requirement: '意识专一，神与形合。', sourceId: ERRORS, reason: COMMON_NOT_OBSERVABLE_REASONS.intent,
  }),
])
