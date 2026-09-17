export interface ShoulderRotationConfig extends Record<string, number> {
  visibilityThreshold: number
  minimumExcursion: number
  minimumVelocity: number
  minimumSync: number
  minimumContinuity: number
  pauseTimeoutMs: number
  torsoLeanMax: number
  targetDurationMs: number
  frameMargin: number
}

export const SHOULDER_ROTATION_V1: Readonly<ShoulderRotationConfig> = Object.freeze({
  visibilityThreshold: 0.65,
  minimumExcursion: 35,
  minimumVelocity: 8,
  minimumSync: 0.55,
  minimumContinuity: 0.55,
  pauseTimeoutMs: 900,
  torsoLeanMax: 10,
  targetDurationMs: 15000,
  frameMargin: 0.025,
})
