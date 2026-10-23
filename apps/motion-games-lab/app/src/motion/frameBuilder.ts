// Raw landmarks → body-space MotionFrame. Quality is judged on RAW points first (Phase 0 audit:
// "reject on raw, then smooth"); only accepted points are filtered. Filters are per body part and
// reset when that part loses quality, so a recovered hand does not drag an old position along.
import type { MotionFrame, Point, Side, SkeletonJoint, SkeletonPose } from './contracts'
import { PoseFilter } from './vendor/PoseFilter'
import type { PoseLandmark } from './vendor/poseTypes'
import type { RawPoseSample } from './poseSource'

export const LM = {
  nose: 0, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
} as const

/** Engineering parameters of this lab (not paper or clinical values). */
export const FRAME_CONFIG = Object.freeze({
  minVisibility: 0.6,
  minWristVisibility: 0.55,
  edgeMargin: 0.01,
  /** wrist faster than this (torso lengths / second) in one frame is treated as a detection jump */
  maxWristSpeed: 7,
  /** shoulder width / torso length used before hips have been seen */
  defaultShoulderToTorso: 0.75,
  filter: { medianWindow: 3, emaAlpha: 0.5 },
  /** palm centre ≈ wrist + this × (wrist − elbow); a forearm is ~3× a palm-centre offset */
  handExtend: 0.3,
})

/** Palm-centre estimate from the elbow → wrist direction (see MotionFrame.leftHand). */
export function handPoint(elbow: Point, wrist: Point, extend: number = FRAME_CONFIG.handExtend): Point {
  return { x: wrist.x + (wrist.x - elbow.x) * extend, y: wrist.y + (wrist.y - elbow.y) * extend }
}

const CORE = [LM.nose, LM.leftEar, LM.rightEar, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip] as const
const ARM: Record<Side, readonly [number, number]> = { left: [LM.leftElbow, LM.leftWrist], right: [LM.rightElbow, LM.rightWrist] }

export interface BodyMeasures {
  valid: boolean
  hipsValid: boolean
  /** shoulder midpoint, mirrored aspect-corrected image units */
  origin: Point
  /** torso length in the same units (from hips, or estimated from shoulder width) */
  scale: number
  shoulderWidth: number
  aspect: number
  /** signed lean of the torso axis from vertical (deg, + = shoulders toward screen right); null without hips */
  leanDeg: number | null
  /** signed tilt of the shoulder line (deg, + = screen-right shoulder lower) */
  shoulderTiltDeg: number
  /** (shoulder.y − ear.y) / shoulderWidth per side, null when the ear is not visible */
  earGap: Record<Side, number | null>
  /** raw normalised (unmirrored) landmarks, for framing checks */
  raw: ReadonlyArray<PoseLandmark> | null
  rawValid: (index: number, minVisibility?: number) => boolean
}

export interface BuiltFrame {
  frame: MotionFrame
  measures: BodyMeasures
}

export function pointValid(point: PoseLandmark | undefined, minVisibility: number, margin: number = FRAME_CONFIG.edgeMargin): point is PoseLandmark {
  return Boolean(point)
    && Number.isFinite(point!.x) && Number.isFinite(point!.y) && Number.isFinite(point!.visibility)
    && point!.visibility >= minVisibility
    && (point!.presence === undefined || point!.presence >= minVisibility)
    && point!.x >= margin && point!.x <= 1 - margin && point!.y >= margin && point!.y <= 1 - margin
}

const EMPTY_POSTURE = { torsoLean: false, shrug: false, shrugSide: null, leanDegrees: null, shrugRatio: { left: null, right: null } }
const EMPTY_FRAMING = { bodyInFrame: false, leftHandVisible: false, rightHandVisible: false, distance: 'unknown' as const, roomToMove: false, hint: null, ready: false }

export class FrameBuilder {
  private readonly coreFilter = new PoseFilter(FRAME_CONFIG.filter)
  private readonly armFilters: Record<Side, PoseFilter> = { left: new PoseFilter(FRAME_CONFIG.filter), right: new PoseFilter(FRAME_CONFIG.filter) }
  private shoulderToTorso: number = FRAME_CONFIG.defaultShoulderToTorso
  private previousWrist: Record<Side, { at: number; point: Point } | undefined> = { left: undefined, right: undefined }
  private coreValid = false
  private armValid: Record<Side, boolean> = { left: false, right: false }

  constructor(private readonly source: 'camera' | 'synthetic') {}

  reset(): void {
    this.coreFilter.reset()
    this.armFilters.left.reset()
    this.armFilters.right.reset()
    this.previousWrist = { left: undefined, right: undefined }
    this.coreValid = false
    this.armValid = { left: false, right: false }
  }

  build(sample: RawPoseSample): BuiltFrame {
    const aspect = sample.imageWidth > 0 && sample.imageHeight > 0 ? sample.imageWidth / sample.imageHeight : 16 / 9
    const raw = sample.landmarks
    const rawValid = (index: number, minVisibility: number = FRAME_CONFIG.minVisibility) => pointValid(raw?.[index], minVisibility)
    const frame: MotionFrame = {
      timestamp: sample.frameTime,
      confidence: 0,
      tracking: { body: false, left: false, right: false },
      posture: { ...EMPTY_POSTURE, shrugRatio: { left: null, right: null } },
      framing: { ...EMPTY_FRAMING },
      source: this.source,
    }
    const measures: BodyMeasures = {
      valid: false, hipsValid: false, origin: { x: 0, y: 0 }, scale: 0, shoulderWidth: 0, aspect,
      leanDeg: null, shoulderTiltDeg: 0, earGap: { left: null, right: null }, raw, rawValid,
    }
    if (!raw) {
      this.reset()
      return { frame, measures }
    }
    frame.skeleton = skeletonOf(raw, aspect)
    frame.confidence = meanVisibility(raw)

    if (!rawValid(LM.leftShoulder) || !rawValid(LM.rightShoulder)) {
      this.reset()
      return { frame, measures }
    }
    if (!this.coreValid) this.coreFilter.reset()
    this.coreValid = true
    const core = this.coreFilter.push({ timestamp: sample.timestamp, confidence: 1, landmarks: CORE.map((i) => raw[i]) })
    const iso = (p: PoseLandmark): Point => ({ x: (1 - p.x) * aspect, y: p.y })
    const at = (i: number) => iso(core.landmarks[CORE.indexOf(i as (typeof CORE)[number])])
    const ls = at(LM.leftShoulder)
    const rs = at(LM.rightShoulder)
    const origin = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
    const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y)
    if (shoulderWidth < 0.02) {
      this.reset()
      return { frame, measures }
    }
    const hipsValid = rawValid(LM.leftHip, 0.5) && rawValid(LM.rightHip, 0.5)
    let scale = shoulderWidth / this.shoulderToTorso
    let leanDeg: number | null = null
    if (hipsValid) {
      const lh = at(LM.leftHip)
      const rh = at(LM.rightHip)
      const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
      const torso = Math.hypot(origin.x - hipMid.x, origin.y - hipMid.y)
      if (torso > shoulderWidth * 0.6) {
        scale = torso
        this.shoulderToTorso += 0.05 * (shoulderWidth / torso - this.shoulderToTorso)
        leanDeg = (Math.atan2(origin.x - hipMid.x, hipMid.y - origin.y) * 180) / Math.PI
      }
    }
    // Screen-left/right shoulders after mirroring: the anatomical left shoulder is normally screen-left.
    const [screenLeft, screenRight] = ls.x <= rs.x ? [ls, rs] : [rs, ls]
    const shoulderTiltDeg = (Math.atan2(screenRight.y - screenLeft.y, screenRight.x - screenLeft.x) * 180) / Math.PI
    const earGap = { left: null as number | null, right: null as number | null }
    for (const side of ['left', 'right'] as const) {
      const ear = side === 'left' ? LM.leftEar : LM.rightEar
      if (rawValid(ear, 0.5)) earGap[side] = ((side === 'left' ? ls.y : rs.y) - at(ear).y) / shoulderWidth
    }
    const toBody = (p: Point): Point => ({ x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale })
    Object.assign(measures, { valid: true, hipsValid, origin, scale, shoulderWidth, leanDeg, shoulderTiltDeg, earGap })
    frame.tracking.body = true
    frame.leftShoulder = toBody(ls)
    frame.rightShoulder = toBody(rs)

    for (const side of ['left', 'right'] as const) {
      const [elbowIndex, wristIndex] = ARM[side]
      const ok = rawValid(elbowIndex) && rawValid(wristIndex, FRAME_CONFIG.minWristVisibility)
      if (!ok) {
        this.armFilters[side].reset()
        this.armValid[side] = false
        this.previousWrist[side] = undefined
        continue
      }
      // Jump rejection on the raw wrist, in body units per second.
      const rawWrist = toBody(iso(raw[wristIndex]))
      const previous = this.previousWrist[side]
      this.previousWrist[side] = { at: sample.timestamp, point: rawWrist }
      if (previous) {
        const dt = (sample.timestamp - previous.at) / 1000
        const speed = dt > 0 ? Math.hypot(rawWrist.x - previous.point.x, rawWrist.y - previous.point.y) / dt : 0
        if (dt > 0 && dt < 0.25 && speed > FRAME_CONFIG.maxWristSpeed) continue
      }
      if (!this.armValid[side]) this.armFilters[side].reset()
      this.armValid[side] = true
      const arm = this.armFilters[side].push({ timestamp: sample.timestamp, confidence: 1, landmarks: [raw[elbowIndex], raw[wristIndex]] })
      const elbow = toBody(iso(arm.landmarks[0]))
      const wrist = toBody(iso(arm.landmarks[1]))
      const hand = handPoint(elbow, wrist)
      if (side === 'left') {
        frame.leftElbow = elbow
        frame.leftWrist = wrist
        frame.leftHand = hand
      } else {
        frame.rightElbow = elbow
        frame.rightWrist = wrist
        frame.rightHand = hand
      }
      frame.tracking[side] = true
    }
    return { frame, measures }
  }
}

function meanVisibility(raw: ReadonlyArray<PoseLandmark>): number {
  const indices = [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist]
  return indices.reduce((sum, i) => sum + (Number.isFinite(raw[i]?.visibility) ? raw[i].visibility : 0), 0) / indices.length
}

const SKELETON_INDEX: Record<SkeletonJoint, number> = {
  nose: LM.nose, leftEar: LM.leftEar, rightEar: LM.rightEar,
  leftShoulder: LM.leftShoulder, rightShoulder: LM.rightShoulder, leftElbow: LM.leftElbow, rightElbow: LM.rightElbow,
  leftWrist: LM.leftWrist, rightWrist: LM.rightWrist, leftHip: LM.leftHip, rightHip: LM.rightHip,
}

function skeletonOf(raw: ReadonlyArray<PoseLandmark>, aspect: number): SkeletonPose {
  const points: SkeletonPose['points'] = {}
  for (const [joint, index] of Object.entries(SKELETON_INDEX) as [SkeletonJoint, number][]) {
    const p = raw[index]
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    points[joint] = { x: 1 - p.x, y: p.y, visible: pointValid(p, 0.5, -1) }
  }
  return { points, aspect }
}
