export interface LateralRaiseConfig {
  visibilityThreshold: number
  startMaxAngle: number
  raisingMinAngle: number
  topPhaseAngle: number
  topMinAngle: number
  topMaxAngle: number
  elbowMinAngle: number
  symmetryMaxDiff: number
  torsoLeanMax: number
  topHoldMinMs: number
  topHoldMaxMs: number
  repDurationMinMs: number
  repDurationMaxMs: number
  incompleteTimeoutMs: number
  phasePersistenceFrames: number
  directionVelocity: number
  topVelocity: number
}

export const LATERAL_RAISE_V1: Readonly<LateralRaiseConfig> = Object.freeze({
  visibilityThreshold: 0.65,
  startMaxAngle: 20,
  raisingMinAngle: 25,
  topPhaseAngle: 75,
  topMinAngle: 80,
  topMaxAngle: 100,
  elbowMinAngle: 150,
  symmetryMaxDiff: 15,
  torsoLeanMax: 10,
  topHoldMinMs: 200,
  topHoldMaxMs: 800,
  repDurationMinMs: 2000,
  repDurationMaxMs: 4000,
  incompleteTimeoutMs: 6000,
  phasePersistenceFrames: 5,
  directionVelocity: 6,
  topVelocity: 24,
})

export const LATERAL_RAISE_SCORING = Object.freeze({
  durationFalloffMs: 1500,
  topHoldFalloffMs: 500,
  amplitudeFalloffDeg: 40,
  symmetryIdealMax: 5,
  symmetryZeroAt: 35,
  torsoIdealMax: 3,
  torsoZeroAt: 20,
  idleTempoScore: 65,
  inProgressCompletionValue: 0.55,
  inProgressCompletionScore: 55,
  weights: Object.freeze({
    amplitude: 0.35,
    symmetry: 0.25,
    stability: 0.2,
    tempo: 0.1,
    completion: 0.1,
  }),
})
