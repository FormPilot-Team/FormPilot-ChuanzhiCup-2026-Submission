export type LandmarkName =
  | 'nose'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftWrist'
  | 'rightWrist'
  | 'leftHip'
  | 'rightHip'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftAnkle'
  | 'rightAnkle'

export interface PoseLandmark {
  x: number
  y: number
  z: number
  visibility: number
  presence?: number
}

export interface PoseFrame {
  timestamp: number
  landmarks: ReadonlyArray<PoseLandmark>
  confidence: number
}

export interface DerivedBodyPoints {
  shoulderMid: PoseLandmark
  hipMid: PoseLandmark
  shoulderWidth: number
  hipWidth: number
  torsoLength: number
}

export const LANDMARK_INDEX = {
  nose: 0,
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
} as const satisfies Record<LandmarkName, number>

export const LATERAL_RAISE_REQUIRED: ReadonlyArray<LandmarkName> = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
]

export const SQUAT_REQUIRED: ReadonlyArray<LandmarkName> = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
]

export const KNEE_RAISE_REQUIRED: ReadonlyArray<LandmarkName> = SQUAT_REQUIRED

export const UPPER_BODY_WITH_HIPS_BOUNDS: ReadonlyArray<LandmarkName> = [
  'nose',
  ...LATERAL_RAISE_REQUIRED,
]

export const UPPER_BODY_BOUNDS: ReadonlyArray<LandmarkName> = [
  'nose',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
]

export const FULL_BODY_BOUNDS: ReadonlyArray<LandmarkName> = [
  'nose',
  ...LATERAL_RAISE_REQUIRED,
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
]
