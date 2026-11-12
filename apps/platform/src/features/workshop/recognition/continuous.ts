import type { PoseLandmark } from '../../pose/types'
import type { CapturedPose } from '../types'
import { averageLandmarks } from './capture'
import { BODY_LANDMARKS } from './geometry'
import { bodyCoords, buildPoseMatch } from './poseMatch'

export interface VideoPoseSample { seconds: number; landmarks: ReadonlyArray<PoseLandmark> }
export interface ContinuousSuggestion {
  start: CapturedPose
  finish: CapturedPose
  phases: { start: number; moving: number; peak: number; returned: number }
  suggestedMinRepMs: number
  sampledFrames: number
}

/** A conservative one-cycle proposal. The user must review before applying it. */
export function inferContinuousSuggestion(samples: ReadonlyArray<VideoPoseSample>, aspect: number): ContinuousSuggestion {
  if (samples.length < 8) throw new Error('有效画面太少，请选一段身体完整入镜的示范视频。')
  if (samples.some((sample, index) => index > 0 && sample.seconds - samples[index - 1].seconds > 0.35)) {
    throw new Error('示范中途有一段身体未被识别，请换一段完整入镜的视频。')
  }
  const baseline = samples.slice(0, 3)
  const start = pose(baseline, aspect)
  const baseCoords = bodyCoords(start.landmarks, aspect)
  if (!baseCoords) throw new Error('开头没有看清身体，请从准备姿势开始拍摄。')
  const energy = samples.map((sample) => {
    const coords = bodyCoords(sample.landmarks, aspect)
    if (!coords) return 0
    return Math.max(0, ...BODY_LANDMARKS.map((name) => {
      const a = baseCoords[name]; const b = coords[name]
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    }))
  })
  const peakIndex = energy.indexOf(Math.max(...energy))
  const peakEnergy = energy[peakIndex]
  if (peakEnergy < 0.25 || peakIndex < 4) throw new Error('未找到明显的完成姿势，请从静止的开始姿势拍到动作到位。')
  const finish = pose(samples.slice(Math.max(peakIndex - 1, 0), Math.min(peakIndex + 2, samples.length)), aspect)
  if (!buildPoseMatch(start, finish).model) throw new Error('开始和完成姿势无法形成可靠模板，请手动选择两个清晰画面。')
  const movingIndex = energy.findIndex((value, index) => index >= 3 && value >= peakEnergy * 0.2)
  const returnIndex = energy.findIndex((value, index) => index > peakIndex + 2 && value <= peakEnergy * 0.25)
  if (movingIndex < 0 || returnIndex < 0) throw new Error('未看到动作回到开始姿势。请选一段完整往返的视频，或手动记录两个姿势。')
  const startAt = samples[0].seconds
  const movingAt = samples[movingIndex].seconds
  const peakAt = samples[peakIndex].seconds
  const returnedAt = samples[returnIndex].seconds
  const suggestedMinRepMs = Math.max(400, Math.min(2000, Math.round((returnedAt - movingAt) * 350)))
  return { start, finish, phases: { start: startAt, moving: movingAt, peak: peakAt, returned: returnedAt }, suggestedMinRepMs, sampledFrames: samples.length }
}

function pose(samples: ReadonlyArray<VideoPoseSample>, aspect: number): CapturedPose {
  return { landmarks: averageLandmarks(samples.map((sample) => sample.landmarks)), aspect, frames: samples.length, capturedAt: new Date().toISOString() }
}
