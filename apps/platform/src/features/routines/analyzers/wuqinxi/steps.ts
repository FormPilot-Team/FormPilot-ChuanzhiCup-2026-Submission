import type { WuqinxiFeatureId } from './features'

/**
 * 五禽戏 step table for the 五戏特征 analyzer, keyed by the chapter ids of `programs.ts`. Each of the ten movements
 * names its animal and the one or two 2D features whose range shows the animal's characteristic movement; the first
 * feature also carries the movement's rhythm. 起势 / 收势 belong to no animal and get no profile.
 * Demonstrator ranges (p95 − p5 of the smoothed feature, standard video, 2026-10-01) are noted for each feature.
 */
export type WuqinxiCategory = 'tiger' | 'deer' | 'bear' | 'ape' | 'bird'

export interface WuqinxiStep {
  category: WuqinxiCategory
  features: ReadonlyArray<WuqinxiFeatureId>
  /** What to do to show more of the animal, quoted after the measured value. */
  cue: string
}

export const WUQINXI_STEPS: Readonly<Record<string, WuqinxiStep | null>> = Object.freeze({
  'wqx-open': null,
  // 虎举: hands 1.52 torso lengths up and down.
  'wqx-1': { category: 'tiger', features: ['reachUp'], cue: '两掌上举如托重物，充分伸展' },
  // 虎扑: torso projection 0.53, knee bend 57°.
  'wqx-2': { category: 'tiger', features: ['trunkFlexProxy', 'kneeBend'], cue: '前扑时躯干由屈到伸，屈膝下按' },
  // 鹿抵: side bend 67°, knee bend 54° (the lunge). The shoulder / hip width ratio (a 转腰 proxy, range 0.44) was tried
  // first and dropped: none of the self-check perturbations moved it.
  'wqx-3': { category: 'deer', features: ['sideBend', 'kneeBend'], cue: '转腰侧屈再充分一些，前腿屈膝，眼看后脚跟' },
  // 鹿奔: knee bend 64° (弓步), torso projection 0.15 (弓背).
  'wqx-4': { category: 'deer', features: ['kneeBend', 'trunkFlexProxy'], cue: '弓步再沉一些，含胸弓背' },
  // 熊运: shoulder centre sideways 0.59, torso projection 0.19 (the trunk circles).
  'wqx-5': { category: 'bear', features: ['trunkShift', 'trunkFlexProxy'], cue: '以腰腹为轴，上身画圆再大一些' },
  // 熊晃: hip line 29°, hip centre over the feet 0.61.
  'wqx-6': { category: 'bear', features: ['hipHike', 'hipSway'], cue: '提髋起步，落步时身体左右晃动' },
  // 猿提: ears to shoulders 0.21, shoulders up 0.25.
  'wqx-7': { category: 'ape', features: ['shrug', 'bodyRise'], cue: '耸肩缩颈，脚跟提起' },
  // 猿摘: hands up 1.15 (visible 70 % of the time), knee bend 78°.
  'wqx-8': { category: 'ape', features: ['reachUp', 'kneeBend'], cue: '退步下蹲，再上步举手摘果' },
  // 鸟伸: hands up 1.66, ankles apart vertically 0.54 (one leg stretched back).
  'wqx-9': { category: 'bird', features: ['reachUp', 'ankleLift'], cue: '两掌上举、身体后伸，后伸腿再抬高' },
  // 鸟飞: arms 1.83 up and down, knee lifted 0.82.
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
