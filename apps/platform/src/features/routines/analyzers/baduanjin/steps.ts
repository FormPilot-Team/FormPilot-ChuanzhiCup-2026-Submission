/**
 * 八段锦 step table for the 到位度 analyzer, keyed by the chapter ids of `programs.ts` (which is not changed: its
 * version guards the history comparison). Each form names the one joint trajectory whose peak shows whether the
 * movement reached its position; the value is measured in the 2D camera picture, so it is a projection.
 */
export type BaduanjinTrajectory =
  | 'liftBoth'
  | 'pushReach'
  | 'singleLift'
  | 'headTurn'
  | 'headSway'
  | 'reachDown'
  | 'punchLift'
  | 'heelRiseProxy'

/** `scored`: amplitude counts; `proxy`: counts with a low weight and is called an approximation; `phase-only`: not judged. */
export type AmplitudeMode = 'scored' | 'proxy' | 'phase-only'

export interface BaduanjinStep {
  trajectory: BaduanjinTrajectory
  /** What the trajectory measures, as shown in the report. */
  label: string
  /** Both sides together, or one side at a time (the trajectory then takes the more active side). */
  sides: 'bilateral' | 'alternating'
  amplitude: AmplitudeMode
  /** What to do to reach further, quoted in the feedback after the measured value. */
  cue: string
  /** Second amplitude of the same movement, reported next to the main one (摇头摆尾的躯干侧倾). */
  secondary?: { id: 'trunkSideLean'; label: string }
  note?: string
}

export const BADUANJIN_STEPS: Readonly<Record<string, BaduanjinStep | null>> = Object.freeze({
  // 预备势 / 收势 have no movement peak to reach; the 到位度 analyzer does not score them.
  'bdj-open': null,
  'bdj-1': { trajectory: 'liftBoth', label: '两腕上托高出头部', sides: 'bilateral', amplitude: 'scored', cue: '两掌继续上托，两臂充分伸展' },
  'bdj-2': { trajectory: 'pushReach', label: '推弓手离肩中点的水平距离', sides: 'alternating', amplitude: 'scored', cue: '推弓手向侧推远，拉弓手拉至肩前' },
  'bdj-3': { trajectory: 'singleLift', label: '上举手高出同侧肩', sides: 'alternating', amplitude: 'scored', cue: '上举手再向上撑，与下按手对拉拔长' },
  'bdj-4': { trajectory: 'headTurn', label: '转头时鼻尖偏离肩中点', sides: 'alternating', amplitude: 'scored', cue: '头再向后转一些，目视后方' },
  'bdj-5': {
    trajectory: 'headSway',
    label: '头部相对髋中心的水平偏移',
    sides: 'alternating',
    amplitude: 'scored',
    cue: '上身摇转再大一些，头与尾闾相对摆动',
    secondary: { id: 'trunkSideLean', label: '躯干侧倾角' },
    note: '二维画面只看到摇转的侧摆分量，前俯与旋转部分看不到。',
  },
  'bdj-6': { trajectory: 'reachDown', label: '两手下攀低于髋部', sides: 'bilateral', amplitude: 'scored', cue: '俯身时两手沿腿后侧继续下攀' },
  'bdj-7': {
    trajectory: 'punchLift',
    label: '冲拳手从腰间抬至肩高（阶段检测）',
    sides: 'alternating',
    amplitude: 'phase-only',
    cue: '冲拳时拳从腰间送至肩高，再旋腕收回',
    note: '向前冲拳在正面画面中被透视缩短，幅度不可靠：只检测冲拳阶段，未评估幅度。',
  },
  'bdj-8': {
    trajectory: 'heelRiseProxy',
    label: '提踵时肩部抬升（近似）',
    sides: 'bilateral',
    amplitude: 'proxy',
    cue: '脚跟再提起一些，头向上顶',
    note: '用肩中心抬升近似脚跟提起，依赖相机固定不动，是近似值，不是精确测量。',
  },
  'bdj-close': null,
})
