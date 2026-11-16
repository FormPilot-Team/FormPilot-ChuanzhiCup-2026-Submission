import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PoseSketch } from '../src/components/workshop/PoseSketch'
import {
  SKETCH_PROPORTIONS, SKETCH_VIEWBOX, layoutSketch, neutralFigure, sketchFigure, sketchMovers, type SketchFigure,
} from '../src/components/workshop/poseSketchFigure'
import type { Vec2 } from '../src/features/workshop/recognition/geometry'
import { standingPose } from '../src/features/workshop/fixture'
import type { CapturedPose } from '../src/features/workshop/types'

function capture(landmarks: ReadonlyArray<{ x: number; y: number; z?: number; visibility: number }>, aspect = 16 / 9): CapturedPose {
  return { landmarks: landmarks.map(({ x, y, z = 0, visibility }) => ({ x, y, z, visibility })), aspect, frames: 30, capturedAt: '2026-11-16T00:00:00.000Z' }
}

const standing = (armDegrees: number) => capture(standingPose(armDegrees))

// Programmatic geometry only; these are not captures from a person or a video.
const SYNTHETIC_START = standing(8)
const SYNTHETIC_FINISH = capture(standingPose(90).map((landmark, index) => ({
  ...landmark,
  // Small, explicitly synthetic stance variation must not be marked as arm movement.
  x: landmark.x + ([25, 27].includes(index) ? 0.004 : [26, 28].includes(index) ? -0.004 : 0),
})))

function figureOf(pose: CapturedPose): SketchFigure {
  const result = sketchFigure(pose)
  if (result.kind !== 'pose') throw new Error(`expected a drawable pose, got ${result.reason}`)
  return result.figure
}

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)
/** Angle of a → b from horizontal in degrees (0 = level). */
const tilt = (a: Vec2, b: Vec2) => (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI

function expectNaturalProportions(figure: SketchFigure) {
  const { joints } = figure
  const shoulders = distance(joints.leftShoulder, joints.rightShoulder)
  const hips = distance(joints.leftHip, joints.rightHip)
  expect(distance(joints.neck, joints.pelvis)).toBeCloseTo(1, 6)
  expect(hips / shoulders).toBeCloseTo(SKETCH_PROPORTIONS.hipToShoulder, 6)
  expect(shoulders).toBeGreaterThan(0.2)
  expect(shoulders).toBeLessThanOrEqual(SKETCH_PROPORTIONS.shoulderWidth + 1e-9)
  for (const [a, b, standard] of [
    ['leftShoulder', 'leftElbow', SKETCH_PROPORTIONS.upperArm], ['rightShoulder', 'rightElbow', SKETCH_PROPORTIONS.upperArm],
    ['leftElbow', 'leftWrist', SKETCH_PROPORTIONS.forearm], ['rightElbow', 'rightWrist', SKETCH_PROPORTIONS.forearm],
    ['leftHip', 'leftKnee', SKETCH_PROPORTIONS.thigh], ['rightHip', 'rightKnee', SKETCH_PROPORTIONS.thigh],
    ['leftKnee', 'leftAnkle', SKETCH_PROPORTIONS.shin], ['rightKnee', 'rightAnkle', SKETCH_PROPORTIONS.shin],
  ] as const) {
    const bone = distance(joints[a], joints[b])
    expect(bone, `${a}-${b}`).toBeLessThanOrEqual(standard + 1e-9)
    expect(bone, `${a}-${b}`).toBeGreaterThanOrEqual(standard * 0.45 - 1e-9)
  }
  // Head above the shoulders, legs below the hips (y grows downwards).
  expect(figure.head.center.y + figure.head.radius).toBeLessThan(joints.neck.y)
  expect(joints.leftAnkle.y).toBeGreaterThan(joints.leftHip.y)
  expect(joints.rightAnkle.y).toBeGreaterThan(joints.rightHip.y)
}

function expectInsideViewBox(figures: SketchFigure[]) {
  const layout = layoutSketch(figures)
  const { width, height, padding } = SKETCH_VIEWBOX
  for (const figure of figures) {
    const points = [...Object.values(figure.joints).map(layout.project)]
    const head = layout.project(figure.head.center)
    const r = figure.head.radius * layout.scale
    points.push({ x: head.x - r, y: head.y - r }, { x: head.x + r, y: head.y + r })
    for (const point of points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
      expect(point.x).toBeGreaterThanOrEqual(padding - 1e-6)
      expect(point.x).toBeLessThanOrEqual(width - padding + 1e-6)
      expect(point.y).toBeGreaterThanOrEqual(padding - 1e-6)
      expect(point.y).toBeLessThanOrEqual(height - padding + 1e-6)
    }
  }
}

describe('workshop pose sketch geometry', () => {
  it('侧平展臂: arms level at shoulder height on both sides, on natural proportions', () => {
    const figure = figureOf(standing(90))
    expectNaturalProportions(figure)
    const { joints } = figure
    expect(tilt(joints.leftShoulder, joints.leftWrist)).toBeLessThan(10)
    expect(tilt(joints.rightShoulder, joints.rightWrist)).toBeLessThan(10)
    expect(joints.leftWrist.x).toBeGreaterThan(joints.leftShoulder.x + 0.9)
    expect(joints.rightWrist.x).toBeLessThan(joints.rightShoulder.x - 0.9)
    expect(Math.abs(joints.leftWrist.x + joints.rightWrist.x)).toBeLessThan(0.05)
  })

  it('双臂上举: both hands above the head', () => {
    const figure = figureOf(standing(180))
    expectNaturalProportions(figure)
    const headTop = figure.head.center.y - figure.head.radius
    expect(figure.joints.leftWrist.y).toBeLessThan(headTop)
    expect(figure.joints.rightWrist.y).toBeLessThan(headTop)
  })

  it('arms down: hands hang beside the hips', () => {
    const figure = figureOf(standing(8))
    expectNaturalProportions(figure)
    expect(figure.joints.leftWrist.y).toBeGreaterThan(figure.joints.pelvis.y - 0.2)
    expect(figure.joints.rightWrist.y).toBeGreaterThan(figure.joints.pelvis.y - 0.2)
  })

  it('a synthetic lateral-arm-raise pose draws a natural figure: head, full-width hips, level arms, movers on the arms only', () => {
    const start = figureOf(SYNTHETIC_START)
    const finish = figureOf(SYNTHETIC_FINISH)
    expectNaturalProportions(start)
    expectNaturalProportions(finish)
    expect(start.estimated).toEqual([])
    expect(finish.estimated).toEqual([])
    expect(tilt(finish.joints.leftShoulder, finish.joints.leftWrist)).toBeLessThan(15)
    expect(tilt(finish.joints.rightShoulder, finish.joints.rightWrist)).toBeLessThan(15)
    // Synthetic stance variation must not mark knees or ankles as movers; only the arms perform the action.
    expect(sketchMovers(start, finish).sort()).toEqual(['leftElbow', 'leftWrist', 'rightElbow', 'rightWrist'])
    expectInsideViewBox([start, finish])
  })

  it('is mirrored like the camera preview: the person\'s left hand is drawn on the viewer\'s left', () => {
    const figure = figureOf(standing(90))
    const layout = layoutSketch([figure])
    expect(layout.project(figure.joints.leftWrist).x).toBeLessThan(layout.project(figure.joints.rightWrist).x)
    expect(layout.project(figure.head.center).x).toBeCloseTo(SKETCH_VIEWBOX.width / 2, 0)
  })

  it('keeps every common pose inside the drawing area', () => {
    for (const degrees of [0, 45, 90, 135, 180]) expectInsideViewBox([figureOf(standing(8)), figureOf(standing(degrees))])
    expectInsideViewBox([neutralFigure()])
  })

  it('missing keypoints: missing limbs are drawn in the neutral position and marked as estimated', () => {
    const landmarks = standing(90).landmarks.map((item, index) => ([13, 14, 15, 16].includes(index) ? { ...item, visibility: 0.1 } : item))
    const figure = figureOf(capture(landmarks))
    expect(figure.estimated.sort()).toEqual(['leftArm', 'rightArm'])
    expectNaturalProportions(figure)
    expect(figure.joints.leftWrist.y).toBeGreaterThan(figure.joints.neck.y)
  })

  it('missing shoulders or hips, or a broken picture size, cannot be drawn', () => {
    const noHips = standing(90).landmarks.map((item, index) => (index === 23 || index === 24 ? { ...item, visibility: 0 } : item))
    expect(sketchFigure(capture(noHips))).toEqual({ kind: 'unreliable', reason: 'no-body' })
    expect(sketchFigure({ ...standing(90), aspect: Number.NaN })).toEqual({ kind: 'unreliable', reason: 'no-body' })
    expect(sketchFigure({ ...standing(90), landmarks: [] })).toEqual({ kind: 'unreliable', reason: 'no-body' })
    expect(sketchFigure(undefined)).toEqual({ kind: 'unreliable', reason: 'no-body' })
  })

  it('implausible keypoints: one broken limb is drawn neutral, two or more fall back to the standard figure', () => {
    const jumped = (indices: number[]) => standing(90).landmarks.map((item, index) => (indices.includes(index) ? { ...item, x: 0.98, y: 0.02 } : item))
    const oneBroken = figureOf(capture(jumped([16])))
    expect(oneBroken.estimated).toEqual(['rightArm'])
    expectNaturalProportions(oneBroken)
    expect(sketchFigure(capture(jumped([16, 27])))).toEqual({ kind: 'unreliable', reason: 'limbs' })
  })

  it('never changes the recorded landmarks the recognizer uses', () => {
    const pose = SYNTHETIC_FINISH
    const before = JSON.stringify(pose)
    Object.freeze(pose)
    for (const item of pose.landmarks) Object.freeze(item)
    Object.freeze(pose.landmarks)
    figureOf(pose)
    expect(JSON.stringify(pose)).toBe(before)
  })
})

describe('PoseSketch', () => {
  const render = (props: Parameters<typeof PoseSketch>[0]) => renderToStaticMarkup(createElement(PoseSketch, props))

  it('draws the start and finish figures with heads and marks the moving hands', () => {
    const html = render({ start: SYNTHETIC_START, finish: SYNTHETIC_FINISH })
    expect(html).toContain('data-sketch="comparison"')
    expect(html).toContain('开始姿势与完成姿势对比示意')
    expect(html.match(/data-part="head"/g)).toHaveLength(2)
    expect(html).toContain('data-mover="leftWrist"')
    expect(html).toContain('data-mover="rightWrist"')
    expect(html).not.toContain('data-mover="leftAnkle"')
    expect(html).not.toContain('data-mover="leftKnee"')
    expect(html).not.toContain('NaN')
  })

  it('shows a neutral standard figure, not a distorted one, when the recorded poses cannot be drawn', () => {
    const broken = { ...standing(90), landmarks: standing(90).landmarks.map((item) => ({ ...item, visibility: 0.2 })) }
    const html = render({ start: broken, finish: broken })
    expect(html).toContain('data-sketch="placeholder"')
    expect(html).toContain('data-testid="pose-sketch-neutral"')
    expect(html).toContain('示范姿势记录不完整，显示标准人形示意')
    expect(html).not.toContain('data-mover=')
  })

  it('draws the one pose that is reliable when the other is not', () => {
    const broken = { ...standing(8), landmarks: [] }
    const html = render({ start: broken, finish: standing(180) })
    expect(html).toContain('data-sketch="single"')
    expect(html).toContain('data-testid="pose-sketch-finish"')
    expect(html).not.toContain('data-testid="pose-sketch-start"')
  })

  it('says so when nothing is recorded yet', () => {
    const html = render({})
    expect(html).toContain('data-sketch="empty"')
    expect(html).toContain('尚未记录')
    expect(html).not.toContain('data-part="head"')
  })
})
