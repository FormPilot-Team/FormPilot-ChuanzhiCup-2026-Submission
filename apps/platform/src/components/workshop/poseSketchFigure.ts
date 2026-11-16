import type { LandmarkName } from '../../features/pose/types'
import { bodyCoords, type BodyCoords } from '../../features/workshop/recognition/poseMatch'
import { length, sub, type Vec2 } from '../../features/workshop/recognition/geometry'
import type { CapturedPose } from '../../features/workshop/types'

/**
 * Geometry of the small figure that shows a saved custom action (cards, home strip, editor, training panel).
 *
 * The figure is drawn from the recorded landmarks, but as a pictogram: every limb keeps the direction it had in the
 * demonstration, while lengths and widths come from standard human proportions. Raw landmarks drawn one-to-one looked
 * distorted at icon size: MediaPipe's hip points sit on the hip joints (so a wide shoulder bar narrowed into a funnel),
 * there was no head, camera perspective shortened legs and arms, and a single bad point produced a broken limb.
 *
 * This module only reads the captured pose. It never changes the landmarks the recognizer uses.
 */

/** Standard pictogram proportions in torso lengths (shoulder midpoint → hip midpoint = 1), after anthropometric tables. */
export const SKETCH_PROPORTIONS = Object.freeze({
  upperArm: 0.64,
  forearm: 0.56,
  thigh: 0.86,
  shin: 0.84,
  shoulderWidth: 0.8,
  /** Drawn hip width relative to the drawn shoulder width (pelvis outline, not the narrower hip joints). */
  hipToShoulder: 0.62,
  /** Head centre above the shoulder midpoint, along the torso axis. */
  headOffset: 0.42,
  headRadius: 0.21,
})

/** A captured segment at least this share of its standard length is drawn at full length; shorter ones are foreshortened. */
const FULL_LENGTH_SHARE = 0.75
/** Shortest drawn segment (share of standard), for a limb pointing at the camera. */
const MIN_LENGTH_SHARE = 0.45
/** Below this captured length (torso lengths) a segment's direction is noise. */
const MIN_DIRECTION_LENGTH = 0.08
/** A captured segment longer than this multiple of its standard length is a tracking error, not a pose. */
const MAX_LENGTH_SHARE = 1.9
/** Narrowest drawn shoulders (share of standard), for a body turned side-on. */
const MIN_WIDTH_SHARE = 0.3
/** With this many limbs unreliable the capture is not drawn at all; the neutral figure is shown instead. */
const MAX_UNRELIABLE_LIMBS = 1
/** Neutral limb angles from straight down, outward, in degrees. */
const NEUTRAL_ARM_DEGREES = 10
const NEUTRAL_LEG_DEGREES = 4

export type SketchLimb = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg'

const LIMBS: Readonly<Record<SketchLimb, { root: LandmarkName; middle: LandmarkName; end: LandmarkName; side: 1 | -1; arm: boolean }>> = {
  leftArm: { root: 'leftShoulder', middle: 'leftElbow', end: 'leftWrist', side: 1, arm: true },
  rightArm: { root: 'rightShoulder', middle: 'rightElbow', end: 'rightWrist', side: -1, arm: true },
  leftLeg: { root: 'leftHip', middle: 'leftKnee', end: 'leftAnkle', side: 1, arm: false },
  rightLeg: { root: 'rightHip', middle: 'rightKnee', end: 'rightAnkle', side: -1, arm: false },
}

export type SketchJoints = Record<'neck' | 'pelvis' | LandmarkName, Vec2>

/** A figure in body space: hip midpoint at the origin, torso length 1, y down, not yet mirrored. */
export interface SketchFigure {
  joints: SketchJoints
  head: { center: Vec2; radius: number }
  /** Limbs drawn in the neutral standard position because their landmarks were missing or implausible. */
  estimated: SketchLimb[]
}

export type SketchFigureResult =
  | { kind: 'pose'; figure: SketchFigure }
  | { kind: 'unreliable'; reason: 'no-body' | 'limbs' }

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Vec2, factor: number): Vec2 => ({ x: a.x * factor, y: a.y * factor })
const unit = (a: Vec2): Vec2 => scale(a, 1 / (length(a) || 1))
/** Straight down along the body, tilted `degrees` towards `outward`. */
const hanging = (down: Vec2, outward: Vec2, degrees: number): Vec2 => {
  const radians = (degrees * Math.PI) / 180
  return add(scale(down, Math.cos(radians)), scale(outward, Math.sin(radians)))
}

function drawnLength(captured: number, standard: number): number {
  const share = captured / standard
  return standard * Math.min(1, Math.max(MIN_LENGTH_SHARE, share / FULL_LENGTH_SHARE))
}

type LimbReading = { status: 'ok'; upper: Vec2; lower: Vec2 } | { status: 'missing' } | { status: 'implausible' }

function readLimb(coords: BodyCoords, limb: SketchLimb): LimbReading {
  const { root, middle, end, arm } = LIMBS[limb]
  const a = coords[root]
  const b = coords[middle]
  const c = coords[end]
  if (!a || !b || !c) return { status: 'missing' }
  const upperStandard = arm ? SKETCH_PROPORTIONS.upperArm : SKETCH_PROPORTIONS.thigh
  const lowerStandard = arm ? SKETCH_PROPORTIONS.forearm : SKETCH_PROPORTIONS.shin
  const upper = sub(b, a)
  const lower = sub(c, b)
  if (length(upper) > upperStandard * MAX_LENGTH_SHARE || length(lower) > lowerStandard * MAX_LENGTH_SHARE) return { status: 'implausible' }
  return { status: 'ok', upper, lower }
}

/**
 * The pictogram for one captured pose, or why it cannot be drawn faithfully. Never mutates `pose`.
 */
export function sketchFigure(pose: CapturedPose | undefined): SketchFigureResult {
  if (!pose || !(Number.isFinite(pose.aspect) && pose.aspect > 0)) return { kind: 'unreliable', reason: 'no-body' }
  const coords = bodyCoords(pose.landmarks, pose.aspect)
  const leftShoulder = coords?.leftShoulder
  const rightShoulder = coords?.rightShoulder
  const leftHip = coords?.leftHip
  const rightHip = coords?.rightHip
  if (!coords || !leftShoulder || !rightShoulder || !leftHip || !rightHip) return { kind: 'unreliable', reason: 'no-body' }

  // bodyCoords puts the hip midpoint at the origin and the shoulder midpoint at distance 1.
  const shoulderMid = scale(add(leftShoulder, rightShoulder), 0.5)
  const up = unit(shoulderMid)
  const across = { x: -up.y, y: up.x }
  // Which way the person's left lies (facing the camera: larger image x). Turned away, the sign flips.
  const leftward = Math.sign((leftShoulder.x - rightShoulder.x) * across.x + (leftShoulder.y - rightShoulder.y) * across.y) || 1
  const capturedShoulderWidth = length(sub(leftShoulder, rightShoulder))
  const widthShare = Math.min(1, Math.max(MIN_WIDTH_SHARE, capturedShoulderWidth / SKETCH_PROPORTIONS.shoulderWidth))
  const shoulderHalf = (SKETCH_PROPORTIONS.shoulderWidth * widthShare) / 2
  const hipHalf = shoulderHalf * SKETCH_PROPORTIONS.hipToShoulder
  const neck = up
  const pelvis = { x: 0, y: 0 }
  const joints = {
    neck,
    pelvis,
    leftShoulder: add(neck, scale(across, leftward * shoulderHalf)),
    rightShoulder: add(neck, scale(across, -leftward * shoulderHalf)),
    leftHip: add(pelvis, scale(across, leftward * hipHalf)),
    rightHip: add(pelvis, scale(across, -leftward * hipHalf)),
  } as SketchJoints

  const estimated: SketchLimb[] = []
  let implausible = 0
  for (const limb of Object.keys(LIMBS) as SketchLimb[]) {
    const { root, middle, end, side, arm } = LIMBS[limb]
    const upperStandard = arm ? SKETCH_PROPORTIONS.upperArm : SKETCH_PROPORTIONS.thigh
    const lowerStandard = arm ? SKETCH_PROPORTIONS.forearm : SKETCH_PROPORTIONS.shin
    const reading = readLimb(coords, limb)
    const neutral = hanging(scale(up, -1), scale(across, side * leftward), arm ? NEUTRAL_ARM_DEGREES : NEUTRAL_LEG_DEGREES)
    let upperDirection = neutral
    let lowerDirection = neutral
    let upperLength: number = upperStandard
    let lowerLength: number = lowerStandard
    if (reading.status === 'ok') {
      if (length(reading.upper) >= MIN_DIRECTION_LENGTH) upperDirection = unit(reading.upper)
      if (length(reading.lower) >= MIN_DIRECTION_LENGTH) lowerDirection = unit(reading.lower)
      else lowerDirection = upperDirection
      upperLength = drawnLength(length(reading.upper), upperStandard)
      lowerLength = drawnLength(length(reading.lower), lowerStandard)
    } else {
      estimated.push(limb)
      if (reading.status === 'implausible') implausible += 1
    }
    joints[middle] = add(joints[root], scale(upperDirection, upperLength))
    joints[end] = add(joints[middle], scale(lowerDirection, lowerLength))
  }
  if (implausible > MAX_UNRELIABLE_LIMBS) return { kind: 'unreliable', reason: 'limbs' }
  return {
    kind: 'pose',
    figure: { joints, head: { center: add(neck, scale(up, SKETCH_PROPORTIONS.headOffset)), radius: SKETCH_PROPORTIONS.headRadius }, estimated },
  }
}

/** The neutral standing figure used when a pose is not recorded reliably enough to draw. */
export function neutralFigure(): SketchFigure {
  const up = { x: 0, y: -1 }
  const across = { x: 1, y: 0 }
  const shoulderHalf = SKETCH_PROPORTIONS.shoulderWidth / 2
  const hipHalf = shoulderHalf * SKETCH_PROPORTIONS.hipToShoulder
  const joints = {
    neck: up,
    pelvis: { x: 0, y: 0 },
    leftShoulder: add(up, scale(across, shoulderHalf)),
    rightShoulder: add(up, scale(across, -shoulderHalf)),
    leftHip: scale(across, hipHalf),
    rightHip: scale(across, -hipHalf),
  } as SketchJoints
  for (const limb of Object.keys(LIMBS) as SketchLimb[]) {
    const { root, middle, end, side, arm } = LIMBS[limb]
    const direction = hanging({ x: 0, y: 1 }, scale(across, side), arm ? NEUTRAL_ARM_DEGREES : NEUTRAL_LEG_DEGREES)
    joints[middle] = add(joints[root], scale(direction, arm ? SKETCH_PROPORTIONS.upperArm : SKETCH_PROPORTIONS.thigh))
    joints[end] = add(joints[middle], scale(direction, arm ? SKETCH_PROPORTIONS.forearm : SKETCH_PROPORTIONS.shin))
  }
  return { joints, head: { center: add(up, scale(up, SKETCH_PROPORTIONS.headOffset)), radius: SKETCH_PROPORTIONS.headRadius }, estimated: [] }
}

export const SKETCH_VIEWBOX = Object.freeze({ width: 120, height: 140, padding: 11 })

export interface SketchLayout {
  /** Body space → viewBox, mirrored like the camera preview (the person's left hand appears on the viewer's left). */
  project: (point: Vec2) => Vec2
  scale: number
}

/** One uniform scale for all figures, fitted to their joint and head extents and centred in the viewBox. */
export function layoutSketch(figures: ReadonlyArray<SketchFigure>): SketchLayout {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  for (const figure of figures) {
    for (const point of Object.values(figure.joints)) include(-point.x, point.y)
    const { center, radius } = figure.head
    include(-center.x - radius, center.y - radius)
    include(-center.x + radius, center.y + radius)
  }
  if (!Number.isFinite(minX)) { minX = -1; maxX = 1; minY = -2; maxY = 2 }
  const { width, height, padding } = SKETCH_VIEWBOX
  const fit = Math.min((width - 2 * padding) / Math.max(maxX - minX, 1e-6), (height - 2 * padding) / Math.max(maxY - minY, 1e-6))
  const offsetX = width / 2 - ((minX + maxX) / 2) * fit
  const offsetY = height / 2 - ((minY + maxY) / 2) * fit
  return { scale: fit, project: (point) => ({ x: offsetX - point.x * fit, y: offsetY + point.y * fit }) }
}

/** Joints drawn with a start → finish path: the main movers only, so stance noise does not clutter a small icon. */
export const MOVER_SHARE = 0.5
const MOVER_CANDIDATES: ReadonlyArray<LandmarkName> = ['leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle']

export function sketchMovers(from: SketchFigure, to: SketchFigure, candidates: ReadonlyArray<LandmarkName> = MOVER_CANDIDATES): LandmarkName[] {
  const distances = candidates.map((name) => [name, length(sub(to.joints[name], from.joints[name]))] as const)
  const largest = Math.max(0, ...distances.map(([, distance]) => distance))
  if (largest < 0.25) return []
  return distances.filter(([, distance]) => distance >= largest * MOVER_SHARE).map(([name]) => name)
}
