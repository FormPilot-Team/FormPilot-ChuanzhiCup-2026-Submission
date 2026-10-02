// Game-facing motion contract. Games import ONLY from this file (and receive objects that satisfy it);
// they never see MediaPipe, PoseDetector, landmarks indices or camera details. Replacing the
// MotionAdapter implementation (e.g. a FormPilot host pose source later) must not change games.

export type Side = 'left' | 'right'
export const SIDES: readonly Side[] = ['left', 'right']

/**
 * Body space: the player's mirror image. Origin = shoulder midpoint, unit = torso length
 * (shoulder midpoint → hip midpoint), +x = screen right, +y = down. Because the view is mirrored,
 * the anatomical LEFT hand normally appears at negative x (screen left), like a mirror.
 */
export interface Point {
  x: number
  y: number
}

export interface TrackingState {
  /** shoulders (and so the body reference) are reliably visible */
  body: boolean
  left: boolean
  right: boolean
}

export type DistanceState = 'ok' | 'too-close' | 'too-far' | 'unknown'

export interface FramingState {
  bodyInFrame: boolean
  leftHandVisible: boolean
  rightHandVisible: boolean
  distance: DistanceState
  /** enough room above / beside the body to raise both arms */
  roomToMove: boolean
  /** short, friendly instruction for the player, or null when everything is fine */
  hint: string | null
  ready: boolean
}

/** Posture-compensation flags. Game feedback only — not a clinical judgement. */
export interface PostureFlags {
  torsoLean: boolean
  shrug: boolean
  shrugSide: Side | 'both' | null
  /** signed lean change from the calibrated neutral posture, degrees (+ = toward screen right) */
  leanDegrees: number | null
  /** ear–shoulder gap relative to the calibrated neutral gap (1 = unchanged) */
  shrugRatio: { left: number | null; right: number | null }
}

/** Display-only skeleton for the mirror window: mirrored, normalised image coordinates (0..1). */
export interface SkeletonPose {
  points: Partial<Record<SkeletonJoint, Point & { visible: boolean }>>
  aspect: number
}
export type SkeletonJoint =
  | 'nose' | 'leftEar' | 'rightEar'
  | 'leftShoulder' | 'rightShoulder' | 'leftElbow' | 'rightElbow' | 'leftWrist' | 'rightWrist'
  | 'leftHip' | 'rightHip'

export interface MotionFrame {
  /** capture-side timestamp of the camera frame, performance.now() milliseconds */
  timestamp: number
  leftWrist?: Point
  rightWrist?: Point
  leftElbow?: Point
  rightElbow?: Point
  leftShoulder?: Point
  rightShoulder?: Point
  /** 0..1 mean raw visibility of the tracked upper-body points */
  confidence: number
  tracking: TrackingState
  posture: PostureFlags
  framing: FramingState
  skeleton?: SkeletonPose
  source: 'camera' | 'synthetic'
}

/** A circular target in body space, registered by the game (Apple). */
export interface MotionTarget {
  id: number
  center: Point
  radius: number
  holdMs: number
}

interface EventBase {
  id: number
  /** timestamp of the camera frame that caused the event */
  timestamp: number
  /** performance.now() when the adapter emitted it (latency instrumentation) */
  emittedAt: number
}

export type MotionEvent = EventBase & (
  // ---- Apple Picking (implemented) ----
  | { type: 'TARGET_ENTER'; targetId: number; side: Side; attemptId: number }
  | { type: 'TARGET_HOLD'; targetId: number; side: Side; attemptId: number; progress: number; completed: boolean }
  | { type: 'TARGET_EXIT'; targetId: number; side: Side; attemptId: number; completed: boolean; reason: 'moved-out' | 'tracking-lost' | 'target-removed' }
  // ---- Boating (reserved: type only, not implemented this round) ----
  | { type: 'STROKE_LEFT'; cycleId: number; amplitude: number; durationMs: number }
  | { type: 'STROKE_RIGHT'; cycleId: number; amplitude: number; durationMs: number }
  // ---- Archery (reserved: type only, not implemented this round) ----
  | { type: 'DRAW_START'; side: Side; attemptId: number }
  | { type: 'DRAW_HOLD'; side: Side; attemptId: number; progress: number; stability: number }
  | { type: 'RELEASE'; side: Side; attemptId: number; drawAmount: number; holdStability: number }
  // ---- shared ----
  | { type: 'TRACKING_LOST'; scope: 'body' | Side }
  | { type: 'TRACKING_RESTORED'; scope: 'body' | Side }
  | { type: 'POSTURE_CHANGED'; posture: PostureFlags }
)

export type MotionEventType = MotionEvent['type']

export type MotionListener = (frame: MotionFrame, events: readonly MotionEvent[]) => void

/** Per-side comfortable reach measured during calibration (body space, torso units). */
export interface ReachProfile {
  /** shoulder joint position in body space */
  shoulder: Point
  /** shoulder → wrist length with a comfortably straight arm */
  armLength: number
  /** highest comfortable arm elevation: angle between "straight down" and shoulder→wrist, degrees */
  maxElevationDeg: number
}

export interface CalibrationProfile {
  id: string
  createdAt: number
  /** true when the player skipped the reach step and defaults were used */
  usedDefaults: boolean
  reach: Record<Side, ReachProfile>
}

export type CalibrationStep = 'idle' | 'neutral' | 'reach-left' | 'reach-right' | 'done'

export interface CalibrationStatus {
  step: CalibrationStep
  /** 0..1 progress of the current step */
  progress: number
  /** current measured elevation of the side being calibrated, degrees */
  liveElevationDeg: number | null
  profile: CalibrationProfile | null
}

/** Capabilities a game can enable. Boating/Archery detectors are reserved, not implemented. */
export type MotionCapability = 'targets' | 'strokes' | 'draw'

/**
 * What a game is allowed to use. The concrete implementation lives in MotionAdapter.ts; future
 * hosts (e.g. FormPilot) only need to provide another object with this shape.
 */
export interface MotionAdapterApi {
  subscribe(listener: MotionListener): () => void
  setTargets(targets: readonly MotionTarget[]): void
  getTargets(): readonly MotionTarget[]
  enable(capability: MotionCapability): void
  /** cancel in-progress attempts (pause, tracking loss, target layout change) */
  resetAttempts(reason: string): void
  /**
   * Gate event detection with the game's pause state. While inactive no attempt can start or
   * complete (a hold finishing during a pause would otherwise be lost); deactivating cancels attempts.
   */
  setDetectionActive(active: boolean): void
  startCalibration(options?: { skipReach?: boolean }): void
  calibration(): CalibrationStatus
  latestFrame(): MotionFrame | null
}
