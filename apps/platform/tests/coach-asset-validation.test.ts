import squatAnchorJson from '../public/assets/coach-squat.pose.json'
import { describe, expect, it } from 'vitest'
import { SQUAT_REFERENCE } from '../src/features/referencePose/definitions'
import { validateSquatCoachAsset } from '../src/features/referencePose/coachAssetValidation'
import type { ReferencePose } from '../src/features/referencePose/types'

const acceptance = SQUAT_REFERENCE.coachAssetAcceptance.find((item) => item.canonicalPoseId === 'squat.BOTTOM')!
const validAnchor = squatAnchorJson as ReferencePose

function copyAnchor(edit: (copy: ReferencePose) => void): ReferencePose {
  const copy = structuredClone(validAnchor)
  edit(copy)
  return copy
}

describe('Squat CoachAssetAcceptance', () => {
  it('passes the detected, centered and coherent released coach pose', () => {
    const result = validateSquatCoachAsset(validAnchor, acceptance)
    expect(result.detectable).toBe(true)
    expect(result.canonicalSimilarityPassed).toBe(true)
    expect(result.failedChecks).toEqual([])
  })

  it('reports low pose confidence as a detectability failure', () => {
    const result = validateSquatCoachAsset(copyAnchor((pose) => { pose.poseConfidence = 0.5 }), acceptance)
    expect(result.detectable).toBe(false)
    expect(result.failedChecks).toContainEqual(expect.objectContaining({ gate: 'detectability', check: 'poseConfidence' }))
  })

  it('reports low required landmark visibility as a detectability failure', () => {
    const result = validateSquatCoachAsset(copyAnchor((pose) => { pose.landmarks.leftAnkle.visibility = 0.4 }), acceptance)
    expect(result.detectable).toBe(false)
    expect(result.failedChecks).toContainEqual(expect.objectContaining({ check: 'minimumRequiredLandmarkVisibility' }))
  })

  it('does not allow extreme knee spread to pass canonical similarity', () => {
    const result = validateSquatCoachAsset(copyAnchor((pose) => {
      pose.landmarks.leftKnee.x = 0.93
      pose.landmarks.rightKnee.x = 0.07
    }), acceptance)
    expect(result.detectable).toBe(true)
    expect(result.canonicalSimilarityPassed).toBe(false)
    expect(result.failedChecks).toContainEqual(expect.objectContaining({ check: 'kneeWidthShoulderRatio' }))
  })

  it('rejects an asymmetric pose without hiding the failing check', () => {
    const result = validateSquatCoachAsset(copyAnchor((pose) => { pose.landmarks.leftKnee.y += 0.2 }), acceptance)
    expect(result.canonicalSimilarityPassed).toBe(false)
    expect(result.failedChecks.some((failure) => failure.check === 'kneeHeightDiff' || failure.check === 'legSymmetryDiff')).toBe(true)
  })

  it('rejects a cropped full-body composition', () => {
    const result = validateSquatCoachAsset(copyAnchor((pose) => { pose.landmarks.rightAnkle.y = 1.02 }), acceptance)
    expect(result.detectable).toBe(false)
    expect(result.failedChecks).toContainEqual(expect.objectContaining({ check: 'fullBodyPresent' }))
  })
})
