import type { EvaluationCriterion } from '../types'
import { notObservable, referenceOnly } from './define'
import { COMMON_NOT_OBSERVABLE_REASONS, poseCheck } from './routineHelpers'

// 八段锦：把官方《健身气功•八段锦习惯性错误及纠正方法》中正面二维姿态能看到的部分转为摄像头检查。
// 阶段窗口取自标准视频的姿态轨迹；阈值参照示范者的数值暂定，不是官方数值
const ERRORS = 'gsqc-bdj-errors-2018'
const STANDARD = 'tcacm-1676-2026-baduanjin'
const check = poseCheck.bind(null, 'baduanjin')

const TOP = { label: '托举顶点', when: [{ metric: 'wristsAboveHead', min: 0.45 }, { metric: 'armAbduction', min: 160 }], minSeconds: 1 } as const
const BOW = {
  label: '开弓定势',
  when: [{ metric: 'kneeAngleMean', max: 150 }, { metric: 'stanceWidth', min: 2.2 }, { metric: 'elbowAngleMax', min: 130 }, { metric: 'armsLevelDeviation', max: 0.35 }],
  minSeconds: 1,
} as const
const SINGLE_RAISE = { label: '单举定势', when: [{ metric: 'raisedWristAboveShoulder', min: 0.7 }, { metric: 'loweredWristBelowShoulder', min: 0.6 }], minSeconds: 1 } as const
const LOOK_BACK = { label: '转头后瞧', when: [{ metric: 'armAbduction', min: 30, max: 70 }, { metric: 'headTurn', min: 0.2 }], minSeconds: 0.8 } as const
const HORSE_5 = { label: '马步摇摆', when: [{ metric: 'kneeAngleMean', max: 155 }, { metric: 'stanceWidth', min: 2.2 }], minSeconds: 2, maxSeconds: 8 } as const
const BEND_REACH = { label: '俯身前伸（帖耳起身前）', when: [{ metric: 'armAbduction', min: 155 }, { metric: 'wristsAboveHead', max: -0.3 }], minSeconds: 1 } as const
const RISEN = { label: '起身两臂上举', when: [{ metric: 'wristsAboveHead', min: 0.45 }], minSeconds: 1 } as const
const HORSE_7 = { label: '马步冲拳', when: [{ metric: 'kneeAngleMean', max: 155 }, { metric: 'stanceWidth', min: 2.2 }], minSeconds: 2, maxSeconds: 8 } as const
const HEEL_RAISE = { label: '提踵颠足', when: [{ metric: 'stanceWidth', max: 1.2 }, { metric: 'kneeAngleMean', min: 165 }], minSeconds: 2, maxSeconds: 8 } as const

export const BADUANJIN_CRITERIA: ReadonlyArray<EvaluationCriterion> = Object.freeze([
  // 第一式 两手托天理三焦
  check({
    id: 'bdj.1.elbow_extension', exercise: 'bdj-1', name: '双臂伸直上托',
    description: '托举顶点时两侧肘角（取较弯一侧），按每次托举中保持住的伸展程度计。',
    requirement: '上举要充分，两臂伸直：抬头看手上举时两肘慢慢伸直，两臂继续伸直上托（习惯性错误三：上举不充分，两臂未伸直）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'elbowAngleMin', aggregation: 'high', window: TOP,
    target: { kind: 'atLeast', value: 150, zeroAt: 120, unit: '°' },
    thresholdBasis: '示范者 6 次托举顶点的肘角中位数为 154–158°（较弯一侧）；达标线取 150°，120° 及以下为 0 分。',
    weight: 3, severity: 'major',
    feedback: { issue: '托举顶部两肘未伸直', cue: '抬头看手上举时，两肘慢慢伸直，两臂继续伸直上托' },
    limitations: ['二维画面中，掌心翻转上托时前臂会有透视缩短，完全伸直的手臂也可能测得 155–170°，因此达标线低于 180°。'],
  }),
  check({
    id: 'bdj.1.lift_height', exercise: 'bdj-1', name: '上举充分',
    description: '托举顶点时两腕高出头部的距离（以躯干长为单位，取较低一侧）。',
    requirement: '两掌沿身前垂线直线上举，上举充分，两掌后移至头顶正上方（习惯性错误二、三）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'wristsAboveHead', aggregation: 'high', window: TOP,
    target: { kind: 'atLeast', value: 0.45, zeroAt: 0.1, unit: '躯干长' },
    thresholdBasis: '示范者托举顶点两腕高出鼻尖 0.62–0.67 个躯干长；达标线取 0.45，0.1 及以下为 0 分。',
    weight: 3, severity: 'major',
    feedback: { issue: '托举不够充分', cue: '两掌继续上托，移至头顶正上方' },
    limitations: ['两臂前倾过大（习惯性错误二）发生在前后方向，正面画面只能通过手腕高度降低间接反映。'],
  }),
  check({
    id: 'bdj.1.arms_by_ears', exercise: 'bdj-1', name: '两臂帖耳',
    description: '托举顶点时上臂偏离竖直方向的角度（取较外展一侧）。',
    requirement: '两掌后移至头顶正上方，两臂帖耳（习惯性错误三的纠正方法）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'upperArmFromVertical', aggregation: 'typical', window: TOP,
    target: { kind: 'atMost', value: 15, zeroAt: 40, unit: '°' },
    thresholdBasis: '示范者托举顶点上臂偏离竖直 3–7°；达标线取 15°，40° 为 0 分。',
    weight: 2,
    feedback: { issue: '托举时两臂向外张开', cue: '两臂向耳侧收拢，掌在头顶正上方' },
  }),
  check({
    id: 'bdj.1.symmetry', exercise: 'bdj-1', name: '左右一致',
    description: '托举顶点时左右肩关节角之差。',
    requirement: '两掌同时上托，左右一致。',
    sourceId: 'fp-reference-demo', additionalSourceIds: [STANDARD], evidenceLevel: 'C', observable: 'OBSERVABLE',
    metric: 'shoulderAngleGap', aggregation: 'typical', window: TOP,
    target: { kind: 'atMost', value: 10, zeroAt: 30, unit: '°' },
    thresholdBasis: '示范者托举顶点左右肩角差 1–3°；达标线取 10°，30° 为 0 分。',
    feedback: { issue: '托举时两臂高低不一', cue: '两掌同时上托，左右保持一致' },
    limitations: ['习惯性错误中没有单列左右不一致，本项依据示范动作本身（证据等级 C）。'],
  }),
  check({
    id: 'bdj.1.torso_upright', exercise: 'bdj-1', name: '身体中正',
    description: '托举顶点时躯干（肩中点—髋中点）的侧倾角。',
    requirement: '立身中正，上托时不侧倾。',
    sourceId: STANDARD, evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: TOP,
    target: { kind: 'atMost', value: 8, zeroAt: 20, unit: '°' },
    thresholdBasis: '示范者托举顶点躯干侧倾 1–2°；达标线取 8°，20° 为 0 分。',
    feedback: { issue: '托举时身体侧倾', cue: '头正身直，上托时身体保持中正' },
    limitations: ['只看得到左右侧倾，看不到前俯后仰。'],
  }),
  check({
    id: 'bdj.1.phase_completion', exercise: 'bdj-1', name: '托举完成（动作阶段）',
    description: '示范每一次托举时，你是否也把两掌托到了头顶以上。',
    requirement: '随口令完成每一次上托—下落，动作连贯，不遗漏。',
    sourceId: 'fp-reference-demo', additionalSourceIds: [STANDARD, 'sjtu-rehab-segmentation-2023'], evidenceLevel: 'C', observable: 'OBSERVABLE',
    metric: 'wristsAboveHead', aggregation: 'high', window: TOP,
    target: { kind: 'atLeast', value: 0.2, zeroAt: 0.19, unit: '躯干长' },
    thresholdBasis: '两腕高出头部 0.2 个躯干长即算完成这一次托举（按次计完成率）。',
    feedback: { issue: '有几次托举没有跟上', cue: '跟着口令完成每一次上托和下落' },
    limitations: ['本轮只检查动作阶段是否出现（轻量版连贯性），不评估轨迹平滑度；DTW 时序对齐留作后续升级（temporalAlignmentScore）。'],
  }),
  notObservable({
    id: 'bdj.1.head_follows_hands', mode: 'baduanjin', exercise: 'bdj-1', name: '眼随手走，先托后抬头',
    requirement: '两手托至胸高时目视两掌，眼随手走，不要先抬头后上举（习惯性错误一）。', sourceId: ERRORS,
    reason: '目视方向和抬头时机需要面部朝向的精细估计，正面二维姿态无法可靠判断。',
  }),
  referenceOnly({
    id: 'bdj.1.separate_hands', mode: 'baduanjin', exercise: 'bdj-1', name: '分手不猛拉',
    requirement: '分手前先松肩、微屈肘，然后坐腕撑开十指，两掌不要猛力拉开（习惯性错误四）。', sourceId: ERRORS,
    reason: '可以用手腕速度估计“猛拉”，但需要真人数据标定速度阈值；本轮未进入自动评分。',
  }),

  // 第二式 左右开弓似射雕
  check({
    id: 'bdj.2.horse_stance', exercise: 'bdj-2', name: '屈膝成马步',
    description: '开弓定势时两膝关节角的平均值（按保持住的最低程度计）。',
    requirement: '正身屈膝下蹲成正马步（习惯性错误三的纠正方法）；马步高低量力而行。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'kneeAngleMean', aggregation: 'low', window: BOW,
    target: { kind: 'atMost', value: 155, zeroAt: 172, unit: '°' },
    thresholdBasis: '示范者开弓定势膝角 128–135°；只要求明显屈膝（≤155°），不奖励更低的马步。',
    weight: 2,
    feedback: { issue: '开弓时没有屈膝下蹲成马步', cue: '正身屈膝下蹲成马步，高度量力而行' },
  }),
  check({
    id: 'bdj.2.centered_weight', exercise: 'bdj-2', name: '重心居中（不偏马步）',
    description: '髋中点偏离两踝中点的程度（0 = 正中，1 = 移到一侧脚上方），为重心转移的视觉估计。',
    requirement: '防止重心向拉弓手一侧移动，不要成偏马步（习惯性错误三）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'estimatedWeightShift', aggregation: 'typical', window: BOW,
    target: { kind: 'atMost', value: 0.3, zeroAt: 0.7, unit: '' },
    thresholdBasis: '示范者开弓定势偏移 0.04–0.12；达标线取 0.3，0.7 为 0 分。',
    weight: 2,
    feedback: { issue: '开弓时重心偏向一侧', cue: '重心保持在两脚中间，正马步不偏' },
    limitations: ['基于髋部与两踝的投影估计，不是真实足底压力。'],
  }),
  check({
    id: 'bdj.2.arms_level', exercise: 'bdj-2', name: '推弓手与拉弓手同高',
    description: '开弓定势时两腕高度差（以躯干长为单位）。',
    requirement: '避免推弓手高、拉弓手低（习惯性错误三），两手约与肩同高。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'wristHeightGap', aggregation: 'typical', window: BOW,
    target: { kind: 'atMost', value: 0.2, zeroAt: 0.5, unit: '躯干长' },
    thresholdBasis: '示范者开弓定势两腕高度差 0.01–0.09；达标线取 0.2，0.5 为 0 分。',
    weight: 2,
    feedback: { issue: '推弓手与拉弓手高低不一', cue: '推弓手与拉弓手保持同高，约与肩平' },
  }),
  check({
    id: 'bdj.2.torso_upright', exercise: 'bdj-2', name: '正身',
    description: '开弓定势时躯干侧倾角。',
    requirement: '正身屈膝下蹲，上体不侧倾（习惯性错误三的纠正方法）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: BOW,
    target: { kind: 'atMost', value: 12, zeroAt: 25, unit: '°' },
    thresholdBasis: '示范者开弓定势躯干侧倾 1–9°；达标线取 12°，25° 为 0 分。',
    feedback: { issue: '开弓时上体侧倾', cue: '上体保持正直，不要向一侧倾斜' },
  }),
  notObservable({
    id: 'bdj.2.hand_shape', mode: 'baduanjin', exercise: 'bdj-2', name: '八字掌与拉弓爪手型',
    requirement: '八字掌与拉弓爪的指节屈伸要正确（习惯性错误二）。', sourceId: ERRORS, reason: COMMON_NOT_OBSERVABLE_REASONS.handShape,
  }),
  referenceOnly({
    id: 'bdj.2.pull_hand_path', mode: 'baduanjin', exercise: 'bdj-2', name: '拉弓手打开路线',
    requirement: '拉弓手以肘为轴先向上摆、指尖过头，再向侧落至肩高，不要向前划平弧（习惯性错误四）。', sourceId: ERRORS,
    reason: '需要轨迹级别的比较，本轮只做定势检查。',
  }),

  // 第三式 调理脾胃须单举
  check({
    id: 'bdj.3.upper_hand_height', exercise: 'bdj-3', name: '上举手撑举到位',
    description: '单举定势时上举手腕高出同侧肩的距离（以躯干长为单位）。',
    requirement: '上举时努力展肩，使手撑举到规范位置（习惯性错误一的纠正方法）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'raisedWristAboveShoulder', aggregation: 'high', window: SINGLE_RAISE,
    target: { kind: 'atLeast', value: 0.65, zeroAt: 0.3, unit: '躯干长' },
    thresholdBasis: '示范者上举手高出肩 0.83–0.90 个躯干长；达标线取 0.65，0.3 为 0 分。',
    weight: 3, severity: 'major',
    feedback: { issue: '上举手没有撑举到位', cue: '努力展肩，上举手撑到头侧上方' },
  }),
  check({
    id: 'bdj.3.upper_hand_position', exercise: 'bdj-3', name: '上举手不偏侧',
    description: '上举手腕相对同侧肩的水平偏离（以肩宽为单位，正值为向外）。',
    requirement: '上举的手不要偏前或偏侧，上手中指的垂线落在肩井穴（习惯性错误一）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'raisedWristLateralOffset', aggregation: 'typical', window: SINGLE_RAISE,
    target: { kind: 'between', min: -0.3, max: 0.55, tolerance: 0.45, unit: '肩宽' },
    thresholdBasis: '示范者上举手向外偏 0.18–0.32 个肩宽；允许 -0.3–0.55，超出 0.45 个肩宽为 0 分。',
    weight: 2,
    feedback: { issue: '上举手偏向外侧', cue: '上举手撑在肩的正上方，不要偏向外侧' },
    limitations: ['“偏前”发生在前后方向，正面画面无法判断，只检查左右偏侧。'],
  }),
  check({
    id: 'bdj.3.lower_hand_press', exercise: 'bdj-3', name: '下按手按至胯旁',
    description: '单举定势时下按手腕低于同侧肩的距离。',
    requirement: '一掌上托、一掌下按，上下对拉拔长。',
    sourceId: STANDARD, evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'loweredWristBelowShoulder', aggregation: 'high', window: SINGLE_RAISE,
    target: { kind: 'atLeast', value: 0.55, zeroAt: 0.2, unit: '躯干长' },
    thresholdBasis: '示范者下按手低于肩 0.78–0.82 个躯干长；达标线取 0.55，0.2 为 0 分。',
    weight: 2,
    feedback: { issue: '下按手没有按到位', cue: '另一掌向下按至胯旁，上下对拉' },
  }),
  check({
    id: 'bdj.3.torso_upright', exercise: 'bdj-3', name: '身体中正',
    description: '单举定势时躯干侧倾角。',
    requirement: '上举时身体保持中正（习惯性错误二的纠正方法）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: SINGLE_RAISE,
    target: { kind: 'atMost', value: 8, zeroAt: 20, unit: '°' },
    thresholdBasis: '示范者单举定势躯干侧倾 1–4°；达标线取 8°，20° 为 0 分。',
    feedback: { issue: '单举时身体侧倾', cue: '身体保持中正，靠展肩把手撑上去' },
  }),
  notObservable({
    id: 'bdj.3.palm_flat', mode: 'baduanjin', exercise: 'bdj-3', name: '手臂内旋、掌心平托',
    requirement: '上举手臂充分内旋、肘部微屈、坐腕使手掌放平，掌心不要朝前上方（习惯性错误二）。', sourceId: ERRORS,
    reason: '手臂旋转与掌心朝向需要手部与前臂旋转的细节，二维全身关键点无法可靠判断。',
  }),
  referenceOnly({
    id: 'bdj.3.midline_path', mode: 'baduanjin', exercise: 'bdj-3', name: '中指尖路线不过中线',
    requirement: '上举时手领先于肘上穿至面前，中指尖经过而不超过身前中心线（习惯性错误三）。', sourceId: ERRORS,
    reason: '需要手指尖轨迹，本轮只做定势检查。',
  }),

  // 第四式 五劳七伤往后瞧
  check({
    id: 'bdj.4.head_turn', exercise: 'bdj-4', name: '转头后瞧',
    description: '后瞧时鼻尖偏离两肩中点的距离（以肩宽为单位）。',
    requirement: '两臂外旋，头向后转、目视后方，躯干保持正直。',
    sourceId: STANDARD, additionalSourceIds: [ERRORS], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'headTurn', aggregation: 'high', window: LOOK_BACK,
    target: { kind: 'atLeast', value: 0.18, zeroAt: 0.05, unit: '肩宽' },
    thresholdBasis: '示范者后瞧时鼻尖偏离 0.31–0.40 个肩宽；达标线取 0.18，0.05 为 0 分。',
    weight: 2,
    feedback: { issue: '转头幅度不足', cue: '头向后转，目视后方，身体不动' },
    limitations: ['二维画面用鼻尖水平偏移估计转头幅度，无法得到真实转头角度。'],
  }),
  check({
    id: 'bdj.4.arm_opening', exercise: 'bdj-4', name: '两臂稍侧开（约 45°）',
    description: '后瞧时两臂张开角（髋—肩—肘，左右平均）。',
    requirement: '两臂稍侧开，与垂线夹角约 45°（习惯性错误一的纠正方法）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'armAbduction', aggregation: 'typical', window: LOOK_BACK,
    target: { kind: 'between', min: 35, max: 70, tolerance: 20, unit: '°' },
    thresholdBasis: '官方给出“约 45°”；示范者在二维画面中测得 52–58°（肩—肘相对躯干），因此取 35–70°，超出 20° 为 0 分。',
    weight: 2,
    feedback: { issue: '两臂张开角度不合适', cue: '两臂稍侧开，与身体约成 45°' },
  }),
  check({
    id: 'bdj.4.eyes_level', exercise: 'bdj-4', name: '两眼保持水平',
    description: '后瞧时两眼连线的倾斜角。',
    requirement: '转头时收颏顶悬，两眼保持在同一水平线上，不撅下颏（习惯性错误二）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY', scoring: 'ADVISORY',
    metric: 'eyeLineTilt', aggregation: 'typical', window: LOOK_BACK,
    target: { kind: 'atMost', value: 10, zeroAt: 25, unit: '°' },
    thresholdBasis: '示范者后瞧时两眼连线倾斜 0–5°；提示线取 10°。',
    feedback: { issue: '转头时头部歪斜', cue: '收颏顶悬，两眼保持水平往后瞧' },
    limitations: ['眼部关键点在全身画面中很小，噪声较大，只作提示，不计分。', '撅下颏、身体后仰属前后方向动作，正面画面无法判断。'],
  }),
  check({
    id: 'bdj.4.torso_upright', exercise: 'bdj-4', name: '躯干正直',
    description: '后瞧时躯干侧倾角。',
    requirement: '转头时躯干保持正直，不随头转动而倾斜或后仰（习惯性错误二）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: LOOK_BACK,
    target: { kind: 'atMost', value: 8, zeroAt: 20, unit: '°' },
    thresholdBasis: '示范者后瞧时躯干侧倾 1–3°；达标线取 8°，20° 为 0 分。',
    feedback: { issue: '转头时身体跟着倾斜', cue: '只转头，躯干保持正直' },
    limitations: ['后仰发生在前后方向，只能检查左右侧倾。'],
  }),
  notObservable({
    id: 'bdj.4.arm_rotation', mode: 'baduanjin', exercise: 'bdj-4', name: '旋臂充分',
    requirement: '以中指为轴直臂充分外旋，使掌心向侧斜上方（习惯性错误一）。', sourceId: ERRORS,
    reason: '手臂旋转与掌心朝向无法从二维全身关键点可靠判断。',
  }),

  // 第五式 摇头摆尾去心火
  check({
    id: 'bdj.5.horse_stance', exercise: 'bdj-5', name: '马步蹲坐',
    description: '马步阶段两膝关节角的平均值。',
    requirement: '马步蹲坐，摇摆中臀部高度不变（习惯性错误二的纠正方法）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'kneeAngleMean', aggregation: 'typical', window: HORSE_5,
    target: { kind: 'atMost', value: 158, zeroAt: 172, unit: '°' },
    thresholdBasis: '示范者马步阶段膝角 130–146°；只要求明显屈膝（≤158°），不奖励更低。',
    weight: 2,
    feedback: { issue: '摇摆时没有保持马步', cue: '保持马步蹲坐，高度量力而行' },
  }),
  check({
    id: 'bdj.5.head_above_hips', exercise: 'bdj-5', name: '俯身不过大',
    description: '摇摆中头部高出髋部的距离（按摇摆到最低处计）。',
    requirement: '俯身约 45°，不要俯身过大、撅臀，使头尾在同一水平摇摆（习惯性错误二）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'headAboveHips', aggregation: 'low', window: HORSE_5,
    target: { kind: 'atLeast', value: 0.45, zeroAt: 0.1, unit: '躯干长' },
    thresholdBasis: '示范者摇摆最低处头部仍高出髋部 0.66 个躯干长以上；达标线取 0.45，0.1（头尾接近同一水平）为 0 分。',
    weight: 2,
    feedback: { issue: '俯身过大，头部接近髋部高度', cue: '俯身约 45°即可，头不要低到与臀同高' },
    limitations: ['俯身角度在正面画面中只能通过头与髋的高度差间接估计。'],
  }),
  referenceOnly({
    id: 'bdj.5.hip_height_steady', mode: 'baduanjin', exercise: 'bdj-5', name: '臀部高度不变',
    requirement: '马步摇摆时臀部高度不变（习惯性错误二的纠正方法）。', sourceId: ERRORS,
    reason: '曾尝试用髋部离地高度的波动判断，但示范者本身在各段摇摆中波动 0.2–0.6 个躯干长（上体侧倾改变了髋部在画面中的投影），二维指标无法把“臀部起伏”与正常摇摆区分开，因此不进入评分。',
  }),
  notObservable({
    id: 'bdj.5.neck_waist_relaxed', mode: 'baduanjin', exercise: 'bdj-5', name: '颈腰放松、摇头摆尾',
    requirement: '摇摆时颈部、腰部充分放松，头尾以丹田为轴各摇摆约 270°，不要只摇身晃肩（习惯性错误三、四）。', sourceId: ERRORS,
    reason: '颈腰的放松程度与头尾绕轴的三维摆动无法从正面二维姿态可靠判断。',
  }),
  notObservable({
    id: 'bdj.5.eyes_on_foot', mode: 'baduanjin', exercise: 'bdj-5', name: '眼看俯身侧的脚',
    requirement: '俯身后身体向另一侧旋转时，眼睛经鼻尖方向看到俯身侧的脚（习惯性错误五）。', sourceId: ERRORS,
    reason: COMMON_NOT_OBSERVABLE_REASONS.gaze,
  }),

  // 第六式 两手攀足固肾腰
  check({
    id: 'bdj.6.arms_lead_rise', exercise: 'bdj-6', name: '以臂带身、帖耳起身',
    description: '俯身前伸到起身阶段，两臂与躯干的夹角（髋—肩—肘，左右平均）。',
    requirement: '两手沿地面前伸至两臂帖耳，然后以臂带身、帖耳起身；不要起身在先、举臂在后（习惯性错误三）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'armAbduction', aggregation: 'typical', window: BEND_REACH,
    target: { kind: 'atLeast', value: 150, zeroAt: 100, unit: '°' },
    thresholdBasis: '示范者俯身前伸时臂与躯干夹角 171–176°；达标线取 150°，100° 为 0 分。',
    weight: 3, severity: 'major',
    feedback: { issue: '起身时两臂没有带领上体', cue: '两臂先前伸帖耳，再以臂带身起身' },
    limitations: ['俯身时躯干朝向镜头，二维角度有透视误差，本项按示范数据留出较大余量。'],
  }),
  check({
    id: 'bdj.6.arms_up_after_rise', exercise: 'bdj-6', name: '起身后两臂上举',
    description: '起身后两腕高出头部的距离。',
    requirement: '以臂带身起身，起身后两臂上举。',
    sourceId: STANDARD, additionalSourceIds: [ERRORS], evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'wristsAboveHead', aggregation: 'high', window: RISEN,
    target: { kind: 'atLeast', value: 0.4, zeroAt: 0.05, unit: '躯干长' },
    thresholdBasis: '示范者起身后两腕高出鼻尖 0.59–0.66 个躯干长；达标线取 0.4，0.05 为 0 分。',
    feedback: { issue: '起身后两臂没有举起', cue: '起身后两臂随身体上举' },
  }),
  notObservable({
    id: 'bdj.6.no_head_drop', mode: 'baduanjin', exercise: 'bdj-6', name: '摩运时不低头',
    requirement: '两掌沿脊柱两侧向下摩运至臀部时，保持上体正直，向前平视（习惯性错误二）。', sourceId: ERRORS,
    reason: '低头属前后方向的颈部动作，正面画面无法可靠判断。',
  }),
  referenceOnly({
    id: 'bdj.6.armpit_insert', mode: 'baduanjin', exercise: 'bdj-6', name: '两手后插位置（手低肘高）',
    requirement: '两掌下按于胸前转掌心向上时手低肘高，两肘近似与肩平，两手经腋下后插位置不过高（习惯性错误一）。', sourceId: ERRORS,
    reason: '该过渡阶段在示范姿态中难以稳定切分，本轮未进入自动评分。',
  }),

  // 第七式 攒拳怒目增气力
  check({
    id: 'bdj.7.horse_stance', exercise: 'bdj-7', name: '马步稳定',
    description: '冲拳阶段两膝关节角的平均值。',
    requirement: '马步冲拳，下盘稳定。',
    sourceId: STANDARD, evidenceLevel: 'A', observable: 'OBSERVABLE',
    metric: 'kneeAngleMean', aggregation: 'typical', window: HORSE_7,
    target: { kind: 'atMost', value: 158, zeroAt: 172, unit: '°' },
    thresholdBasis: '示范者冲拳阶段膝角约 145°；只要求明显屈膝（≤158°），不奖励更低。',
    weight: 2,
    feedback: { issue: '冲拳时没有保持马步', cue: '保持马步，下盘稳定' },
  }),
  check({
    id: 'bdj.7.centered_weight', exercise: 'bdj-7', name: '重心居中',
    description: '冲拳阶段髋中点偏离两踝中点的程度（重心转移的视觉估计）。',
    requirement: '左右冲拳时重心保持在两脚之间。',
    sourceId: 'fp-reference-demo', additionalSourceIds: [STANDARD], evidenceLevel: 'C', observable: 'PROXY',
    metric: 'estimatedWeightShift', aggregation: 'typical', window: HORSE_7,
    target: { kind: 'atMost', value: 0.3, zeroAt: 0.7, unit: '' },
    thresholdBasis: '示范者冲拳阶段偏移约 0.05；达标线取 0.3，0.7 为 0 分。',
    feedback: { issue: '冲拳时重心偏向一侧', cue: '重心保持在两脚中间' },
    limitations: ['基于髋部与两踝的投影估计，不是真实足底压力；官方错误中未单列此项（证据等级 C）。'],
  }),
  check({
    id: 'bdj.7.torso_upright', exercise: 'bdj-7', name: '上体正直',
    description: '冲拳阶段躯干侧倾角。',
    requirement: '冲拳时上体正直，不随拳倾斜。',
    sourceId: STANDARD, evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: HORSE_7,
    target: { kind: 'atMost', value: 8, zeroAt: 20, unit: '°' },
    thresholdBasis: '示范者冲拳阶段躯干侧倾约 2–4°；达标线取 8°，20° 为 0 分。',
    feedback: { issue: '冲拳时上体倾斜', cue: '上体保持正直，用内力缓慢出拳' },
  }),
  notObservable({
    id: 'bdj.7.natural_elbow', mode: 'baduanjin', exercise: 'bdj-7', name: '冲拳肘部自然直、不用猛力',
    requirement: '冲拳时用内力缓慢匀速出拳，肘部自然直，不要用猛力、完全伸直（习惯性错误一）。', sourceId: ERRORS,
    reason: '拳向镜头方向冲出，二维画面中肘角因透视缩短不可靠；用力方式也无法从画面判断。',
  }),
  notObservable({
    id: 'bdj.7.glare_and_grip', mode: 'baduanjin', exercise: 'bdj-7', name: '怒目、旋腕与握固',
    requirement: '怒目注视拳面方向；收拳时充分旋腕，握固时先合大拇指再握拢（习惯性错误二）。', sourceId: ERRORS,
    reason: `${COMMON_NOT_OBSERVABLE_REASONS.gaze}${COMMON_NOT_OBSERVABLE_REASONS.handShape}`,
  }),

  // 第八式 背后七颠百病消
  check({
    id: 'bdj.8.body_steady', exercise: 'bdj-8', name: '起落时身体中正',
    description: '提踵起落阶段躯干侧倾角。',
    requirement: '起落时控制头的摆动，重心稳定（习惯性错误一）。',
    sourceId: ERRORS, additionalSourceIds: [STANDARD], evidenceLevel: 'A', observable: 'PROXY',
    metric: 'torsoLean', aggregation: 'typical', window: HEEL_RAISE,
    target: { kind: 'atMost', value: 6, zeroAt: 15, unit: '°' },
    thresholdBasis: '示范者起落阶段躯干侧倾约 2–3°；达标线取 6°，15° 为 0 分。',
    weight: 2,
    feedback: { issue: '提踵起落时身体晃动', cue: '头向上顶，身体中正，平稳起落' },
    limitations: ['官方强调的是重心前后移动，属前后方向，正面画面只能检查左右晃动。'],
  }),
  referenceOnly({
    id: 'bdj.8.heel_raise', mode: 'baduanjin', exercise: 'bdj-8', name: '提踵高度与平缓下落',
    requirement: '两脚跟提起、头向上顶；从最高处平缓匀速下落，落跟震动不可过重也不可过轻，中途不停顿（习惯性错误二）。', sourceId: ERRORS,
    reason: '提踵高度可以用身体整体上移估计，但需要站立基线与真人数据标定；本轮未进入自动评分。',
  }),
  notObservable({
    id: 'bdj.8.fore_aft_balance', mode: 'baduanjin', exercise: 'bdj-8', name: '重心前后移动控制在脚心至脚掌',
    requirement: '起落时重心前后移动的幅度控制在脚心至脚掌之内（习惯性错误一的纠正方法）。', sourceId: ERRORS,
    reason: '前后方向的重心移动无法从正面二维画面判断。',
  }),

  // 预备势、收势与全套通用
  notObservable({
    id: 'bdj.open.gaze_and_feet', mode: 'baduanjin', exercise: 'bdj-open', name: '目光平视、两脚平行',
    requirement: '开步时目光平视、不低头；左脚开步先落脚尖再落脚跟，两脚平行，不成八字脚（预备势习惯性错误一）。', sourceId: ERRORS,
    reason: '目光方向与脚尖朝向在正面二维画面中无法可靠判断。',
  }),
  referenceOnly({
    id: 'bdj.open.hold_ball', mode: 'baduanjin', exercise: 'bdj-open', name: '抱球高度与手臂放松',
    requirement: '抱球时手臂放松、两肘下落，两手掌心与脐同高，不要过高或僵硬（预备势习惯性错误二）。', sourceId: ERRORS,
    reason: '掌心高度可以估计，但“放松、僵硬”无法判断；本轮未进入自动评分。',
  }),
  notObservable({
    id: 'bdj.close.attention', mode: 'baduanjin', exercise: 'bdj-close', name: '收功专注、三调合一',
    requirement: '收功时注意力集中在呼吸与最后动作的配合上，两掌叠于丹田调息（收势习惯性错误）。', sourceId: ERRORS,
    reason: `${COMMON_NOT_OBSERVABLE_REASONS.intent}${COMMON_NOT_OBSERVABLE_REASONS.breathing}`,
  }),
  notObservable({
    id: 'bdj.all.breathing', mode: 'baduanjin', exercise: '*', name: '呼吸配合',
    requirement: '动作与呼吸配合（如上托吸气、下落呼气），呼吸自然。', sourceId: STANDARD, reason: COMMON_NOT_OBSERVABLE_REASONS.breathing,
  }),
  notObservable({
    id: 'bdj.all.intent', mode: 'baduanjin', exercise: '*', name: '意念与神态',
    requirement: '松静自然、意念集中，神与形合。', sourceId: STANDARD, reason: COMMON_NOT_OBSERVABLE_REASONS.intent,
  }),
])
