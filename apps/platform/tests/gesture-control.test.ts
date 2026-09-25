import { describe, expect, it } from 'vitest'
import { createGestureDemoPoseFrame } from '../src/data/demoPose'
import { GestureRuntimeController } from '../src/features/gesture/GestureRuntimeController'
import { detectPauseGesture, detectStartGesture } from '../src/features/gesture/gestureDetection'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'

function gesturePose(kind: 'start' | 'pause' | 'none', timestamp: number, visibility = 0.98) {
  const frame = createGestureDemoPoseFrame(timestamp, kind)
  const adjusted = visibility === 0.98 ? frame : {
    ...frame,
    confidence: visibility,
    landmarks: frame.landmarks.map((landmark) => ({ ...landmark, visibility, presence: visibility })),
  }
  const normalized = normalizePoseFrame(adjusted)
  if (!normalized) throw new Error('Gesture fixture must normalize')
  return normalized
}

describe('gesture detection', () => {
  it('detects hands together at chest height without MediaPipe Hands landmarks', () => {
    expect(detectStartGesture(gesturePose('start', 0))).toBe(true)
    expect(detectStartGesture(gesturePose('none', 0))).toBe(false)
  })

  it('detects crossed forearms using anatomical sides and remains mirror invariant', () => {
    const pose = gesturePose('pause', 0)
    const mirrored = normalizePoseFrame({
      ...pose,
      landmarks: pose.landmarks.map((landmark) => ({ ...landmark, x: 1 - landmark.x })),
    })
    expect(detectPauseGesture(pose)).toBe(true)
    expect(mirrored && detectPauseGesture(mirrored)).toBe(true)
  })

  it('rejects low-confidence landmarks', () => {
    expect(detectStartGesture(gesturePose('start', 0, 0.4))).toBe(false)
    expect(detectPauseGesture(gesturePose('pause', 0, 0.4))).toBe(false)
  })
})

describe('GestureRuntimeController', () => {
  it('requires valid framing and the full 1.2 second hold before start', () => {
    const controller = new GestureRuntimeController()
    expect(controller.update({ courseState: 'PREPARING', framingValid: false, pose: gesturePose('start', 0) }).triggered).toBeUndefined()
    expect(controller.update({ courseState: 'PREPARING', framingValid: true, pose: gesturePose('start', 100) }).progress).toBe(0)
    expect(controller.update({ courseState: 'PREPARING', framingValid: true, pose: gesturePose('start', 1299) }).triggered).toBeUndefined()
    expect(controller.update({ courseState: 'PREPARING', framingValid: true, pose: gesturePose('start', 1300) }).triggered).toBe('start')
  })

  it('ignores the start gesture while ACTIVE and rejects a single X frame', () => {
    const controller = new GestureRuntimeController()
    expect(controller.update({ courseState: 'ACTIVE', framingValid: true, pose: gesturePose('start', 0) }).action).toBe('pause')
    expect(controller.update({ courseState: 'ACTIVE', framingValid: true, pose: gesturePose('start', 1400) }).triggered).toBeUndefined()
    expect(controller.update({ courseState: 'ACTIVE', framingValid: true, pose: gesturePose('pause', 1500) }).triggered).toBeUndefined()
    expect(controller.update({ courseState: 'ACTIVE', framingValid: true, pose: gesturePose('none', 1533) }).progress).toBe(0)
  })

  it('pauses on a sustained X and resumes on sustained hands together', () => {
    const controller = new GestureRuntimeController({ holdDurationMs: 1200, cooldownMs: 0 })
    controller.update({ courseState: 'ACTIVE', framingValid: true, pose: gesturePose('pause', 0) })
    expect(controller.update({ courseState: 'ACTIVE', framingValid: true, pose: gesturePose('pause', 1200) }).triggered).toBe('pause')
    controller.update({ courseState: 'PAUSED', framingValid: true, pose: gesturePose('start', 1300) })
    expect(controller.update({ courseState: 'PAUSED', framingValid: true, pose: gesturePose('start', 2500) }).triggered).toBe('resume')
  })

  it('enforces cooldown and resets hold progress on state change', () => {
    const controller = new GestureRuntimeController()
    controller.update({ courseState: 'PREPARING', framingValid: true, pose: gesturePose('start', 0) })
    expect(controller.update({ courseState: 'PREPARING', framingValid: true, pose: gesturePose('start', 1200) }).triggered).toBe('start')
    expect(controller.update({ courseState: 'ACTIVE', framingValid: true, pose: gesturePose('pause', 2000) })).toMatchObject({ progress: 0, coolingDown: true })
    expect(controller.update({ courseState: 'ACTIVE', framingValid: true, pose: gesturePose('pause', 3300) }).progress).toBe(0)
    expect(controller.update({ courseState: 'PAUSED', framingValid: true, pose: gesturePose('start', 4000) }).progress).toBe(0)
  })
})
