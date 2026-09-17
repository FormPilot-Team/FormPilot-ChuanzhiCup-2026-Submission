import { describe, expect, it } from 'vitest'
import { mapCoachHighlightAnchors } from '../src/features/coach/poseAnchorMapping'
import type { ReferencePose } from '../src/features/referencePose/types'

const p = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 })
const pose = {
  schemaVersion: 1,
  asset: '/coach.png',
  image: { width: 1000, height: 1600 },
  canonicalPoseId: 'lateral_raise.TOP',
  detector: 'MediaPipe Pose Landmarker Lite',
  capturedAt: '2026-09-09',
  landmarks: {
    nose: p(.5, .1),
    leftShoulder: p(.4, .3), rightShoulder: p(.6, .3),
    leftElbow: p(.3, .4), rightElbow: p(.7, .4),
    leftWrist: p(.2, .5), rightWrist: p(.8, .5),
    leftHip: p(.45, .6), rightHip: p(.55, .6),
    leftKnee: p(.4, .8), rightKnee: p(.6, .8),
  },
} as ReferencePose

describe('Coach pose-anchor mapping', () => {
  it('uses the normalized right elbow anchor', () => {
    expect(mapCoachHighlightAnchors(pose, 'right_elbow')).toEqual([{ x: .7, y: .4, direction: undefined }])
  })

  it('uses the normalized left knee anchor', () => {
    expect(mapCoachHighlightAnchors(pose, 'left_knee', 'up')).toEqual([{ x: .4, y: .8, direction: 'up' }])
  })

  it('derives hip depth from hipMid', () => {
    expect(mapCoachHighlightAnchors(pose, 'hip_depth', 'down')).toEqual([{ x: .5, y: .6, direction: 'down' }])
  })

  it('derives core from the shoulderMid/hipMid midpoint', () => {
    const [anchor] = mapCoachHighlightAnchors(pose, 'core')
    expect(anchor.x).toBeCloseTo(.5)
    expect(anchor.y).toBeCloseTo(.45)
  })

  it('falls back gracefully when the pose anchor is missing', () => {
    expect(mapCoachHighlightAnchors(undefined, 'right_elbow')).toEqual([])
    expect(mapCoachHighlightAnchors(pose, 'none')).toEqual([])
  })
})
