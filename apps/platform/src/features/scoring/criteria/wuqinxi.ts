import type { EvaluationCriterion } from '../types'
import { notObservable, referenceOnly } from './define'
import { COMMON_NOT_OBSERVABLE_REASONS, poseCheck } from './routineHelpers'

// 五禽戏：只有正面二维姿态能看到的要求进入自动评分，其余列为“动作规范参考，目前不进入视觉评分”
const REQUIREMENTS = 'gsqc-wqx-requirements'
const ERRORS = 'gsqc-wqx-errors'
const BASICS = 'chqa-wqx-basics-2012'
const check = poseCheck.bind(null, 'wuqinxi')

const TIGER_LIFT = { label: '虎举上举', when: [{ metric: 'wristsAboveHead', min: 0.3 }], minSeconds: 1 } as const
const BEAR_CIRCLE = { label: '熊运摇转', when: [], minSeconds: 3, maxSeconds: 8 } as const
const BIRD_FLY = { label: '鸟飞提膝独立', when: [{ metric: 'raisedKneeHeight', min: -0.45 }], minSeconds: 0.8 } as const

export const WUQINXI_CRITERIA: ReadonlyArray<EvaluationCriterion> = Object.freeze([
  // 虎举
  check({
    id: 'wqx.1.arms_overhead', exercise: 'wqx-1', name: '两掌上举到位',
    description: '虎举上举时两腕高出头部的距离（取较低一侧）。',
    requirement: '两掌撑开成虎爪，上举如托重物，举至头上方。',
    sourceId: REQUIREMENTS, additionalSourceIds: [ERRORS], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'wristsAboveHead', aggregation: 'high', window: TIGER_LIFT,
    target: { kind: 'atLeast', value: 0.35, zeroAt: 0.05, unit: '躯干长' },
    thresholdBasis: '示范者虎举上举时两腕高出鼻尖 0.53–0.56 个躯干长；达标线取 0.35，0.05 为 0 分。',
    weight: 2,
    feedback: { issue: '虎举上举不到位', cue: '两掌上举如托重物，举到头上方' },
  }),
  check({
    id: 'wqx.1.torso_upright', exercise: 'wqx-1', name: '头身正直',
    description: '虎举上举时躯干侧倾角。',
    requirement: '头身正直、尾闾中正（百会与尾闾在一条直线上）。',
    sourceId: BASICS, additionalSourceIds: [REQUIREMENTS], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: TIGER_LIFT,
    target: { kind: 'atMost', value: 8, zeroAt: 20, unit: '°' },
    thresholdBasis: '示范者虎举上举时躯干侧倾约 1–2°；达标线取 8°，20° 为 0 分。',
    feedback: { issue: '上举时身体侧倾', cue: '头身正直，尾闾中正' },
    limitations: ['“尾闾中正、不鼓腹不撅臀”的前后方向部分无法从正面画面判断。'],
  }),
  notObservable({
    id: 'wqx.1.tiger_claw', mode: 'wuqinxi', exercise: 'wqx-1', name: '虎爪手型变化',
    requirement: '掌—虎爪—拳的手型变化要清楚，不要由掌直接变拳。', sourceId: ERRORS, reason: COMMON_NOT_OBSERVABLE_REASONS.handShape,
  }),
  // 熊运
  check({
    id: 'wqx.5.hips_steady', exercise: 'wqx-5', name: '相对固定腰胯',
    description: '熊运摇转中髋中心水平位置的波动范围（第 90 与第 10 百分位之差，以髋宽为单位）。',
    requirement: '熊运以腰腹为轴摇转，腰胯相对固定，不要以腰胯为轴转动或摇晃幅度过大。',
    sourceId: BASICS, additionalSourceIds: [ERRORS], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'hipCenterX', aggregation: 'spread', window: BEAR_CIRCLE,
    target: { kind: 'atMost', value: 0.4, zeroAt: 0.9, unit: '髋宽' },
    thresholdBasis: '示范者熊运每 8 秒一段的髋中心波动为 0.14–0.36 个髋宽；达标线取 0.4，0.9 为 0 分。',
    weight: 2,
    feedback: { issue: '熊运时腰胯晃动过大', cue: '腰胯相对固定，以腰腹为轴在腹前画圆' },
  }),
  // 鸟飞
  check({
    id: 'wqx.10.knee_lift', exercise: 'wqx-10', name: '提膝独立',
    description: '鸟飞提膝时膝相对同侧髋的高度（0 = 大腿抬平）。',
    requirement: '两臂如翅起落，单腿提膝独立。',
    sourceId: REQUIREMENTS, additionalSourceIds: [ERRORS], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'raisedKneeHeight', aggregation: 'high', window: BIRD_FLY,
    target: { kind: 'atLeast', value: -0.2, zeroAt: -0.6, unit: '躯干长' },
    thresholdBasis: '示范者提膝最高处约 -0.1–0.17（大腿接近水平）；达标线取 -0.2，-0.6 为 0 分。高度量力而行。',
    weight: 2,
    feedback: { issue: '提膝高度不足', cue: '单腿提膝，大腿尽量抬平，量力而行' },
  }),
  check({
    id: 'wqx.10.balance', exercise: 'wqx-10', name: '独立平衡',
    description: '提膝独立时躯干侧倾角。',
    requirement: '单腿独立时保持平衡、重心稳定（百会上顶、收腹敛臀）。',
    sourceId: BASICS, additionalSourceIds: [REQUIREMENTS], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: BIRD_FLY,
    target: { kind: 'atMost', value: 10, zeroAt: 22, unit: '°' },
    thresholdBasis: '示范者提膝独立时躯干侧倾 3.5–5°；达标线取 10°，22° 为 0 分。',
    weight: 2,
    feedback: { issue: '独立时身体晃动', cue: '头向上顶，收腹敛臀，保持平衡' },
    limitations: ['官方基本功中“失去平衡、重心不稳”出自提踵练习，对鸟飞属同类平衡要求；只看得到左右倾斜。'],
  }),
  // 规范参考（尚未进入视觉评分）
  referenceOnly({
    id: 'wqx.2.spine_wave', mode: 'wuqinxi', exercise: 'wqx-2', name: '虎扑：躯干由屈到伸、塌腰前伸',
    requirement: '两手前伸如虎扑，躯干由屈到伸，抬头前伸、臀部后顶，不要拱腰低头。', sourceId: ERRORS, additionalSourceIds: [BASICS],
    reason: '脊柱屈伸与塌腰发生在前后方向，正面画面只能粗略估计；本轮未进入自动评分。',
  }),
  referenceOnly({
    id: 'wqx.3.deer_butt', mode: 'wuqinxi', exercise: 'wqx-3', name: '鹿抵：转腰侧屈、目视后脚跟',
    requirement: '转腰侧屈，手作鹿角向后下方抵，眼看后脚跟。', sourceId: REQUIREMENTS,
    reason: '转腰幅度可估计，但需要真人数据标定；目视方向无法判断。',
  }),
  referenceOnly({
    id: 'wqx.4.deer_run', mode: 'wuqinxi', exercise: 'wqx-4', name: '鹿奔：含胸弓背成反弓',
    requirement: '吸气时收腹、提肛敛臀、含胸鼓腰、两肩内扣，躯干形成弓形；臀部不要后翘。', sourceId: BASICS,
    reason: '反弓与敛臀属前后方向的脊柱形态，正面二维画面无法可靠判断。',
  }),
  referenceOnly({
    id: 'wqx.6.bear_sway', mode: 'wuqinxi', exercise: 'wqx-6', name: '熊晃：提髋起步、落步震足',
    requirement: '提髋起步、落步震足，身体左右晃动；膝盖与脚尖方向一致。', sourceId: REQUIREMENTS, additionalSourceIds: [BASICS],
    reason: '提髋可估计，但落步力度与脚尖方向无法判断；本轮未进入自动评分。',
  }),
  referenceOnly({
    id: 'wqx.7.ape_lift', mode: 'wuqinxi', exercise: 'wqx-7', name: '猿提：耸肩缩颈、提踵平衡',
    requirement: '耸肩缩颈、提踵收腹；提踵后保持平衡、重心稳定。', sourceId: BASICS, additionalSourceIds: [REQUIREMENTS],
    reason: '提踵高度需要站立基线标定；本轮未进入自动评分。',
  }),
  referenceOnly({
    id: 'wqx.8.ape_pick', mode: 'wuqinxi', exercise: 'wqx-8', name: '猿摘：退步摘果、后退时身体不前俯',
    requirement: '退步摘果、眼随手动；后退时身体不要前俯。', sourceId: BASICS, additionalSourceIds: [REQUIREMENTS],
    reason: '前俯属前后方向，眼随手动无法判断。',
  }),
  referenceOnly({
    id: 'wqx.9.bird_stretch', mode: 'wuqinxi', exercise: 'wqx-9', name: '鸟伸：两掌上举、身体后伸',
    requirement: '两掌上举、身体后伸，再下按并后伸一腿；躯干形成反弓。', sourceId: BASICS, additionalSourceIds: [REQUIREMENTS],
    reason: '后伸与反弓属前后方向，正面画面无法可靠判断。',
  }),
  notObservable({
    id: 'wqx.all.spirit', mode: 'wuqinxi', exercise: '*', name: '五禽神韵',
    requirement: '每一禽戏形神兼备：不仅形似，更重神似。', sourceId: REQUIREMENTS, reason: COMMON_NOT_OBSERVABLE_REASONS.intent,
  }),
  notObservable({
    id: 'wqx.all.breathing', mode: 'wuqinxi', exercise: '*', name: '呼吸配合',
    requirement: '呼吸柔和、深长细匀，与动作配合。', sourceId: BASICS, additionalSourceIds: [REQUIREMENTS], reason: COMMON_NOT_OBSERVABLE_REASONS.breathing,
  }),
  notObservable({
    id: 'wqx.all.hand_shapes', mode: 'wuqinxi', exercise: '*', name: '五禽手型',
    requirement: '虎爪、鹿角、熊掌、猿钩、鸟翅等手型规范。', sourceId: REQUIREMENTS, reason: COMMON_NOT_OBSERVABLE_REASONS.handShape,
  }),
  notObservable({
    id: 'wqx.all.knee_toe', mode: 'wuqinxi', exercise: '*', name: '步法：膝盖与脚尖方向一致',
    requirement: '迈步时膝盖和脚尖保持同一方向。', sourceId: BASICS,
    reason: '脚尖朝向在正面二维全身画面中不可靠。',
  }),
])
