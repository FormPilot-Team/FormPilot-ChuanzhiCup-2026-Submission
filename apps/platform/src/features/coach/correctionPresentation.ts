import type { CoachCorrectionPresentation } from '../exercises/contract'
import type { ExerciseId, MotionErrorCode } from '../exercises/types'

const correction = (
  errorCode: MotionErrorCode,
  highlightRegion: CoachCorrectionPresentation['highlightRegion'],
  direction?: CoachCorrectionPresentation['direction'],
): CoachCorrectionPresentation => ({ errorCode, highlightRegion, direction })

const poseQuality = {
  POSE_LOW_CONFIDENCE: correction('POSE_LOW_CONFIDENCE', 'none'),
  BODY_OUT_OF_FRAME: correction('BODY_OUT_OF_FRAME', 'none'),
} as const

export const COACH_CORRECTIONS: Record<ExerciseId, Partial<Record<MotionErrorCode, CoachCorrectionPresentation>>> = {
  shoulder_rotation: {
    ...poseQuality,
    MOTION_TOO_SMALL: correction('MOTION_TOO_SMALL', 'both_arms'),
    ARMS_UNSYNCED: correction('ARMS_UNSYNCED', 'both_arms'),
    MOTION_PAUSED: correction('MOTION_PAUSED', 'both_arms'),
    TORSO_LEAN: correction('TORSO_LEAN', 'core'),
  },
  overhead_raise: {
    ...poseQuality,
    ARMS_TOO_LOW: correction('ARMS_TOO_LOW', 'both_arms', 'up'),
    ELBOW_TOO_BENT_L: correction('ELBOW_TOO_BENT_L', 'left_elbow'),
    ELBOW_TOO_BENT_R: correction('ELBOW_TOO_BENT_R', 'right_elbow'),
    ASYMMETRY: correction('ASYMMETRY', 'both_arms'),
    TORSO_LEAN: correction('TORSO_LEAN', 'core'),
    TOO_FAST: correction('TOO_FAST', 'both_arms'),
    INCOMPLETE_REP: correction('INCOMPLETE_REP', 'both_arms'),
  },
  lateral_raise: {
    ...poseQuality,
    ARM_TOO_LOW_L: correction('ARM_TOO_LOW_L', 'left_arm', 'up'),
    ARM_TOO_LOW_R: correction('ARM_TOO_LOW_R', 'right_arm', 'up'),
    ELBOW_TOO_BENT_L: correction('ELBOW_TOO_BENT_L', 'left_elbow'),
    ELBOW_TOO_BENT_R: correction('ELBOW_TOO_BENT_R', 'right_elbow'),
    ASYMMETRY: correction('ASYMMETRY', 'both_arms'),
    TORSO_LEAN: correction('TORSO_LEAN', 'core'),
    TOO_FAST: correction('TOO_FAST', 'both_arms'),
    INCOMPLETE_REP: correction('INCOMPLETE_REP', 'both_arms'),
  },
  step_jack: {
    ...poseQuality,
    STEP_TOO_SMALL: correction('STEP_TOO_SMALL', 'full_body'),
    ARM_TOO_LOW: correction('ARM_TOO_LOW', 'both_arms', 'up'),
    ARM_LEG_UNSYNCED: correction('ARM_LEG_UNSYNCED', 'full_body'),
    WRONG_SIDE_SEQUENCE: correction('WRONG_SIDE_SEQUENCE', 'full_body'),
    BODY_SWAY: correction('BODY_SWAY', 'core'),
    INCOMPLETE_RETURN: correction('INCOMPLETE_RETURN', 'full_body'),
    TOO_FAST: correction('TOO_FAST', 'full_body'),
  },
  squat: {
    ...poseQuality,
    DEPTH_INSUFFICIENT: correction('DEPTH_INSUFFICIENT', 'hip_depth', 'down'),
    KNEE_VALGUS: correction('KNEE_VALGUS', 'knees'),
    LEFT_RIGHT_ASYMMETRY: correction('LEFT_RIGHT_ASYMMETRY', 'knees'),
    TORSO_LATERAL_LEAN: correction('TORSO_LATERAL_LEAN', 'core'),
    TOO_FAST: correction('TOO_FAST', 'full_body'),
    INCOMPLETE_REP: correction('INCOMPLETE_REP', 'full_body'),
  },
  knee_raise: {
    ...poseQuality,
    KNEE_TOO_LOW_L: correction('KNEE_TOO_LOW_L', 'left_knee', 'up'),
    KNEE_TOO_LOW_R: correction('KNEE_TOO_LOW_R', 'right_knee', 'up'),
    BODY_SWAY: correction('BODY_SWAY', 'core'),
    WRONG_SIDE_SEQUENCE: correction('WRONG_SIDE_SEQUENCE', 'full_body'),
    LEFT_RIGHT_HEIGHT_GAP: correction('LEFT_RIGHT_HEIGHT_GAP', 'knees'),
    INCOMPLETE_RETURN: correction('INCOMPLETE_RETURN', 'full_body'),
    TOO_FAST: correction('TOO_FAST', 'full_body'),
  },
}
