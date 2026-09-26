import { describe, expect, it } from 'vitest'
import { encodeReferenceFrame, parseReferenceTrack, REFERENCE_TRACK_SCHEMA_VERSION } from '../src/features/routines/followAlong/referenceTrack'
import { comparePoses, describePose, FOLLOW_ALONG_CONFIG, FollowAlongMatcher, mirrorDescriptor } from '../src/features/routines/followAlong/matcher'
import {
  alternatingPose, asFourByThree, standingPose, swingingPose, trackOf, withArmRaised, withLegsHidden, type Pose,
} from './helpers/routineFixtures'

const WIDE = 16 / 9

function user(pose: Pose, aspect = WIDE, confidence = 0.95) {
  return { landmarks: pose, confidence, aspect }
}

/** Feeds the matcher at 10 Hz from `from` to `to` (video seconds) and returns the last result. */
function follow(matcher: FollowAlongMatcher, poseAt: (videoTime: number) => Pose, from: number, to: number, aspect = WIDE) {
  let last = matcher.evaluate(user(poseAt(from), aspect), from, from * 1000)
  for (let time = from + 0.1; time <= to + 1e-9; time += 0.1) last = matcher.evaluate(user(poseAt(time), aspect), time, time * 1000)
  return last
}

describe('reference track format', () => {
  it('round-trips encoded frames and rejects malformed tracks', () => {
    const pose = standingPose()
    const raw = {
      schemaVersion: REFERENCE_TRACK_SCHEMA_VERSION, asset: '/a.mp4', duration: 1, fps: 10, width: 640, height: 360, landmarkCount: 33,
      frames: [encodeReferenceFrame(0.1, 0.95, pose), [0, 0], encodeReferenceFrame(0.2, 0, pose), ['bad'], 'x'],
    }
    const track = parseReferenceTrack(raw)
    expect(track?.frames.map((frame) => [frame.t, frame.confidence])).toEqual([[0, 0], [0.1, 0.95], [0.2, 0]])
    expect(track?.frames[1].landmarks[11]).toEqual({ x: 0.54, y: 0.3, visibility: 0.98 })
    expect(parseReferenceTrack({ ...raw, schemaVersion: 1 })).toBeUndefined()
    expect(parseReferenceTrack({ ...raw, landmarkCount: 17 })).toBeUndefined()
    expect(parseReferenceTrack({ ...raw, frames: [[0, 0]] })).toBeUndefined()
    expect(parseReferenceTrack(null)).toBeUndefined()
  })
})

describe('follow-along matcher', () => {
  it('scores a user who mirrors the video in time as in sync and near-identical', () => {
    const matcher = new FollowAlongMatcher(trackOf(swingingPose, 20))
    const result = follow(matcher, swingingPose, 5, 8)
    expect(result.status).toBe('in_sync')
    expect(result.similarity).toBeGreaterThan(0.97)
    expect(Math.abs(result.timingOffsetMs)).toBeLessThan(150)
    expect(result.regionScores.arms).toBeGreaterThan(0.95)
  })

  it('reports ahead and behind beyond the asymmetric tolerance, and tolerates a natural lag', () => {
    // A slow sweep, so every posture occurs once. (In a pure back-and-forth motion a single frame cannot tell
    // "2 s ahead" from "2 s behind"; that is a known limit of frame-by-frame matching.)
    const sweep = (t: number) => withArmRaised(withArmRaised(standingPose(), 'left', 10 + 8 * t), 'right', 10 + 8 * t)
    const track = trackOf(sweep, 20)
    expect(follow(new FollowAlongMatcher(track), (t) => sweep(t + 2), 5, 10).status).toBe('ahead')
    expect(follow(new FollowAlongMatcher(track), (t) => sweep(t - 1.8), 5, 10).status).toBe('behind')
    const lagging = follow(new FollowAlongMatcher(track), (t) => sweep(t - 0.7), 5, 10)
    expect(lagging.status).toBe('in_sync')
    expect(lagging.timingOffsetMs).toBeLessThan(0)
    expect(FOLLOW_ALONG_CONFIG.behindToleranceMs).toBeGreaterThan(FOLLOW_ALONG_CONFIG.aheadToleranceMs)
  })

  it('does not invent a timing offset while the video holds a posture', () => {
    const held = withArmRaised(withArmRaised(standingPose(), 'left', 170), 'right', 170)
    const result = follow(new FollowAlongMatcher(trackOf(() => held, 12)), () => held, 5, 7)
    expect(result.status).toBe('in_sync')
    expect(result.timingOffsetMs).toBeCloseTo(0, 6)
  })

  it('accepts a user who follows as in a mirror', () => {
    const matcher = new FollowAlongMatcher(trackOf(alternatingPose, 20))
    const mirroredUser = (t: number) => {
      // The user raises the opposite arm to the one the demonstrator raises.
      const phase = (2 * Math.PI * t) / 6
      return withArmRaised(withArmRaised(standingPose(), 'right', 90 + 80 * Math.sin(phase)), 'left', 90 - 80 * Math.sin(phase))
    }
    const result = follow(matcher, mirroredUser, 4, 7)
    expect(result.mirrored).toBe(true)
    expect(result.status).toBe('in_sync')
    expect(result.similarity).toBeGreaterThan(0.95)
    const direct = describePose(mirroredUser(5), WIDE)
    const reference = describePose(alternatingPose(5), WIDE)
    expect(direct && reference).toBeTruthy()
    const asSeen = comparePoses(direct!, reference!)?.similarity ?? 0
    const asMirror = comparePoses(mirrorDescriptor(direct!), reference!)?.similarity ?? 0
    expect(asMirror).toBeGreaterThan(asSeen)
  })

  it('flags a clearly different arm position as a mismatch', () => {
    const reference = withArmRaised(withArmRaised(standingPose(), 'left', 170), 'right', 170)
    const result = follow(new FollowAlongMatcher(trackOf(() => reference, 12)), () => standingPose(), 5, 7)
    expect(result.status).toBe('mismatch')
    expect(result.regionScores.arms).toBeLessThan(FOLLOW_ALONG_CONFIG.mismatchRegionScore)
  })

  it('treats hidden legs as unknown rather than as a mismatch', () => {
    const matcher = new FollowAlongMatcher(trackOf(swingingPose, 20))
    const result = follow(matcher, (t) => withLegsHidden(swingingPose(t)), 5, 7)
    expect(result.regionScores.legs).toBeNull()
    expect(result.status).toBe('in_sync')
    expect(result.similarity).toBeGreaterThan(0.95)
  })

  it('compares a 4:3 camera fairly with the 16:9 video', () => {
    const matcher = new FollowAlongMatcher(trackOf(swingingPose, 20))
    const corrected = follow(matcher, (t) => asFourByThree(swingingPose(t)), 5, 7, 4 / 3)
    expect(corrected.similarity).toBeGreaterThan(0.97)
    const uncorrected = follow(new FollowAlongMatcher(trackOf(swingingPose, 20)), (t) => asFourByThree(swingingPose(t)), 5, 7, WIDE)
    expect(uncorrected.similarity).toBeLessThan(corrected.similarity)
  })

  it('returns insufficient for unreliable poses and skips unreliable reference frames', () => {
    const matcher = new FollowAlongMatcher(trackOf((t) => (t >= 4 && t <= 12 ? null : swingingPose(t)), 20))
    expect(matcher.evaluate(user(swingingPose(2), WIDE, 0.2), 2, 2000).status).toBe('insufficient')
    expect(matcher.evaluate(user(swingingPose(8)), 8, 8000).status).toBe('insufficient')
    expect(matcher.frameCount).toBe(201 - 81)
    expect(matcher.evaluate(user([]), 2, 2000).status).toBe('insufficient')
  })

  it('smooths similarity and restarts smoothing after a gap', () => {
    const reference = withArmRaised(withArmRaised(standingPose(), 'left', 170), 'right', 170)
    const matcher = new FollowAlongMatcher(trackOf(() => reference, 12))
    matcher.evaluate(user(reference), 5, 5000)
    const dipped = matcher.evaluate(user(standingPose()), 5.1, 5100)
    expect(dipped.similarity).toBeGreaterThan(0.6)
    const afterGap = matcher.evaluate(user(standingPose()), 7, 7000)
    expect(afterGap.similarity).toBeLessThan(dipped.similarity)
    matcher.reset()
    expect(matcher.evaluate(user(reference), 8, 8000).similarity).toBeGreaterThan(0.97)
  })
})
