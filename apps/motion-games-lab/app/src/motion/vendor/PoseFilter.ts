// Copied from FormPilot_v3: src/features/pose/PoseFilter.ts (commit 9cf6c24, 2026-10-02).
// Verbatim copy except the import path. Lab change: frameBuilder feeds it only the 13 upper-body points, per side, and resets it on quality loss.

import type { PoseFrame, PoseLandmark } from './poseTypes'

export interface PoseFilterConfig {
  medianWindow: number
  emaAlpha: number
}

export const DEFAULT_POSE_FILTER_CONFIG: PoseFilterConfig = {
  medianWindow: 5,
  emaAlpha: 0.35,
}

export function median(values: ReadonlyArray<number>): number {
  return medianInPlace([...values])
}

function medianInPlace(values: number[]): number {
  if (values.length === 0) return 0
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle]
}

export function ema(previous: number, current: number, alpha: number): number {
  return alpha * current + (1 - alpha) * previous
}

export class PoseFilter {
  private readonly history: PoseFrame[] = []
  private previous?: PoseFrame
  private readonly xs: number[] = []
  private readonly ys: number[] = []
  private readonly zs: number[] = []
  private readonly vis: number[] = []
  private readonly pres: number[] = []

  constructor(private readonly config: PoseFilterConfig = DEFAULT_POSE_FILTER_CONFIG) {}

  reset(): void {
    this.history.length = 0
    this.previous = undefined
  }

  push(frame: PoseFrame): PoseFrame {
    this.history.push(frame)
    if (this.history.length > this.config.medianWindow) this.history.shift()

    const landmarkCount = frame.landmarks.length
    const medianLandmarks: PoseLandmark[] = new Array(landmarkCount)
    for (let index = 0; index < landmarkCount; index += 1) {
      this.xs.length = 0
      this.ys.length = 0
      this.zs.length = 0
      this.vis.length = 0
      this.pres.length = 0
      for (const item of this.history) {
        const point = item.landmarks[index]
        if (!point) continue
        this.xs.push(point.x)
        this.ys.push(point.y)
        this.zs.push(point.z)
        this.vis.push(point.visibility)
        this.pres.push(point.presence ?? 1)
      }
      medianLandmarks[index] = {
        x: medianInPlace(this.xs),
        y: medianInPlace(this.ys),
        z: medianInPlace(this.zs),
        visibility: medianInPlace(this.vis),
        presence: medianInPlace(this.pres),
      }
    }

    const filteredLandmarks = this.previous
      ? medianLandmarks.map((point, index) => {
          const old = this.previous?.landmarks[index] ?? point
          return {
            x: ema(old.x, point.x, this.config.emaAlpha),
            y: ema(old.y, point.y, this.config.emaAlpha),
            z: ema(old.z, point.z, this.config.emaAlpha),
            visibility: ema(old.visibility, point.visibility, this.config.emaAlpha),
            presence: ema(old.presence ?? 1, point.presence ?? 1, this.config.emaAlpha),
          }
        })
      : medianLandmarks

    const visibilities = filteredLandmarks.map((point) => point.visibility)
    const result: PoseFrame = {
      timestamp: frame.timestamp,
      landmarks: filteredLandmarks,
      confidence: medianInPlace(visibilities),
    }
    this.previous = result
    return result
  }
}
