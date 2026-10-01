// 太极拳步骤表，按 programs.ts 的章节 id 索引。left / right 指本人左右腿（MediaPipe 标注）。
// scoreShift 规则：定势窗口内示范者二维髋中心与标注一致的已知帧 ≥ 70% 才计分；transfer 式要求全式已知帧 ≥ 70% 且至少一次左右穿越
export type WeightShift = 'left' | 'right' | 'transfer' | 'balanced'

export interface TaijiquanStep {
  weightShift: WeightShift
  scoreShift: boolean
  /** 只记录不计分的原因（报告中显示） */
  note?: string
}

const SIDEWAYS = '二维近似在侧身时左右颠倒：示范视频上估计的方向与描述相反，按描述方向记录，不计分。'
const DISAGREES = '示范视频上估计的髋中心位置与该定势的标注方向不一致（二维近似），只记录不计分。'

export const TAIJIQUAN_STEPS: Readonly<Record<string, TaijiquanStep>> = Object.freeze({
  'tjq-1': { weightShift: 'balanced', scoreShift: true }, // 起势
  'tjq-2': { weightShift: 'transfer', scoreShift: true }, // 左右野马分鬃
  'tjq-3': { weightShift: 'right', scoreShift: true }, // 白鹤亮翅（左虚步）
  'tjq-4': { weightShift: 'transfer', scoreShift: true }, // 搂膝拗步
  'tjq-5': { weightShift: 'right', scoreShift: false, note: SIDEWAYS }, // 手挥琵琶（左虚步）
  'tjq-6': { weightShift: 'transfer', scoreShift: true }, // 倒卷肱
  'tjq-7': { weightShift: 'transfer', scoreShift: true }, // 左揽雀尾
  'tjq-8': { weightShift: 'transfer', scoreShift: true }, // 右揽雀尾
  'tjq-9': { weightShift: 'left', scoreShift: false, note: DISAGREES }, // 单鞭（左弓步）
  'tjq-10': { weightShift: 'transfer', scoreShift: true }, // 云手
  'tjq-11': { weightShift: 'left', scoreShift: false, note: DISAGREES }, // 单鞭（左弓步）
  'tjq-12': { weightShift: 'right', scoreShift: true }, // 高探马
  'tjq-13': { weightShift: 'left', scoreShift: true }, // 右蹬脚（左腿支撑）
  'tjq-14': { weightShift: 'right', scoreShift: false, note: SIDEWAYS }, // 双峰贯耳（右弓步）
  'tjq-15': { weightShift: 'right', scoreShift: true }, // 转身左蹬脚（右腿支撑）
  'tjq-16': { weightShift: 'transfer', scoreShift: false, note: '仆步与独立时两踝常被遮挡或过近，示范者已知帧不足 70 %，只记录不计分。' }, // 左下势独立
  'tjq-17': { weightShift: 'transfer', scoreShift: true }, // 右下势独立
  'tjq-18': { weightShift: 'transfer', scoreShift: true }, // 左右穿梭
  'tjq-19': { weightShift: 'right', scoreShift: true }, // 海底针
  'tjq-20': { weightShift: 'left', scoreShift: true }, // 闪通臂（左弓步）
  'tjq-21': { weightShift: 'transfer', scoreShift: true }, // 转身搬拦捶
  'tjq-22': { weightShift: 'transfer', scoreShift: true }, // 如封似闭
  'tjq-23': { weightShift: 'balanced', scoreShift: false, note: DISAGREES }, // 十字手
  'tjq-24': { weightShift: 'balanced', scoreShift: true }, // 收势
})

/** 二维髋中心的估计结果，表示支撑腿，不是测得的重心 */
export const WEIGHT_SHIFT_LABEL: Readonly<Record<WeightShift, string>> = Object.freeze({
  left: '偏左腿支撑',
  right: '偏右腿支撑',
  transfer: '左右转换',
  balanced: '居中',
})
