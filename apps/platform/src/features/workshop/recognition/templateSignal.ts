import { angleDegrees, distance, torsoLeanDegrees } from '../../motion/geometry'
import type { NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import { LANDMARK_INDEX, type PoseLandmark } from '../../pose/types'
import type { FeatureTemplateId, RecognitionProfile } from '../types'
import { clamp, isFinitePoint } from './geometry'

/**
 * Per-frame signal of a feature template, ported from the workbench's generic motion adapter (`actionEnergy`). It is
 * computed in the raw normalised image space the workbench tuned its thresholds in. Temporal parts (neutral baseline,
 * hip drop against the ready pose, orbit travel, side switches) live in the recognizer.
 */
export interface TemplateSignal {
  /** The template's signal before any temporal baseline. */
  raw: number
  hipMidY: number
  torsoLength: number
  metrics: Record<string, number>
}

export function templateSignal(frame: NormalizedPoseFrame, profile: RecognitionProfile, templateId: FeatureTemplateId): TemplateSignal {
  const at = (index: number): PoseLandmark | undefined => frame.landmarks[index]
  const ok = (point: PoseLandmark | undefined): point is PoseLandmark => isFinitePoint(point)
  const torso = Number.isFinite(frame.body.torsoLength) ? Math.max(frame.body.torsoLength, 1e-6) : 1
  const shoulder = Number.isFinite(frame.body.shoulderWidth) ? Math.max(frame.body.shoulderWidth, 1e-6) : 1
  const hip = Number.isFinite(frame.body.hipWidth) ? Math.max(frame.body.hipWidth, shoulder * 0.55, 1e-6) : shoulder * 0.55
  const leftShoulder = at(LANDMARK_INDEX.leftShoulder)
  const rightShoulder = at(LANDMARK_INDEX.rightShoulder)
  const leftHip = at(LANDMARK_INDEX.leftHip)
  const rightHip = at(LANDMARK_INDEX.rightHip)
  const leftKnee = at(LANDMARK_INDEX.leftKnee)
  const rightKnee = at(LANDMARK_INDEX.rightKnee)
  const leftAnkle = at(LANDMARK_INDEX.leftAnkle)
  const rightAnkle = at(LANDMARK_INDEX.rightAnkle)
  const leftElbow = at(LANDMARK_INDEX.leftElbow)
  const rightElbow = at(LANDMARK_INDEX.rightElbow)
  const leftWrist = at(LANDMARK_INDEX.leftWrist)
  const rightWrist = at(LANDMARK_INDEX.rightWrist)

  const shouldersOk = ok(leftShoulder) && ok(rightShoulder)
  const hipsOk = ok(leftHip) && ok(rightHip)
  const anklesOk = ok(leftAnkle) && ok(rightAnkle)
  const armsOk = shouldersOk && hipsOk && ok(leftElbow) && ok(rightElbow) && ok(leftWrist) && ok(rightWrist)

  const leftShoulderAngle = armsOk ? angleDegrees(leftHip, leftShoulder, leftElbow) : 0
  const rightShoulderAngle = armsOk ? angleDegrees(rightHip, rightShoulder, rightElbow) : 0
  const leftElbowAngle = armsOk ? angleDegrees(leftShoulder, leftElbow, leftWrist) : 0
  const rightElbowAngle = armsOk ? angleDegrees(rightShoulder, rightElbow, rightWrist) : 0
  const armHeight = armsOk ? clamp(((leftShoulderAngle + rightShoulderAngle) / 2 - 18) / 78) : 0

  const leftFootOffset = hipsOk && anklesOk ? clamp(Math.abs(leftAnkle.x - leftHip.x) / hip) : 0
  const rightFootOffset = hipsOk && anklesOk ? clamp(Math.abs(rightAnkle.x - rightHip.x) / hip) : 0
  const lateralHip = hipsOk && anklesOk ? clamp((Math.max(leftFootOffset, rightFootOffset) - 0.1) / 0.9) : 0
  const ankleSpread = anklesOk ? clamp((distance(leftAnkle, rightAnkle) / hip - 0.75) / 1.25) : 0
  const shoulderTwist = shouldersOk && hipsOk
    ? clamp(Math.abs(leftShoulder.z - rightShoulder.z) / torso * 2 + Math.abs((rightShoulder.x - leftShoulder.x) / shoulder - (rightHip.x - leftHip.x) / hip) * 0.5)
    : 0

  const kneeAngle = (hipPoint?: PoseLandmark, kneePoint?: PoseLandmark, anklePoint?: PoseLandmark) =>
    ok(hipPoint) && ok(kneePoint) && ok(anklePoint) ? angleDegrees(hipPoint, kneePoint, anklePoint) : 180
  const kneeBendLeft = clamp((165 - kneeAngle(leftHip, leftKnee, leftAnkle)) / 80)
  const kneeBendRight = clamp((165 - kneeAngle(rightHip, rightKnee, rightAnkle)) / 80)
  const kneeBend = Math.max(kneeBendLeft, kneeBendRight)
  const kneeLiftLeft = ok(leftHip) && ok(leftKnee) ? clamp((leftHip.y - leftKnee.y) / torso) : 0
  const kneeLiftRight = ok(rightHip) && ok(rightKnee) ? clamp((rightHip.y - rightKnee.y) / torso) : 0

  // Knee motion projected on the shoulder-to-hip axis: image y alone fails when the body is horizontal.
  const kneeAxis = (knee?: PoseLandmark) => {
    if (!ok(knee) || !shouldersOk || !hipsOk) return 0
    const sx = (leftShoulder.x + rightShoulder.x) / 2
    const sy = (leftShoulder.y + rightShoulder.y) / 2
    const dx = (leftHip.x + rightHip.x) / 2 - sx
    const dy = (leftHip.y + rightHip.y) / 2 - sy
    const axis = Math.hypot(dx, dy) || 1
    const projection = ((knee.x - sx) * dx + (knee.y - sy) * dy) / axis
    return clamp(1 - projection / Math.max(torso * 1.65, 1e-6))
  }
  const kneeAxisLeft = kneeAxis(leftKnee)
  const kneeAxisRight = kneeAxis(rightKnee)

  const ankleHeights = [
    ok(leftKnee) && ok(leftAnkle) ? (leftKnee.y - leftAnkle.y) / torso : undefined,
    ok(rightKnee) && ok(rightAnkle) ? (rightKnee.y - rightAnkle.y) / torso : undefined,
  ].filter((value): value is number => value !== undefined && Number.isFinite(value))
  const ankleHeight = ankleHeights.length ? clamp(1 - ankleHeights.reduce((sum, value) => sum + Math.abs(value), 0) / ankleHeights.length) : 0

  const armElbowExtension = armsOk ? clamp((leftElbowAngle + rightElbowAngle) / 360) : 0
  const punch = (wrist: PoseLandmark | undefined, own: PoseLandmark | undefined) =>
    shouldersOk && ok(wrist) && ok(own) ? clamp((Math.abs(wrist.x - own.x) / shoulder) * clamp(1 - Math.abs(wrist.y - own.y) / torso / 1.25) / 1.2) : 0
  const leftPunch = punch(leftWrist, leftShoulder)
  const rightPunch = punch(rightWrist, rightShoulder)
  const wristHeight = shouldersOk && (ok(leftWrist) || ok(rightWrist))
    ? clamp(Math.max(
      ok(leftWrist) ? (leftShoulder.y - leftWrist.y) / torso + 0.05 : 0,
      ok(rightWrist) ? (rightShoulder.y - rightWrist.y) / torso + 0.05 : 0,
    ))
    : 0
  const orbit = (wrist: PoseLandmark | undefined, own: PoseLandmark | undefined) => ok(wrist) && ok(own) ? Math.atan2(wrist.y - own.y, wrist.x - own.x) : Number.NaN
  const leftOrbit = orbit(leftWrist, leftShoulder)
  const rightOrbit = orbit(rightWrist, rightShoulder)
  const wristOrbitAngle = Math.max(
    Number.isFinite(leftOrbit) ? Math.abs(leftOrbit) / Math.PI : 0,
    Number.isFinite(rightOrbit) ? Math.abs(rightOrbit) / Math.PI : 0,
  )
  const torsoLean = shouldersOk && hipsOk ? clamp(torsoLeanDegrees(frame.body.shoulderMid, frame.body.hipMid) / 75) : 0
  const elbowKneeDistance = ok(leftElbow) && ok(rightElbow) && ok(leftKnee) && ok(rightKnee)
    ? clamp(Math.min(distance(leftElbow, rightKnee) / torso, distance(rightElbow, leftKnee) / torso) / 2)
    : 0
  const cross = (wrist: PoseLandmark | undefined, own: PoseLandmark | undefined, other: PoseLandmark | undefined) =>
    shouldersOk && ok(wrist) && ok(own) && ok(other) ? clamp((Math.abs(wrist.x - own.x) - Math.abs(wrist.x - other.x)) / shoulder + 0.08) : 0
  const leftCross = cross(leftWrist, leftShoulder, rightShoulder)
  const rightCross = cross(rightWrist, rightShoulder, leftShoulder)

  let raw: number
  switch (templateId) {
    case 'arm-raise': raw = clamp(wristHeight * 0.8 + armElbowExtension * 0.2); break
    case 'arm-circle': raw = wristOrbitAngle; break
    case 'punch-horizontal': raw = Math.max(leftPunch, rightPunch); break
    case 'squat-depth': raw = clamp(kneeBend * 0.55); break
    case 'lunge-single-leg': raw = clamp(Math.max(kneeBend * 0.65 + Math.abs(kneeBendLeft - kneeBendRight) * 0.2, lateralHip * 0.75 + ankleSpread * 0.25)); break
    case 'toe-raise': raw = ankleHeight; break
    case 'seated-leg-raise': raw = Math.max(kneeLiftLeft, kneeLiftRight); break
    case 'core-flexion': raw = clamp(torsoLean * 0.55 + (1 - elbowKneeDistance) * 0.45); break
    case 'plank-shoulder-tap': raw = clamp(Math.max(Math.max(leftCross, rightCross) * 0.82, ankleSpread * 0.58)); break
    case 'mountain-climber': raw = Math.max(kneeAxisLeft, kneeAxisRight); break
    case 'stretch-hold': raw = clamp(Math.max(armHeight, torsoLean, ankleSpread)); break
    default:
      raw = profile === 'hip-lateral' ? clamp(lateralHip * 0.7 + ankleSpread * 0.3)
        : profile === 'hip-rotation' ? shoulderTwist
          : profile === 'lower-body' ? 0
            : profile === 'upper-body' ? armHeight
              : clamp(armHeight * 0.7 + ankleSpread * 0.3)
  }

  const hipMidY = Number.isFinite(frame.body.hipMid.y) ? frame.body.hipMid.y : 0
  return {
    raw,
    hipMidY,
    torsoLength: torso,
    metrics: {
      armHeight, wristHeight, kneeBend, ankleSpread, lateralHip, shoulderTwist, torsoLean,
      leftOrbitAngle: Number.isFinite(leftOrbit) ? leftOrbit : 0,
      rightOrbitAngle: Number.isFinite(rightOrbit) ? rightOrbit : 0,
      leftOrbitValid: Number.isFinite(leftOrbit) ? 1 : 0,
      rightOrbitValid: Number.isFinite(rightOrbit) ? 1 : 0,
      punchExtension: Math.max(leftPunch, rightPunch),
      punchSide: leftPunch >= rightPunch ? 0 : 1,
      punchAsymmetry: Math.abs(leftPunch - rightPunch),
      plankCross: Math.max(leftCross, rightCross),
      plankSide: leftCross >= rightCross ? 0 : 1,
    },
  }
}
