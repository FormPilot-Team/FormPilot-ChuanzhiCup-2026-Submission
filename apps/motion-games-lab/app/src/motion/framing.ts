// Framing guidance: is the player fully in view, are both hands visible, is the distance right,
// and is there room to raise the arms without leaving the picture.
// Adapted from FormPilot_v3 src/features/framing/FramingAssist.ts (commit 9cf6c24): the distance
// thresholds (shoulder width / torso length bands), edge-warning margins and the debounce of the
// shown hint come from there. Lab changes: upper-body profile only (hips optional for seated play),
// a new "room to move" check sized from the player's own shoulder width, and plain short hints.
import type { DistanceState, FramingState } from './contracts'
import { LM, type BodyMeasures } from './frameBuilder'

export const FRAMING_CONFIG = Object.freeze({
  visibility: 0.5,
  /** v3: tooClose when shoulderWidth > 0.48 or torso > 0.46 (normalised image units) */
  tooCloseShoulder: 0.42,
  tooCloseTorso: 0.42,
  /** v3: tooFar when shoulderWidth < 0.105 or torso < 0.12 */
  tooFarShoulder: 0.1,
  tooFarTorso: 0.11,
  /** comfortable arm length ≈ this × shoulder width (lab estimate, only used for headroom) */
  armPerShoulderWidth: 1.35,
  /** fraction of that arm length that must fit above the shoulders / beside them */
  headroomFraction: 0.85,
  sideRoomFraction: 0.7,
  enterDelayMs: 350,
  recoveryDelayMs: 500,
})

export function evaluateFraming(measures: BodyMeasures): Omit<FramingState, 'ready'> {
  const c = FRAMING_CONFIG
  const has = (index: number) => measures.rawValid(index, c.visibility)
  const head = has(LM.nose)
  const shoulders = has(LM.leftShoulder) && has(LM.rightShoulder)
  const leftHandVisible = has(LM.leftWrist) && has(LM.leftElbow)
  const rightHandVisible = has(LM.rightWrist) && has(LM.rightElbow)
  const bodyInFrame = head && shoulders
  if (!measures.raw || !shoulders || !measures.valid) {
    return { bodyInFrame: false, leftHandVisible, rightHandVisible, distance: 'unknown', roomToMove: false, hint: '请站到摄像头前，让上半身出现在画面里' }
  }
  // Image-normalised units: shoulder width along x is divided back by the aspect ratio.
  const shoulderWidthX = measures.shoulderWidth / measures.aspect
  const torsoY = measures.hipsValid ? measures.scale : null
  let distance: DistanceState = 'ok'
  if (shoulderWidthX > c.tooCloseShoulder || (torsoY !== null && torsoY > c.tooCloseTorso)) distance = 'too-close'
  else if (shoulderWidthX < c.tooFarShoulder || (torsoY !== null && torsoY < c.tooFarTorso)) distance = 'too-far'

  const arm = c.armPerShoulderWidth * measures.shoulderWidth
  const headroom = measures.origin.y - c.headroomFraction * arm >= -0.02
  const reachX = measures.shoulderWidth / 2 + c.sideRoomFraction * arm
  const leftRoom = measures.origin.x - reachX >= -0.02
  const rightRoom = measures.origin.x + reachX <= measures.aspect + 0.02
  const roomToMove = headroom && leftRoom && rightRoom

  let hint: string | null = null
  if (!head) hint = '请让头部也出现在画面里'
  else if (distance === 'too-close') hint = '请往后退一点'
  else if (!leftHandVisible && !rightHandVisible) hint = '请让双手出现在画面里'
  else if (!leftHandVisible || !rightHandVisible) hint = `请让${!leftHandVisible ? '左手' : '右手'}也出现在画面里`
  else if (!headroom) hint = '请再往后退一点，举手时手要留在画面里'
  else if (!leftRoom && !rightRoom) hint = '请往后退一点，两边留出伸手的空间'
  else if (!leftRoom) hint = '请往右边移一点'
  else if (!rightRoom) hint = '请往左边移一点'
  else if (distance === 'too-far') hint = '可以再靠近摄像头一点'
  return { bodyInFrame, leftHandVisible, rightHandVisible, distance, roomToMove, hint }
}

/** Debounces the shown framing state so hints do not flicker (pattern from v3 FramingAssistController). */
export class FramingController {
  private shown: FramingState = {
    bodyInFrame: false, leftHandVisible: false, rightHandVisible: false, distance: 'unknown', roomToMove: false,
    hint: '请站到摄像头前，让上半身出现在画面里', ready: false,
  }
  private candidate?: FramingState
  private candidateSince = 0

  reset(): void {
    this.candidate = undefined
    this.shown = { ...this.shown, ready: false }
  }

  update(measures: BodyMeasures, now: number): FramingState {
    const evaluated = evaluateFraming(measures)
    const next: FramingState = {
      ...evaluated,
      ready: evaluated.bodyInFrame && evaluated.leftHandVisible && evaluated.rightHandVisible
        && evaluated.distance !== 'too-close' && evaluated.roomToMove,
    }
    if (sameSignal(next, this.shown)) {
      this.candidate = undefined
      this.shown = next
      return next
    }
    if (!this.candidate || !sameSignal(next, this.candidate)) {
      this.candidate = next
      this.candidateSince = now
      return this.shown
    }
    const delay = next.ready ? FRAMING_CONFIG.recoveryDelayMs : FRAMING_CONFIG.enterDelayMs
    if (now - this.candidateSince >= delay) {
      this.shown = next
      this.candidate = undefined
    }
    return this.shown
  }
}

function sameSignal(a: FramingState, b: FramingState): boolean {
  return a.ready === b.ready && a.hint === b.hint && a.leftHandVisible === b.leftHandVisible
    && a.rightHandVisible === b.rightHandVisible && a.distance === b.distance && a.bodyInFrame === b.bodyInFrame
}
