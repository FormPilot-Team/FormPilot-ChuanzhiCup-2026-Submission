import type { ExerciseId, ExercisePhase } from '../exercises/types'
import type { LandmarkName, PoseLandmark } from '../pose/types'

export type ReferenceMetricKey =
  | 'shoulderAngle'
  | 'elbowAngle'
  | 'symmetryDiff'
  | 'torsoLean'
  | 'armAngle'
  | 'armAngleDiff'
  | 'openRatio'
  | 'hipDrop'
  | 'kneeSpreadRatio'
  | 'kneeHeightDiff'
  | 'hipKneeSeparation'
  | 'kneeWidthShoulderRatio'
  | 'ankleWidthShoulderRatio'
  | 'kneeAnkleHorizontalOffset'
  | 'legSymmetryDiff'
  | 'torsoCenterOffset'
  | 'leftKneeHeight'
  | 'rightKneeHeight'
  | 'hipShift'

export interface MetricTarget {
  key: ReferenceMetricKey
  target: number
  unit: 'degree' | 'ratio'
}

export interface MetricRange {
  key: ReferenceMetricKey
  min?: number
  max?: number
  unit: 'degree' | 'ratio'
}

/** Ideal teaching geometry. It is intentionally stricter than user scoring. */
export interface CanonicalPose {
  id: string
  exerciseId: ExerciseId
  phase: ExercisePhase
  side?: 'left' | 'right' | 'center'
  metrics: ReadonlyArray<MetricTarget>
  /** Visual/engineering reference geometry, never detected landmarks. */
  landmarks?: PoseAnchorLandmarks
}

/** Runtime tolerance used to decide whether a real user movement is acceptable. */
export interface UserAcceptanceThreshold {
  canonicalPoseId: string
  metrics: ReadonlyArray<MetricRange>
}

/** Release gate for the visible AI Coach bitmap and its detected pose. */
export interface CoachAssetAcceptance {
  canonicalPoseId: string
  metrics: ReadonlyArray<MetricRange>
  detectability?: {
    minimumPoseConfidence: number
    minimumRequiredLandmarkVisibility: number
    fullBodyMargin: number
    maximumLeftRightVisibilityDiff: number
  }
}

export type PoseAnchorLandmarks = Record<LandmarkName, Pick<PoseLandmark, 'x' | 'y' | 'z' | 'visibility'>>

export interface ReferencePose {
  schemaVersion: 1
  asset: string
  image: { width: number; height: number }
  canonicalPoseId: string
  detector: 'MediaPipe Pose Landmarker Lite'
  poseConfidence?: number
  capturedAt: string
  landmarks: PoseAnchorLandmarks
}

export interface CoachAssetValidationFailure {
  gate: 'detectability' | 'canonical_similarity'
  check: string
  actual: number | boolean
  expected: string
}

export interface CoachAssetValidationResult {
  detectable: boolean
  canonicalSimilarityPassed: boolean
  metrics: Readonly<Record<string, number | boolean>>
  failedChecks: ReadonlyArray<CoachAssetValidationFailure>
}

export interface ExerciseReferenceProfile {
  canonicalPoses: ReadonlyArray<CanonicalPose>
  userAcceptance: ReadonlyArray<UserAcceptanceThreshold>
  coachAssetAcceptance: ReadonlyArray<CoachAssetAcceptance>
  coachPoseAnchorSrc: string
}
