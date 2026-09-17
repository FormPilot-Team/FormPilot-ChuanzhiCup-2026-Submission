export interface KneeRaiseConfig {
  visibilityThreshold: number
  baselineStableFrames: number
  baselineLostFramesToReset: number
  baselineCenterHeightMax: number
  baselineVelocityMax: number
  centerHeightMax: number
  centerVelocityMax: number
  raiseStartHeight: number
  raisingVelocityMin: number
  topDetectionMinHeight: number
  topVelocityMax: number
  returnVelocityMin: number
  userTargetHeight: number
  peakHeightGapMax: number
  torsoLeanMax: number
  hipShiftMax: number
  repDurationMinMs: number
  repDurationMaxMs: number
  incompleteReturnTimeoutMs: number
  phasePersistenceFrames: number
}

/** Engineering-only values. CALIBRATION REQUIRED before any clinical/official claim. */
export const KNEE_RAISE_V1: Readonly<KneeRaiseConfig> = Object.freeze({
  visibilityThreshold: 0.65,
  baselineStableFrames: 10,
  baselineLostFramesToReset: 12,
  baselineCenterHeightMax: -0.45,
  baselineVelocityMax: 0.12,
  centerHeightMax: -0.38,
  centerVelocityMax: 0.18,
  raiseStartHeight: -0.3,
  raisingVelocityMin: 0.18,
  topDetectionMinHeight: -0.25,
  topVelocityMax: 0.22,
  returnVelocityMin: 0.12,
  userTargetHeight: -0.1,
  peakHeightGapMax: 0.12,
  torsoLeanMax: 10,
  hipShiftMax: 0.2,
  repDurationMinMs: 1000,
  repDurationMaxMs: 1600,
  incompleteReturnTimeoutMs: 2200,
  phasePersistenceFrames: 2,
})

export const KNEE_RAISE_SCORING = Object.freeze({
  amplitudePoints: Object.freeze([
    [-0.55, 0], [-0.35, 25], [-0.2, 65], [-0.1, 92], [0.02, 100], [0.25, 100],
  ] as const),
  torsoIdealMax: 3,
  torsoZeroAt: 20,
  hipShiftIdealMax: 0.05,
  hipShiftZeroAt: 0.35,
  heightGapIdealMax: 0.04,
  heightGapZeroAt: 0.24,
  weights: Object.freeze({ amplitude: 0.3, stability: 0.25, alternation: 0.2, symmetry: 0.15, tempo: 0.1 }),
})
