import type { LandmarkName, PoseLandmark } from '../../pose/types'
import type { CapturedLandmark, CapturedPose } from '../types'
import { MIN_VISIBILITY, isUsable, landmark } from './geometry'
import { bodyCoords } from './poseMatch'

/**
 * Records a start or finish pose: the user holds still for a moment and the average of those frames is kept. Only
 * landmark coordinates are stored — never the camera picture.
 */
export const CAPTURE_HOLD_MS = 1200
export const CAPTURE_MIN_FRAMES = 8
/** Any joint moving more than this share of the torso length restarts the hold. */
export const CAPTURE_STILLNESS = 0.12

export type CaptureStatus = 'waiting-body' | 'holding' | 'captured'

export interface CaptureProgress {
  status: CaptureStatus
  /** 0–1 of the hold. */
  progress: number
  missing: LandmarkName[]
  pose?: CapturedPose
}

interface Sample {
  landmarks: ReadonlyArray<PoseLandmark>
  timestamp: number
}

export class PoseCaptureSession {
  private samples: Sample[] = []
  private anchor?: ReturnType<typeof bodyCoords>
  private done?: CapturedPose

  constructor(
    private readonly required: ReadonlyArray<LandmarkName>,
    private readonly aspect: number,
    private readonly holdMs = CAPTURE_HOLD_MS,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  push(landmarks: ReadonlyArray<PoseLandmark> | null, timestamp: number): CaptureProgress {
    if (this.done) return { status: 'captured', progress: 1, missing: [], pose: this.done }
    const missing = landmarks ? this.required.filter((name) => !isUsable(landmark(landmarks, name), MIN_VISIBILITY)) : [...this.required]
    const coords = landmarks && !missing.length ? bodyCoords(landmarks, this.aspect) : undefined
    if (!landmarks || !coords) {
      this.restart()
      return { status: 'waiting-body', progress: 0, missing }
    }
    if (this.anchor && this.moved(this.anchor, coords)) this.restart()
    if (!this.anchor) this.anchor = coords
    this.samples.push({ landmarks, timestamp })
    const elapsed = timestamp - this.samples[0].timestamp
    const progress = Math.min(1, elapsed / this.holdMs)
    if (elapsed >= this.holdMs && this.samples.length >= CAPTURE_MIN_FRAMES) {
      this.done = { landmarks: averageLandmarks(this.samples.map((sample) => sample.landmarks)), aspect: this.aspect, frames: this.samples.length, capturedAt: this.now() }
      return { status: 'captured', progress: 1, missing: [], pose: this.done }
    }
    return { status: 'holding', progress, missing: [] }
  }

  private moved(anchor: NonNullable<ReturnType<typeof bodyCoords>>, coords: NonNullable<ReturnType<typeof bodyCoords>>): boolean {
    for (const name of this.required) {
      const a = anchor[name]
      const b = coords[name]
      if (a && b && Math.hypot(a.x - b.x, a.y - b.y) > CAPTURE_STILLNESS) return true
    }
    return false
  }

  private restart(): void {
    this.samples = []
    this.anchor = undefined
  }
}

/** Per-landmark average over the frames where it was usable; unusable everywhere keeps visibility 0. */
export function averageLandmarks(frames: ReadonlyArray<ReadonlyArray<PoseLandmark>>): CapturedLandmark[] {
  const count = Math.max(0, ...frames.map((frame) => frame.length))
  const result: CapturedLandmark[] = []
  for (let index = 0; index < count; index += 1) {
    let x = 0; let y = 0; let z = 0; let visibility = 0; let n = 0
    for (const frame of frames) {
      const point = frame[index]
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.visibility)) continue
      x += point.x; y += point.y; z += Number.isFinite(point.z) ? point.z : 0; visibility += point.visibility; n += 1
    }
    result.push(n ? { x: round4(x / n), y: round4(y / n), z: round4(z / n), visibility: round4(visibility / n) } : { x: 0, y: 0, z: 0, visibility: 0 })
  }
  return result
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
