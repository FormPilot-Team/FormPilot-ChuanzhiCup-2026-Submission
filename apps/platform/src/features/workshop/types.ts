/**
 * 动作工坊: user-defined actions ("教 FormPilot 学会你的动作"). Everything here is feature-scoped: custom actions have
 * their own schema, store, recognition engine and session records, and never touch the warm-up exercises, their
 * detector configuration or analysis-v1.
 */

export const CUSTOM_ACTION_SCHEMA_VERSION = 1 as const
export const CUSTOM_ACTION_STORAGE_KEY = 'formpilot.custom-actions:v1'
export const CUSTOM_ACTION_EXPORT_FORMAT = 'formpilot-custom-actions'
/** The teammate workbench's library. Read only: imported on request, never written or removed. */
export const LEGACY_ACTION_LIBRARY_KEY = 'ai-coach.action-library:v1'
export const MAX_CUSTOM_ACTIONS = 50

/** 训练部位 */
export type CustomActionBodyArea = 'upper' | 'lower' | 'full' | 'core'

/** Coarse camera region (the workbench's six sandbox profiles). */
export type RecognitionProfile = 'upper-body' | 'hip-lateral' | 'hip-rotation' | 'lower-body' | 'full-body' | 'mixed'

/** The workbench's twelve feature templates. */
export type FeatureTemplateId =
  | 'generic'
  | 'arm-raise'
  | 'arm-circle'
  | 'punch-horizontal'
  | 'squat-depth'
  | 'lunge-single-leg'
  | 'toe-raise'
  | 'seated-leg-raise'
  | 'core-flexion'
  | 'plank-shoulder-tap'
  | 'mountain-climber'
  | 'stretch-hold'

/**
 * How the action is measured. `pose-match` (default) compares every frame with the user's own recorded start and
 * finish poses; a feature template measures one body signal (advanced, or actions imported from the workbench).
 */
export type SignalSource = 'pose-match' | FeatureTemplateId

/** 识别重点, in user language. `full-return` is the counting rule of a repetition and cannot be turned off. */
export type RequirementId = 'arms-straight' | 'hands-above-shoulders' | 'knees-bent' | 'torso-stable' | 'symmetric' | 'full-return'

export type CustomActionGoal =
  | { type: 'reps'; target: number }
  | { type: 'duration'; seconds: number }

export interface CapturedLandmark {
  x: number
  y: number
  z: number
  visibility: number
}

/** A pose recorded with the camera: the average of the frames the user held still, never an image. */
export interface CapturedPose {
  landmarks: CapturedLandmark[]
  /** Width / height of the camera picture the landmarks are normalised to. */
  aspect: number
  frames: number
  capturedAt: string
}

export interface PoseStep {
  /** What the user said the pose is, e.g. 双臂自然下垂. */
  description: string
  capture?: CapturedPose
}

export interface RequirementSetting {
  id: RequirementId
  enabled: boolean
  /** Advanced: the requirement's threshold (degrees for angles, torso fraction for heights). */
  threshold?: number
}

/** Phase thresholds in progress units: 0 = start pose, 1 = finish pose (template mode: 1 = the template's peak). */
export interface PhaseThresholds {
  moving: number
  peak: number
  returnThreshold: number
}

export interface CustomActionRecognition {
  source: SignalSource
  profile: RecognitionProfile
  thresholds: PhaseThresholds
  /** A repetition shorter than this is jitter, not a movement. */
  minRepMs: number
  /** Seconds the finish pose must be held (duration goals, and the stretch-hold template). */
  holdSeconds: number
}

export type CustomActionTestStatus = 'not-tested' | 'passed' | 'needs-adjustment'

export interface CustomActionTestResult {
  status: CustomActionTestStatus
  testedAt?: string
  repsDetected?: number
  repsPassed?: number
}

export type CustomActionSourceKind = 'workshop' | 'imported-file' | 'legacy-library'

export interface CustomActionDefinition {
  schemaVersion: typeof CUSTOM_ACTION_SCHEMA_VERSION
  id: string
  name: string
  description: string
  bodyArea: CustomActionBodyArea
  goal: CustomActionGoal
  startPose: PoseStep
  finishPose: PoseStep
  requirements: RequirementSetting[]
  recognition: CustomActionRecognition
  test: CustomActionTestResult
  source: { kind: CustomActionSourceKind; legacyId?: string; importedAt?: string }
  createdAt: string
  updatedAt: string
}

export interface CustomActionLoadResult {
  actions: CustomActionDefinition[]
  /** Stored data was written by a newer schema: shown read-only and never overwritten. */
  readOnly: boolean
  /** Entries that failed validation and were skipped. */
  skipped: number
}
