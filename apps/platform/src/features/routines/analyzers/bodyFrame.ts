import type { PosePointLike } from '../followAlong/matcher'

/** 分析器用到的 MediaPipe Pose 关键点序号 */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const

export interface Point {
  x: number
  y: number
}

export interface BodyFrame {
  /** 按宽高比校正后的图像坐标（x × 宽/高，y 不变）；可见度不足时为 null */
  point(index: number): Point | null
  shoulderMid: Point
  hipMid: Point
  /** 肩中心到髋中心。身体朝镜头弯曲时会变短，所以分析器按一段时间内的稳健值做尺度 */
  torsoLength: number
  shoulderWidth: number
  hipWidth: number
}

/** 与跟练比对、动作规范指标相同的可见度门槛 */
export const MIN_LANDMARK_VISIBILITY = 0.5

/** 摄像头看到的二维身体（真实比例）；缺双肩或双髋时为 null。图像 y 向下，“更高”即 y 更小 */
export function bodyFrame(landmarks: ReadonlyArray<PosePointLike>, aspect: number, minVisibility = MIN_LANDMARK_VISIBILITY): BodyFrame | null {
  if (!(aspect > 0)) return null
  const point = (index: number): Point | null => {
    const item = landmarks[index]
    if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y) || (item.visibility ?? 0) < minVisibility) return null
    return { x: item.x * aspect, y: item.y }
  }
  const ls = point(LM.leftShoulder)
  const rs = point(LM.rightShoulder)
  const lh = point(LM.leftHip)
  const rh = point(LM.rightHip)
  if (!ls || !rs || !lh || !rh) return null
  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
  const torsoLength = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y)
  if (!(torsoLength > 0)) return null
  return {
    point,
    shoulderMid,
    hipMid,
    torsoLength,
    shoulderWidth: Math.hypot(ls.x - rs.x, ls.y - rs.y),
    hipWidth: Math.hypot(lh.x - rh.x, lh.y - rh.y),
  }
}

/** 躯干偏离竖直的角度，度；肩在髋的画面右侧为正 */
export function trunkSideLeanDegrees(body: BodyFrame): number {
  const dx = body.shoulderMid.x - body.hipMid.x
  const dy = body.hipMid.y - body.shoulderMid.y
  return (Math.atan2(dx, Math.max(dy, 1e-9)) * 180) / Math.PI
}
