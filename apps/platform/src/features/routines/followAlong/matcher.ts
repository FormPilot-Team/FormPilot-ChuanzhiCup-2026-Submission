import { angleDegrees, clamp, deriveBodyPoints, distance, torsoLeanDegrees } from '../../motion/geometry'
import type { PoseLandmark } from '../../pose/types'
import type { ReferenceTrack } from './referenceTrack'

/**
 * Follow-along comparison between the user's live pose and the standard video's pose at the same moment.
 *
 * Origin: the teammate's `videoReferenceMatcher` (torso-normalised points + joint angles, three body regions,
 * best match inside a time window around the video's current time, EMA smoothing). Changes made while
 * integrating it, each for a failure seen in the original:
 * - coordinates are aspect-corrected before normalising, so a 4:3 camera compares fairly with the 16:9 video;
 * - a region without visible landmarks is "unknown", not 0 — the original reported "mismatch" whenever the legs
 *   were out of view;
 * - joint angles are only used when all three landmarks are visible;
 * - the user may follow as in a mirror: the left/right-swapped pose is compared too and the better one counts;
 * - during holds many reference frames match equally well, and the original picked the first, which invented
 *   "too fast/too slow" offsets; near-best candidates now resolve to the one closest to the video time;
 * - following naturally lags the video a little, so "behind" tolerates 1 s while "ahead" tolerates 0.6 s.
 * Thresholds remain engineering values (not yet calibrated on recorded users).
 */
export const FOLLOW_ALONG_CONFIG = Object.freeze({
  version: 'follow-along-v1',
  searchWindowMs: 2500,
  aheadToleranceMs: 600,
  behindToleranceMs: 1000,
  mismatchSimilarity: 0.45,
  mismatchRegionScore: 0.35,
  minUserConfidence: 0.5,
  minReferenceConfidence: 0.5,
  minLandmarkVisibility: 0.5,
  smoothingAlpha: 0.25,
  smoothResetGapMs: 1000,
  tieBreakEpsilon: 0.02,
  pointScoreThreshold: 0.38,
  angleScoreThreshold: 0.3,
  regionWeights: Object.freeze({ arms: 0.4, torso: 0.3, legs: 0.3 }),
})

export type FollowAlongStatus = 'insufficient' | 'in_sync' | 'ahead' | 'behind' | 'mismatch'
export type FollowAlongRegion = 'arms' | 'torso' | 'legs'
export type FollowAlongRegionScores = Record<FollowAlongRegion, number | null>

export interface FollowAlongMatch {
  status: FollowAlongStatus
  /** Smoothed overall similarity, 0..1. */
  similarity: number
  /** Smoothed timing offset in ms: positive = the user is ahead of the video, negative = behind. */
  timingOffsetMs: number
  /** Reference time of the selected match, seconds. */
  matchedAt: number
  videoTime: number
  /** Region scores of the selected match (null when that region was not visible). */
  regionScores: FollowAlongRegionScores
  /** True when the left/right-mirrored pose matched better than the pose as seen. */
  mirrored: boolean
}

interface DescribedPoint {
  x: number
  y: number
  visibility: number
}

type AngleKey = 'leftShoulder' | 'rightShoulder' | 'leftElbow' | 'rightElbow' | 'leftHip' | 'rightHip' | 'leftKnee' | 'rightKnee' | 'torsoLean'

interface PoseDescriptor {
  points: Partial<Record<number, DescribedPoint>>
  angles: Partial<Record<AngleKey, number>>
}

const IDX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const

const POINT_INDICES: ReadonlyArray<number> = Object.values(IDX)

const MIRROR_INDEX: Readonly<Record<number, number>> = {
  [IDX.nose]: IDX.nose,
  [IDX.leftShoulder]: IDX.rightShoulder, [IDX.rightShoulder]: IDX.leftShoulder,
  [IDX.leftElbow]: IDX.rightElbow, [IDX.rightElbow]: IDX.leftElbow,
  [IDX.leftWrist]: IDX.rightWrist, [IDX.rightWrist]: IDX.leftWrist,
  [IDX.leftHip]: IDX.rightHip, [IDX.rightHip]: IDX.leftHip,
  [IDX.leftKnee]: IDX.rightKnee, [IDX.rightKnee]: IDX.leftKnee,
  [IDX.leftAnkle]: IDX.rightAnkle, [IDX.rightAnkle]: IDX.leftAnkle,
}

const MIRROR_ANGLE: Readonly<Record<AngleKey, AngleKey>> = {
  leftShoulder: 'rightShoulder', rightShoulder: 'leftShoulder',
  leftElbow: 'rightElbow', rightElbow: 'leftElbow',
  leftHip: 'rightHip', rightHip: 'leftHip',
  leftKnee: 'rightKnee', rightKnee: 'leftKnee',
  torsoLean: 'torsoLean',
}

export interface PosePointLike {
  x: number
  y: number
  visibility?: number
}

/**
 * Describes a pose in a torso-normalised frame: origin at the shoulder/hip centre, one unit = torso length.
 * `aspect` is the source image's width / height; x is scaled by it so distances and angles are in true proportions.
 */
export function describePose(landmarks: ReadonlyArray<PosePointLike>, aspect: number): PoseDescriptor | null {
  const at = (index: number): PoseLandmark | undefined => {
    const point = landmarks[index]
    return point ? { x: point.x * aspect, y: point.y, z: 0, visibility: point.visibility ?? 0 } : undefined
  }
  const ls = at(IDX.leftShoulder)
  const rs = at(IDX.rightShoulder)
  const lh = at(IDX.leftHip)
  const rh = at(IDX.rightHip)
  if (!ls || !rs || !lh || !rh) return null
  const body = deriveBodyPoints(ls, rs, lh, rh)
  if (!(body.torsoLength > 0)) return null
  const centerX = (body.shoulderMid.x + body.hipMid.x) / 2
  const centerY = (body.shoulderMid.y + body.hipMid.y) / 2
  const points: PoseDescriptor['points'] = {}
  for (const index of POINT_INDICES) {
    const point = at(index)
    if (point) points[index] = { x: (point.x - centerX) / body.torsoLength, y: (point.y - centerY) / body.torsoLength, visibility: point.visibility }
  }
  const visible = (point: PoseLandmark | undefined): point is PoseLandmark => Boolean(point && point.visibility >= FOLLOW_ALONG_CONFIG.minLandmarkVisibility)
  const angle = (a: number, joint: number, c: number): number | undefined => {
    const pa = at(a)
    const pj = at(joint)
    const pc = at(c)
    return visible(pa) && visible(pj) && visible(pc) ? angleDegrees(pa, pj, pc) : undefined
  }
  const angles: PoseDescriptor['angles'] = {
    leftShoulder: angle(IDX.leftHip, IDX.leftShoulder, IDX.leftElbow),
    rightShoulder: angle(IDX.rightHip, IDX.rightShoulder, IDX.rightElbow),
    leftElbow: angle(IDX.leftShoulder, IDX.leftElbow, IDX.leftWrist),
    rightElbow: angle(IDX.rightShoulder, IDX.rightElbow, IDX.rightWrist),
    leftHip: angle(IDX.leftShoulder, IDX.leftHip, IDX.leftKnee),
    rightHip: angle(IDX.rightShoulder, IDX.rightHip, IDX.rightKnee),
    leftKnee: angle(IDX.leftHip, IDX.leftKnee, IDX.leftAnkle),
    rightKnee: angle(IDX.rightHip, IDX.rightKnee, IDX.rightAnkle),
    torsoLean: torsoLeanDegrees(body.shoulderMid, body.hipMid),
  }
  return { points, angles }
}

/** The same pose seen in a mirror: left and right swap and x flips around the torso centre. */
export function mirrorDescriptor(descriptor: PoseDescriptor): PoseDescriptor {
  const points: PoseDescriptor['points'] = {}
  for (const index of POINT_INDICES) {
    const source = descriptor.points[MIRROR_INDEX[index]]
    if (source) points[index] = { x: -source.x, y: source.y, visibility: source.visibility }
  }
  const angles: PoseDescriptor['angles'] = {}
  for (const key of Object.keys(MIRROR_ANGLE) as AngleKey[]) angles[key] = descriptor.angles[MIRROR_ANGLE[key]]
  return { points, angles }
}

interface RegionSpec {
  pointIndices: ReadonlyArray<number>
  angleKeys: ReadonlyArray<AngleKey>
}

const REGIONS: Readonly<Record<FollowAlongRegion, RegionSpec>> = {
  arms: { pointIndices: [IDX.leftElbow, IDX.rightElbow, IDX.leftWrist, IDX.rightWrist], angleKeys: ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow'] },
  torso: { pointIndices: [IDX.nose, IDX.leftShoulder, IDX.rightShoulder, IDX.leftHip, IDX.rightHip], angleKeys: ['torsoLean'] },
  legs: { pointIndices: [IDX.leftKnee, IDX.rightKnee, IDX.leftAnkle, IDX.rightAnkle], angleKeys: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'] },
}

const REGION_NAMES: ReadonlyArray<FollowAlongRegion> = ['arms', 'torso', 'legs']

function regionScore(user: PoseDescriptor, reference: PoseDescriptor, spec: RegionSpec): number | null {
  const minVisibility = FOLLOW_ALONG_CONFIG.minLandmarkVisibility
  let pointSum = 0
  let pointCount = 0
  for (const index of spec.pointIndices) {
    const a = user.points[index]
    const b = reference.points[index]
    if (!a || !b || a.visibility < minVisibility || b.visibility < minVisibility) continue
    pointSum += distance(a, b)
    pointCount += 1
  }
  let angleSum = 0
  let angleCount = 0
  for (const key of spec.angleKeys) {
    const a = user.angles[key]
    const b = reference.angles[key]
    if (a === undefined || b === undefined) continue
    angleSum += Math.abs(a - b) / 180
    angleCount += 1
  }
  // A region counts as seen only through its visible landmarks; torso lean alone is always computable.
  if (pointCount === 0) return null
  const pointError = pointSum / pointCount
  const angleError = angleCount ? angleSum / angleCount : 0
  const pointWeight = 0.6
  const angleWeight = angleCount ? 0.4 : 0
  const error = (pointWeight * (pointError / FOLLOW_ALONG_CONFIG.pointScoreThreshold)
    + angleWeight * (angleError / FOLLOW_ALONG_CONFIG.angleScoreThreshold)) / (pointWeight + angleWeight)
  return clamp(1 - error, 0, 1)
}

export function comparePoses(user: PoseDescriptor, reference: PoseDescriptor): { similarity: number; regionScores: FollowAlongRegionScores } | null {
  const regionScores: FollowAlongRegionScores = { arms: null, torso: null, legs: null }
  let weighted = 0
  let weights = 0
  for (const name of REGION_NAMES) {
    const score = regionScore(user, reference, REGIONS[name])
    regionScores[name] = score
    if (score === null) continue
    weighted += FOLLOW_ALONG_CONFIG.regionWeights[name] * score
    weights += FOLLOW_ALONG_CONFIG.regionWeights[name]
  }
  if (weights === 0) return null
  return { similarity: weighted / weights, regionScores }
}

interface PreparedFrame {
  t: number
  descriptor: PoseDescriptor
}

export interface UserPoseInput {
  landmarks: ReadonlyArray<PosePointLike>
  confidence: number
  /** Camera image width / height. */
  aspect: number
}

export class FollowAlongMatcher {
  private readonly prepared: PreparedFrame[] = []
  private readonly duration: number
  private smoothedSimilarity?: number
  private smoothedOffsetMs?: number
  private lastEvaluatedAt?: number

  constructor(track: ReferenceTrack) {
    this.duration = track.duration
    const aspect = track.width / track.height
    for (const frame of track.frames) {
      if (frame.confidence < FOLLOW_ALONG_CONFIG.minReferenceConfidence) continue
      const descriptor = describePose(frame.landmarks, aspect)
      if (descriptor) this.prepared.push({ t: frame.t, descriptor })
    }
  }

  get frameCount(): number {
    return this.prepared.length
  }

  reset(): void {
    this.smoothedSimilarity = undefined
    this.smoothedOffsetMs = undefined
    this.lastEvaluatedAt = undefined
  }

  evaluate(user: UserPoseInput, videoTimeSeconds: number, now: number): FollowAlongMatch {
    const videoTime = clamp(videoTimeSeconds, 0, Math.max(this.duration - 0.01, 0))
    const insufficient: FollowAlongMatch = {
      status: 'insufficient',
      similarity: this.smoothedSimilarity ?? 0,
      timingOffsetMs: this.smoothedOffsetMs ?? 0,
      matchedAt: videoTime,
      videoTime,
      regionScores: { arms: null, torso: null, legs: null },
      mirrored: false,
    }
    if (!(user.confidence >= FOLLOW_ALONG_CONFIG.minUserConfidence) || !(user.aspect > 0)) return insufficient
    const direct = describePose(user.landmarks, user.aspect)
    if (!direct) return insufficient
    const mirrored = mirrorDescriptor(direct)

    const windowSeconds = FOLLOW_ALONG_CONFIG.searchWindowMs / 1000
    const candidates: Array<{ t: number; similarity: number; regionScores: FollowAlongRegionScores; mirrored: boolean }> = []
    let bestSimilarity = -1
    for (let index = this.firstIndexAtOrAfter(videoTime - windowSeconds); index < this.prepared.length; index += 1) {
      const reference = this.prepared[index]
      if (reference.t > videoTime + windowSeconds) break
      const asSeen = comparePoses(direct, reference.descriptor)
      const asMirror = comparePoses(mirrored, reference.descriptor)
      const pick = asMirror && (!asSeen || asMirror.similarity > asSeen.similarity + FOLLOW_ALONG_CONFIG.tieBreakEpsilon)
        ? { ...asMirror, mirrored: true }
        : asSeen ? { ...asSeen, mirrored: false } : undefined
      if (!pick) continue
      candidates.push({ t: reference.t, ...pick })
      if (pick.similarity > bestSimilarity) bestSimilarity = pick.similarity
    }
    if (!candidates.length) return insufficient

    // Near-best candidates are equally plausible; prefer the one closest to the video's own time.
    let best = candidates[0]
    for (const candidate of candidates) {
      if (candidate.similarity < bestSimilarity - FOLLOW_ALONG_CONFIG.tieBreakEpsilon) continue
      if (best.similarity < bestSimilarity - FOLLOW_ALONG_CONFIG.tieBreakEpsilon
        || Math.abs(candidate.t - videoTime) < Math.abs(best.t - videoTime)) best = candidate
    }

    const rawOffsetMs = (best.t - videoTime) * 1000
    const alpha = FOLLOW_ALONG_CONFIG.smoothingAlpha
    if (this.smoothedSimilarity === undefined || this.smoothedOffsetMs === undefined || this.lastEvaluatedAt === undefined
      || now - this.lastEvaluatedAt > FOLLOW_ALONG_CONFIG.smoothResetGapMs) {
      this.smoothedSimilarity = best.similarity
      this.smoothedOffsetMs = rawOffsetMs
    } else {
      this.smoothedSimilarity += alpha * (best.similarity - this.smoothedSimilarity)
      this.smoothedOffsetMs += alpha * (rawOffsetMs - this.smoothedOffsetMs)
    }
    this.lastEvaluatedAt = now

    const similarity = this.smoothedSimilarity
    const timingOffsetMs = this.smoothedOffsetMs
    const limbMismatch = (['arms', 'legs'] as const).some((region) => {
      const score = best.regionScores[region]
      return score !== null && score < FOLLOW_ALONG_CONFIG.mismatchRegionScore
    })
    const status: FollowAlongStatus = similarity < FOLLOW_ALONG_CONFIG.mismatchSimilarity || limbMismatch ? 'mismatch'
      : timingOffsetMs > FOLLOW_ALONG_CONFIG.aheadToleranceMs ? 'ahead'
        : timingOffsetMs < -FOLLOW_ALONG_CONFIG.behindToleranceMs ? 'behind'
          : 'in_sync'
    return { status, similarity, timingOffsetMs, matchedAt: best.t, videoTime, regionScores: best.regionScores, mirrored: best.mirrored }
  }

  private firstIndexAtOrAfter(seconds: number): number {
    let low = 0
    let high = this.prepared.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.prepared[middle].t < seconds) low = middle + 1
      else high = middle
    }
    return low
  }
}
