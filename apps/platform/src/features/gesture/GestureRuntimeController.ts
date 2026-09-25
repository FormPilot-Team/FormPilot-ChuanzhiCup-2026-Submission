import type { CourseState } from '../course/CourseController'
import type { NormalizedPoseFrame } from '../pose/PoseNormalizer'
import { detectPauseGesture, detectStartGesture } from './gestureDetection'
import { DEFAULT_GESTURE_HOLD_CONFIG, GestureHoldController, type GestureHoldConfig } from './GestureHoldController'

export type GestureAction = 'start' | 'pause' | 'resume'

export interface GestureRuntimeInput {
  courseState: CourseState
  framingValid: boolean
  pose: NormalizedPoseFrame
}

export interface GestureRuntimeSnapshot {
  action?: GestureAction
  progress: number
  holding: boolean
  triggered?: GestureAction
  coolingDown: boolean
}

export class GestureRuntimeController {
  private readonly hold: GestureHoldController<GestureAction>
  private previousState?: CourseState

  constructor(config: GestureHoldConfig = DEFAULT_GESTURE_HOLD_CONFIG) {
    this.hold = new GestureHoldController(config)
  }

  reset(clearCooldown = false): void {
    this.previousState = undefined
    this.hold.reset(clearCooldown)
  }

  update(input: GestureRuntimeInput): GestureRuntimeSnapshot {
    if (this.previousState !== input.courseState) {
      this.previousState = input.courseState
      this.hold.reset()
    }

    const action = input.courseState === 'PREPARING' && input.framingValid ? 'start'
      : input.courseState === 'ACTIVE' ? 'pause'
        : input.courseState === 'PAUSED' ? 'resume'
          : undefined
    const detected = action === 'pause' ? detectPauseGesture(input.pose)
      : action === 'start' || action === 'resume' ? detectStartGesture(input.pose)
        : false
    const result = this.hold.update(action, detected, input.pose.timestamp)
    return {
      action,
      progress: result.progress,
      holding: detected && !result.coolingDown,
      triggered: result.triggered ? action : undefined,
      coolingDown: result.coolingDown,
    }
  }
}
