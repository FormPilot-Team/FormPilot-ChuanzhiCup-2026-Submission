import { distance, midpoint, torsoLeanDegrees } from '../motion/geometry'
import { SQUAT_REQUIRED, type LandmarkName } from '../pose/types'
import type {
  CoachAssetAcceptance,
  CoachAssetValidationFailure,
  CoachAssetValidationResult,
  ReferenceMetricKey,
  ReferencePose,
} from './types'

const FULL_BODY_LANDMARKS: ReadonlyArray<LandmarkName> = ['nose', ...SQUAT_REQUIRED]
const LEFT_RIGHT_PAIRS: ReadonlyArray<readonly [LandmarkName, LandmarkName]> = [
  ['leftShoulder', 'rightShoulder'],
  ['leftHip', 'rightHip'],
  ['leftKnee', 'rightKnee'],
  ['leftAnkle', 'rightAnkle'],
]

function inRange(value: number, min?: number, max?: number): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max)
}

function expectedRange(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `${min}–${max}`
  if (min !== undefined) return `>= ${min}`
  return `<= ${max}`
}

export function measureCoachAsset(
  pose: ReferencePose,
  fullBodyMargin = 0.02,
): Readonly<Record<string, number | boolean>> {
  const at = (name: LandmarkName) => pose.landmarks[name]
  const shoulderMid = midpoint(at('leftShoulder'), at('rightShoulder'))
  const hipMid = midpoint(at('leftHip'), at('rightHip'))
  const kneeMid = midpoint(at('leftKnee'), at('rightKnee'))
  const shoulderWidth = Math.max(distance(at('leftShoulder'), at('rightShoulder')), 1e-8)
  const hipWidth = Math.max(distance(at('leftHip'), at('rightHip')), 1e-8)
  const kneeWidth = distance(at('leftKnee'), at('rightKnee'))
  const ankleWidth = distance(at('leftAnkle'), at('rightAnkle'))
  const torsoLength = Math.max(distance(shoulderMid, hipMid), 1e-8)
  const leftLegLength = distance(at('leftHip'), at('leftKnee')) + distance(at('leftKnee'), at('leftAnkle'))
  const rightLegLength = distance(at('rightHip'), at('rightKnee')) + distance(at('rightKnee'), at('rightAnkle'))
  const requiredVisibilities = SQUAT_REQUIRED.map((name) => at(name).visibility)
  const allVisibilities = Object.values(pose.landmarks).map((point) => point.visibility)
  const visibilityDiff = Math.max(...LEFT_RIGHT_PAIRS.map(([left, right]) => Math.abs(at(left).visibility - at(right).visibility)))
  const fullBodyPresent = FULL_BODY_LANDMARKS.every((name) => {
    const point = at(name)
    return point.x >= fullBodyMargin && point.x <= 1 - fullBodyMargin
      && point.y >= fullBodyMargin && point.y <= 1 - fullBodyMargin
  })

  return Object.freeze({
    poseConfidence: pose.poseConfidence ?? allVisibilities.reduce((sum, value) => sum + value, 0) / allVisibilities.length,
    minimumRequiredLandmarkVisibility: Math.min(...requiredVisibilities),
    fullBodyPresent,
    leftRightVisibilityDiff: visibilityDiff,
    kneeSpreadRatio: kneeWidth / hipWidth,
    kneeWidthShoulderRatio: kneeWidth / shoulderWidth,
    ankleWidthShoulderRatio: ankleWidth / shoulderWidth,
    kneeAnkleHorizontalOffset:
      (Math.abs(at('leftKnee').x - at('leftAnkle').x) + Math.abs(at('rightKnee').x - at('rightAnkle').x)) /
      (2 * shoulderWidth),
    legSymmetryDiff: Math.abs(leftLegLength - rightLegLength) / Math.max((leftLegLength + rightLegLength) / 2, 1e-8),
    hipKneeSeparation: (kneeMid.y - hipMid.y) / torsoLength,
    kneeHeightDiff: Math.abs(at('leftKnee').y - at('rightKnee').y) / torsoLength,
    torsoLean: torsoLeanDegrees(shoulderMid, hipMid),
    torsoCenterOffset: Math.abs((shoulderMid.x + hipMid.x) / 2 - 0.5) / shoulderWidth,
    leftKneeHeight: (at('leftHip').y - at('leftKnee').y) / torsoLength,
    rightKneeHeight: (at('rightHip').y - at('rightKnee').y) / torsoLength,
    hipShift: Math.abs(hipMid.x - 0.5) / shoulderWidth,
  })
}

export function validateCoachAsset(
  pose: ReferencePose,
  acceptance: CoachAssetAcceptance,
): CoachAssetValidationResult {
  const detectability = acceptance.detectability
  if (!detectability) throw new Error('Squat CoachAssetAcceptance requires a detectability gate')
  const metrics = measureCoachAsset(pose, detectability.fullBodyMargin)
  const failedChecks: CoachAssetValidationFailure[] = []

  const detectabilityChecks: ReadonlyArray<[string, number | boolean, boolean, string]> = [
    ['poseConfidence', metrics.poseConfidence, Number(metrics.poseConfidence) >= detectability.minimumPoseConfidence, `>= ${detectability.minimumPoseConfidence}`],
    ['minimumRequiredLandmarkVisibility', metrics.minimumRequiredLandmarkVisibility, Number(metrics.minimumRequiredLandmarkVisibility) >= detectability.minimumRequiredLandmarkVisibility, `>= ${detectability.minimumRequiredLandmarkVisibility}`],
    ['fullBodyPresent', metrics.fullBodyPresent, metrics.fullBodyPresent === true, `inside ${detectability.fullBodyMargin}–${1 - detectability.fullBodyMargin} normalized bounds`],
    ['leftRightVisibilityDiff', metrics.leftRightVisibilityDiff, Number(metrics.leftRightVisibilityDiff) <= detectability.maximumLeftRightVisibilityDiff, `<= ${detectability.maximumLeftRightVisibilityDiff}`],
  ]
  for (const [check, actual, passed, expected] of detectabilityChecks) {
    if (!passed) failedChecks.push({ gate: 'detectability', check, actual, expected })
  }

  for (const range of acceptance.metrics) {
    const actual = Number(metrics[range.key as ReferenceMetricKey])
    if (!Number.isFinite(actual) || !inRange(actual, range.min, range.max)) {
      failedChecks.push({
        gate: 'canonical_similarity',
        check: range.key,
        actual,
        expected: expectedRange(range.min, range.max),
      })
    }
  }

  return Object.freeze({
    detectable: !failedChecks.some((failure) => failure.gate === 'detectability'),
    canonicalSimilarityPassed: !failedChecks.some((failure) => failure.gate === 'canonical_similarity'),
    metrics,
    failedChecks: Object.freeze(failedChecks),
  })
}

/** Backward-compatible Phase 3 names; new callers use the exercise-neutral APIs. */
export const measureSquatCoachAsset = measureCoachAsset
export const validateSquatCoachAsset = validateCoachAsset
