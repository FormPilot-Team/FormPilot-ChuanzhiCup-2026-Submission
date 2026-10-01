// 八段锦步骤表，按 programs.ts 的章节 id 索引。每式取一条主关节轨迹，峰值表示是否到位；数值是二维画面中的投影
export type BaduanjinTrajectory =
  | 'liftBoth'
  | 'pushReach'
  | 'singleLift'
  | 'headTurn'
  | 'headSway'
  | 'reachDown'
  | 'punchLift'
  | 'heelRiseProxy'

/** scored 计分；proxy 近似值、低权重；phase-only 只检测阶段，不评幅度 */
export type AmplitudeMode = 'scored' | 'proxy' | 'phase-only'

export interface BaduanjinStep {
  trajectory: BaduanjinTrajectory
  label: string
  /** 双侧同时，或左右交替（交替时取更活跃的一侧） */
  sides: 'bilateral' | 'alternating'
  amplitude: AmplitudeMode
  /** 反馈中接在数值后面的动作提示 */
  cue: string
  /** 同一动作的第二幅度（摇头摆尾的躯干侧倾） */
  secondary?: { id: 'trunkSideLean'; label: string }
  note?: string
}

export const BADUANJIN_STEPS: Readonly<Record<string, BaduanjinStep | null>> = Object.freeze({
  // 预备势、收势没有需要到达的峰值，不评到位度
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
    note: '用肩中心抬升近似估计脚跟提起，依赖相机固定不动，只是近似值。',
  },
  'bdj-close': null,
})
