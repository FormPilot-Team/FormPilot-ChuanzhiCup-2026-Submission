import type { EvaluationCriterion } from '../types'
import { defineCriterion, notObservable, referenceOnly } from './define'
import { COMMON_NOT_OBSERVABLE_REASONS, poseCheck } from './routineHelpers'

// 二十四式太极拳：只借用传统武术规则中“动作质量”与“演练水平”分开的思路，不用其扣分表。
// 虚实（真实重心分布）无法从二维画面测得，视觉估计记为 estimatedWeightShift，仅作提示
const ROUTINE = 'taiji-24-routine'
const RULES = 'cwa-traditional-rules-2012'
const RESEARCH = 'gdut-taiji-quality-2026'
const check = poseCheck.bind(null, 'taijiquan')

const UPRIGHT = { label: '立身定势', when: [{ metric: 'torsoLean', max: 6 }], minSeconds: 2, maxSeconds: 8 } as const
const BENT_STANCE = { label: '屈膝步型', when: [{ metric: 'kneeAngleMin', max: 150 }], minSeconds: 2, maxSeconds: 8 } as const
const WEIGHTED_STANCE = { label: '重心偏于一腿', when: [{ metric: 'estimatedWeightShift', min: 0.6 }, { metric: 'kneeAngleMin', max: 155 }], minSeconds: 1.5, maxSeconds: 8 } as const

export const TAIJIQUAN_CRITERIA: ReadonlyArray<EvaluationCriterion> = Object.freeze([
  check({
    id: 'tjq.all.torso_upright', exercise: '*', name: '立身中正',
    description: '示范者立身时，你的躯干侧倾角。',
    requirement: '立身中正，虚领顶劲，不前俯后仰、不左右歪斜（下势等动作除外）。',
    sourceId: ROUTINE, additionalSourceIds: [RULES, RESEARCH], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: UPRIGHT,
    target: { kind: 'atMost', value: 10, zeroAt: 25, unit: '°' },
    thresholdBasis: '示范者立身定势时躯干侧倾中位数 1.4–5°；达标线取 10°，25° 为 0 分。',
    weight: 2,
    feedback: { issue: '定势时身体歪斜', cue: '立身中正，头向上顶，不要歪斜' },
    limitations: ['只能看到左右侧倾；太极拳转体频繁，侧身时二维侧倾角误差较大。'],
  }),
  check({
    id: 'tjq.all.knees_bent', exercise: '*', name: '屈膝步型',
    description: '示范者屈膝成步型时，你较弯一侧的膝关节角（按保持住的最低程度计）。',
    requirement: '弓步、虚步等步型屈膝松胯，重心不忽高忽低；不直腿站立打拳。',
    sourceId: ROUTINE, additionalSourceIds: [RULES, RESEARCH], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'kneeAngleMin', aggregation: 'low', window: BENT_STANCE,
    target: { kind: 'atMost', value: 160, zeroAt: 176, unit: '°' },
    thresholdBasis: '示范者屈膝步型时较弯一侧膝角约 105–140°；只要求明显屈膝（≤160°），架子高低量力而行。',
    weight: 2,
    feedback: { issue: '步型时腿没有弯曲', cue: '屈膝松胯，架子高低量力而行' },
  }),
  check({
    id: 'tjq.all.weight_shift', exercise: '*', name: '虚实分明（重心转移估计）',
    description: '示范者重心明显偏于一腿时，你的髋中点偏向一侧脚的程度（estimatedWeightShift）。',
    requirement: '虚实分清：重心随步型在两腿间转换，支撑腿与虚腿分工清楚。',
    sourceId: RESEARCH, additionalSourceIds: [ROUTINE], evidenceLevel: 'B', observable: 'PROXY', scoring: 'ADVISORY',
    metric: 'estimatedWeightShift', aggregation: 'high', window: WEIGHTED_STANCE,
    target: { kind: 'atLeast', value: 0.4, zeroAt: 0.1, unit: '' },
    thresholdBasis: '示范者此时的偏移估计多在 0.6 以上；提示线取 0.4。',
    feedback: { issue: '重心转移不明显', cue: '跟着示范把重心移到支撑腿上，分清虚实' },
    limitations: ['estimatedWeightShift 是基于髋、膝、踝与身体中心投影的视觉估计，不是足底压力，不能等同于真正的“虚实”；只作提示，不计分。'],
  }),
  defineCriterion({
    id: 'tjq.all.rhythm', mode: 'taijiquan', exercise: '*', name: '演练节奏（与视频同步）',
    description: '跟练中动作与视频同步（不明显快或慢）的时间占比，来自跟练比对。',
    requirement: '演练连贯、节奏均匀、上下协调（演练水平）。',
    sourceId: RULES, additionalSourceIds: [RESEARCH], evidenceLevel: 'A', observable: 'PROXY', scoring: 'ADVISORY',
    measurement: { kind: 'follow-along', statistic: 'syncShare' },
    metric: { label: '节奏同步占比', unit: '%' }, landmarks: ['全身'],
    feedback: { issue: '节奏与视频不同步', cue: '跟随视频口令，动作与视频一起起落' },
    limitations: ['这是与标准视频的时间对齐程度，属于跟练相似度的一部分，不是独立的演练水平评分；只作参考。'],
  }),
  referenceOnly({
    id: 'tjq.all.height_steady', mode: 'taijiquan', exercise: '*', name: '重心高度平稳',
    requirement: '除下势等动作外，身体高度保持平稳，不忽高忽低。', sourceId: ROUTINE, additionalSourceIds: [RESEARCH],
    reason: '髋部高度波动可以测量，但转体与步型变化会带来投影误差，需要真人数据标定；本轮未进入自动评分。',
  }),
  notObservable({
    id: 'tjq.all.relaxed_force', mode: 'taijiquan', exercise: '*', name: '松沉与劲整',
    requirement: '沉肩坠肘、含胸拔背、以腰为轴，劲力完整。', sourceId: ROUTINE, additionalSourceIds: [RULES],
    reason: '肌肉放松程度与劲力无法从画面判断；含胸拔背属前后方向。',
  }),
  notObservable({
    id: 'tjq.all.hand_shapes', mode: 'taijiquan', exercise: '*', name: '手型（掌、拳、勾）',
    requirement: '掌、拳、勾手型规范。', sourceId: ROUTINE, reason: COMMON_NOT_OBSERVABLE_REASONS.handShape,
  }),
  notObservable({
    id: 'tjq.all.gaze', mode: 'taijiquan', exercise: '*', name: '眼神（眼随手走）',
    requirement: '眼神随主要动作的手，神态自然。', sourceId: ROUTINE, reason: COMMON_NOT_OBSERVABLE_REASONS.gaze,
  }),
  notObservable({
    id: 'tjq.all.breathing', mode: 'taijiquan', exercise: '*', name: '呼吸自然',
    requirement: '呼吸自然，与动作开合相配合。', sourceId: ROUTINE, reason: COMMON_NOT_OBSERVABLE_REASONS.breathing,
  }),
])
