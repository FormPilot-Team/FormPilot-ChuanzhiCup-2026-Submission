import type { WuqinxiFeatureId } from './features'

// 五禽戏步骤表，按 programs.ts 的章节 id 索引。每一动标出所属动物和一到两个二维特征，特征的变化范围体现该戏的特点；
// 第一个特征同时用于节律。起势、收势不属于任何一戏
export type WuqinxiCategory = 'tiger' | 'deer' | 'bear' | 'ape' | 'bird'

export interface WuqinxiStep {
  category: WuqinxiCategory
  features: ReadonlyArray<WuqinxiFeatureId>
  /** 反馈中接在数值后面的动作提示 */
  cue: string
}

export const WUQINXI_STEPS: Readonly<Record<string, WuqinxiStep | null>> = Object.freeze({
  'wqx-open': null,
  'wqx-1': { category: 'tiger', features: ['reachUp'], cue: '两掌上举如托重物，充分伸展' },
  'wqx-2': { category: 'tiger', features: ['trunkFlexProxy', 'kneeBend'], cue: '前扑时躯干由屈到伸，屈膝下按' },
  'wqx-3': { category: 'deer', features: ['sideBend', 'kneeBend'], cue: '转腰侧屈再充分一些，前腿屈膝，眼看后脚跟' },
  'wqx-4': { category: 'deer', features: ['kneeBend', 'trunkFlexProxy'], cue: '弓步再沉一些，含胸弓背' },
  'wqx-5': { category: 'bear', features: ['trunkShift', 'trunkFlexProxy'], cue: '以腰腹为轴，上身画圆再大一些' },
  'wqx-6': { category: 'bear', features: ['hipHike', 'hipSway'], cue: '提髋起步，落步时身体左右晃动' },
  'wqx-7': { category: 'ape', features: ['shrug', 'bodyRise'], cue: '耸肩缩颈，脚跟提起' },
  'wqx-8': { category: 'ape', features: ['reachUp', 'kneeBend'], cue: '退步下蹲，再上步举手摘果' },
  'wqx-9': { category: 'bird', features: ['reachUp', 'ankleLift'], cue: '两掌上举、身体后伸，后伸腿再抬高' },
  'wqx-10': { category: 'bird', features: ['wristHeight', 'kneeLift'], cue: '两臂如翅起落，提膝再高一些' },
  'wqx-close': null,
})

export const WUQINXI_CATEGORY_LABEL: Readonly<Record<WuqinxiCategory, string>> = Object.freeze({
  tiger: '虎戏',
  deer: '鹿戏',
  bear: '熊戏',
  ape: '猿戏',
  bird: '鸟戏',
})

export const WUQINXI_CATEGORY_QUALITY: Readonly<Record<WuqinxiCategory, string>> = Object.freeze({
  tiger: '威猛',
  deer: '安舒',
  bear: '沉稳',
  ape: '灵巧',
  bird: '轻捷',
})
