/**
 * 太极拳 step table for the 连续性 analyzer, keyed by the chapter ids of `programs.ts`.
 *
 * `weightShift` is where the weight should be in the form's 定势 (left / right = the person's own leg, as MediaPipe
 * labels it), `transfer` for forms that move the weight back and forth, `balanced` for centred stances.
 * `scoreShift` follows one rule, checked against the standard video by tests/routine-analyzer-taijiquan.test.ts:
 * true only when the demonstrator's own 2D hip-centre support ratio agrees with the label in ≥ 70 % of the known
 * frames of the 定势窗口 (the demonstrator's slowest 2 s in the last 60 % of the form; for `transfer`: the known
 * frames of the whole form, with at least one left ↔ right crossing). When false, the weight shift is recorded but
 * not scored. The measured share is noted for each form (2026-10-01, standard video).
 */
export type WeightShift = 'left' | 'right' | 'transfer' | 'balanced'

export interface TaijiquanStep {
  weightShift: WeightShift
  scoreShift: boolean
  /** Why the weight shift is recorded only (shown in the report). */
  note?: string
}

const SIDEWAYS = '二维近似在侧身时左右颠倒：示范者实测方向与描述相反，按描述方向记录，不计分。'
const DISAGREES = '示范者实测的髋中心位置与该定势的标注方向不一致（二维近似），只记录不计分。'

export const TAIJIQUAN_STEPS: Readonly<Record<string, TaijiquanStep>> = Object.freeze({
  'tjq-1': { weightShift: 'balanced', scoreShift: true }, // 起势: 100 %
  'tjq-2': { weightShift: 'transfer', scoreShift: true }, // 左右野马分鬃: known 88 %, 12 crossings
  'tjq-3': { weightShift: 'right', scoreShift: true }, // 白鹤亮翅（左虚步）: 100 %
  'tjq-4': { weightShift: 'transfer', scoreShift: true }, // 搂膝拗步: known 91 %, 9 crossings
  'tjq-5': { weightShift: 'right', scoreShift: false, note: SIDEWAYS }, // 手挥琵琶（左虚步）: 0 %, measured on the left
  'tjq-6': { weightShift: 'transfer', scoreShift: true }, // 倒卷肱: known 84 %, 11 crossings
  'tjq-7': { weightShift: 'transfer', scoreShift: true }, // 左揽雀尾: known 96 %, 9 crossings
  'tjq-8': { weightShift: 'transfer', scoreShift: true }, // 右揽雀尾: known 97 %, 20 crossings
  'tjq-9': { weightShift: 'left', scoreShift: false, note: DISAGREES }, // 单鞭（左弓步）: 0 %
  'tjq-10': { weightShift: 'transfer', scoreShift: true }, // 云手: known 84 %, 7 crossings
  'tjq-11': { weightShift: 'left', scoreShift: false, note: DISAGREES }, // 单鞭（左弓步）: 35 %
  'tjq-12': { weightShift: 'right', scoreShift: true }, // 高探马: 100 %
  'tjq-13': { weightShift: 'left', scoreShift: true }, // 右蹬脚（左腿支撑）: 100 %
  'tjq-14': { weightShift: 'right', scoreShift: false, note: SIDEWAYS }, // 双峰贯耳（右弓步）: 0 %, measured on the left
  'tjq-15': { weightShift: 'right', scoreShift: true }, // 转身左蹬脚（右腿支撑）: 100 %
  'tjq-16': { weightShift: 'transfer', scoreShift: false, note: '仆步与独立时两踝常被遮挡或过近，示范者已知帧不足 70 %，只记录不计分。' }, // 左下势独立: known 58 %
  'tjq-17': { weightShift: 'transfer', scoreShift: true }, // 右下势独立: known 93 %, 3 crossings
  'tjq-18': { weightShift: 'transfer', scoreShift: true }, // 左右穿梭: known 76 %, 9 crossings
  'tjq-19': { weightShift: 'right', scoreShift: true }, // 海底针: 73 %
  'tjq-20': { weightShift: 'left', scoreShift: true }, // 闪通臂（左弓步）: 85 %
  'tjq-21': { weightShift: 'transfer', scoreShift: true }, // 转身搬拦捶: known 85 %, 7 crossings
  'tjq-22': { weightShift: 'transfer', scoreShift: true }, // 如封似闭: known 99 %, 4 crossings
  'tjq-23': { weightShift: 'balanced', scoreShift: false, note: DISAGREES }, // 十字手: 0 %
  'tjq-24': { weightShift: 'balanced', scoreShift: true }, // 收势: 100 %
})

export const WEIGHT_SHIFT_LABEL: Readonly<Record<WeightShift, string>> = Object.freeze({
  left: '重心在左腿',
  right: '重心在右腿',
  transfer: '重心左右转换',
  balanced: '重心居中',
})
