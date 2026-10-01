import type { PoseFrame } from '../../pose/types'
import type { ReferenceTrack } from './referenceTrack'

const MIRROR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
]

/** 离 seconds 最近的标准视频姿态，作为摄像头帧；仅供开发用的 synthetic 测试模式 */
export function referencePoseFrame(track: ReferenceTrack, seconds: number, timestamp: number): PoseFrame | null {
  const frames = track.frames
  if (!frames.length) return null
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (frames[middle].t < seconds) low = middle + 1
    else high = middle
  }
  const candidates = [frames[low], frames[low - 1]].filter(Boolean)
  const nearest = candidates.sort((left, right) => Math.abs(left.t - seconds) - Math.abs(right.t - seconds))[0]
  if (!nearest || nearest.confidence <= 0 || !nearest.landmarks.length) return null
  return {
    timestamp,
    confidence: nearest.confidence,
    landmarks: nearest.landmarks.map((point) => ({ x: point.x, y: point.y, z: 0, visibility: point.visibility, presence: point.visibility })),
  }
}

/** 镜像：左右关键点互换，x 翻转 */
export function mirrorPoseFrame(frame: PoseFrame): PoseFrame {
  const landmarks = frame.landmarks.map((point) => ({ ...point, x: 1 - point.x }))
  for (const [left, right] of MIRROR_PAIRS) {
    const swap = landmarks[left]
    landmarks[left] = landmarks[right]
    landmarks[right] = swap
  }
  return { ...frame, landmarks }
}
