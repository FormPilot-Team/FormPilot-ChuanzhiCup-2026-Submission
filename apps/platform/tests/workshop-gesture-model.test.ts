import { describe, expect, it, vi } from 'vitest'
import { createGestureDemoPoseFrame } from '../src/data/demoPose'
import { GestureRuntimeController } from '../src/features/gesture/GestureRuntimeController'
import { DEFAULT_GESTURE_HOLD_CONFIG } from '../src/features/gesture/GestureHoldController'
import { GESTURE_VISIBILITY_THRESHOLD } from '../src/features/gesture/gestureDetection'
import type { PoseDetector, PoseImageSource } from '../src/features/pose/PoseDetector'
import { PoseFilter } from '../src/features/pose/PoseFilter'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import type { PoseFrame } from '../src/features/pose/types'
import { WorkshopGestureDetector, type WorkshopModelVariant } from '../src/features/workshop/detector'

/** Programmatic poses only: geometry/visibility coverage, not a MediaPipe model-comparison recording. */
function startTriggers(gesture: 'start' | 'none', visibility = 0.98): { triggered: boolean; maxProgress: number } {
  const filter = new PoseFilter({ medianWindow: 3, emaAlpha: 0.5 })
  const controller = new GestureRuntimeController()
  let maxProgress = 0
  for (let index = 0; index < 61; index += 1) {
    const frame = createGestureDemoPoseFrame(index * 50, gesture)
    const synthetic = {
      ...frame,
      landmarks: frame.landmarks.map((landmark) => ({ ...landmark, visibility, presence: visibility })),
    }
    const pose = normalizePoseFrame(filter.push(synthetic))
    if (!pose) continue
    const result = controller.update({ courseState: 'PREPARING', framingValid: true, pose })
    maxProgress = Math.max(maxProgress, result.progress)
    if (result.triggered === 'start') return { triggered: true, maxProgress: 1 }
  }
  return { triggered: false, maxProgress }
}

const SOURCE = {} as PoseImageSource
const frame = (label: string): PoseFrame => ({ timestamp: 0, confidence: 0.9, landmarks: [{ x: 0, y: 0, z: 0, visibility: Number(label === 'lite') }] })

function fakeFactory(options: { failLite?: boolean } = {}) {
  const created: Array<{ variant: WorkshopModelVariant; detector: { released: boolean } }> = []
  let release = () => undefined as void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const factory = (variant: WorkshopModelVariant) => {
    const detector = {
      released: false,
      initialize: vi.fn(async () => {
        await gate
        if (options.failLite) throw new Error('HTTP 404 /models/pose_landmarker_lite.task')
      }),
      detect: vi.fn(() => frame(variant)),
      close: vi.fn(() => { detector.released = true }),
    }
    created.push({ variant, detector })
    return detector as unknown as PoseDetector
  }
  return { factory, created, release: () => release() }
}

describe('custom-action training start gesture', () => {
  it('synthetic poses: sustained visible hands-together geometry starts, other geometry or low visibility does not', () => {
    expect(startTriggers('start')).toEqual({ triggered: true, maxProgress: 1 })
    expect(startTriggers('none')).toEqual({ triggered: false, maxProgress: 0 })
    expect(startTriggers('start', 0.4)).toEqual({ triggered: false, maxProgress: 0 })
  })

  it('keeps the shared gesture thresholds unchanged', () => {
    expect(GESTURE_VISIBILITY_THRESHOLD).toBe(0.65)
    expect(DEFAULT_GESTURE_HOLD_CONFIG.holdDurationMs).toBe(1200)
  })
})

describe('WorkshopGestureDetector', () => {
  it('reads gesture frames from the lite model when recognition runs on the full model', async () => {
    const fake = fakeFactory()
    const gesture = new WorkshopGestureDetector(fake.factory)
    const recognitionFrame = frame('full')
    // Until the lite model is ready, the gesture keeps using the recognition frame.
    const loading = gesture.initialize('full')
    expect(gesture.detect(SOURCE, 1, recognitionFrame)).toBe(recognitionFrame)
    fake.release()
    await loading
    expect(fake.created.map((item) => item.variant)).toEqual(['lite'])
    expect(gesture.separate).toBe(true)
    expect(gesture.detect(SOURCE, 2, recognitionFrame)?.landmarks[0].visibility).toBe(1)
    await gesture.initialize('full')
    expect(fake.created).toHaveLength(1)
    gesture.close()
    expect(fake.created[0].detector.released).toBe(true)
    expect(gesture.detect(SOURCE, 3, recognitionFrame)).toBe(recognitionFrame)
  })

  it('loads nothing extra when recognition already fell back to the lite model', async () => {
    const fake = fakeFactory()
    const gesture = new WorkshopGestureDetector(fake.factory)
    await gesture.initialize('lite')
    const recognitionFrame = frame('lite')
    expect(fake.created).toEqual([])
    expect(gesture.separate).toBe(false)
    expect(gesture.detect(SOURCE, 1, recognitionFrame)).toBe(recognitionFrame)
  })

  it('falls back to the recognition frames when the lite model cannot load, without failing', async () => {
    const fake = fakeFactory({ failLite: true })
    const gesture = new WorkshopGestureDetector(fake.factory)
    const loading = gesture.initialize('full')
    fake.release()
    await expect(loading).resolves.toBeUndefined()
    expect(fake.created[0].detector.released).toBe(true)
    expect(gesture.separate).toBe(false)
    const recognitionFrame = frame('full')
    expect(gesture.detect(SOURCE, 1, recognitionFrame)).toBe(recognitionFrame)
  })

  it('closes a lite model that finishes loading after the page has left', async () => {
    const fake = fakeFactory()
    const gesture = new WorkshopGestureDetector(fake.factory)
    const loading = gesture.initialize('full')
    gesture.close()
    fake.release()
    await loading
    expect(fake.created[0].detector.released).toBe(true)
    expect(gesture.separate).toBe(false)
  })
})
