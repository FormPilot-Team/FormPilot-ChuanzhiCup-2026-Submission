import { describe, expect, it } from 'vitest'
import { createDemoPoseFrame } from '../src/data/demoPose'
import { evaluateFraming, FramingAssistController, type FramingAssistConfig } from '../src/features/framing/FramingAssist'
import { normalizePoseFrame } from '../src/features/pose/PoseNormalizer'
import type { PoseFrame, PoseLandmark } from '../src/features/pose/types'

type MutablePoseFrame = Omit<PoseFrame, 'landmarks'> & { landmarks: PoseLandmark[] }

function normalized(mutate?: (frame: MutablePoseFrame) => void) {
  const source = createDemoPoseFrame(0)
  const frame: MutablePoseFrame = { ...source, landmarks: source.landmarks.map((point) => ({ ...point })) }
  mutate?.(frame)
  const result = normalizePoseFrame(frame)
  if (!result) throw new Error('Expected a normalized pose')
  return result
}

function shiftX(amount: number) {
  return normalized((frame) => {
    frame.landmarks = frame.landmarks.map((point) => ({ ...point, x: point.x + amount }))
  })
}

describe('Framing Assist v1', () => {
  it('keeps an upper-body profile ready when knees and ankles are absent', () => {
    const frame = normalized((pose) => {
      for (const index of [25, 26, 27, 28]) pose.landmarks[index] = { ...pose.landmarks[index], visibility: 0, presence: 0, y: 1.2 }
    })
    expect(evaluateFraming('UPPER_BODY_WITH_HIPS', frame)).toMatchObject({ status: 'READY', isReady: true, missingRegions: [] })
  })

  it('reports persistently unavailable knees and feet for full-body framing', () => {
    const frame = normalized((pose) => {
      for (const index of [25, 26, 27, 28]) pose.landmarks[index] = { ...pose.landmarks[index], visibility: 0.1, presence: 0.1 }
    })
    const state = evaluateFraming('FULL_BODY', frame)
    expect(state.isReady).toBe(false)
    expect(state.missingRegions).toEqual(expect.arrayContaining(['knees', 'feet']))
    expect(state.primaryHint).toContain('暂未稳定识别')
  })

  it('gives concrete left and right corrections before leaving the frame', () => {
    expect(evaluateFraming('UPPER_BODY_WITH_HIPS', shiftX(-0.32))).toMatchObject({ status: 'EDGE_WARNING', primaryHint: '向右移动一点' })
    expect(evaluateFraming('UPPER_BODY_WITH_HIPS', shiftX(0.32))).toMatchObject({ status: 'EDGE_WARNING', primaryHint: '向左移动一点' })
  })

  it('uses visual heuristics for too close and too far without claiming physical distance', () => {
    const close = normalized((frame) => {
      frame.landmarks[11] = { ...frame.landmarks[11], x: 0.25 }
      frame.landmarks[12] = { ...frame.landmarks[12], x: 0.75 }
    })
    const far = normalized((frame) => {
      frame.landmarks = frame.landmarks.map((point) => ({ ...point, x: 0.5 + (point.x - 0.5) * 0.45, y: 0.5 + (point.y - 0.5) * 0.45 }))
    })
    expect(evaluateFraming('FULL_BODY', close)).toMatchObject({ status: 'TOO_CLOSE', primaryHint: expect.stringContaining('后退') })
    expect(evaluateFraming('FULL_BODY', far)).toMatchObject({ status: 'TOO_FAR', primaryHint: '可以靠近一些', isReady: true })
  })

  it('pre-warns when overhead wrists approach the top edge', () => {
    const frame = normalized((pose) => {
      pose.landmarks[15] = { ...pose.landmarks[15], y: 0.03 }
      pose.landmarks[16] = { ...pose.landmarks[16], y: 0.035 }
    })
    expect(evaluateFraming('UPPER_BODY_WITH_HIPS', frame)).toMatchObject({ status: 'EDGE_WARNING', primaryHint: expect.stringContaining('头顶和双手') })
  })

  it('debounces a short landmark dropout and requires a stable recovery', () => {
    const config: FramingAssistConfig = { visibilityThreshold: 0.55, edgeWarningMargin: 0.045, hardFrameMargin: 0.012, enterDelayMs: 300, recoveryDelayMs: 500, spaceLimitedDelayMs: 5000 }
    const controller = new FramingAssistController(config, 'UPPER_BODY_WITH_HIPS')
    const good = normalized()
    const missing = normalized((pose) => { pose.landmarks[15] = { ...pose.landmarks[15], visibility: 0.1, presence: 0.1 } })
    controller.update('UPPER_BODY_WITH_HIPS', good, 0)
    expect(controller.update('UPPER_BODY_WITH_HIPS', good, 500).status).toBe('READY')
    expect(controller.update('UPPER_BODY_WITH_HIPS', missing, 600).status).toBe('READY')
    expect(controller.update('UPPER_BODY_WITH_HIPS', good, 750).status).toBe('READY')
    controller.update('UPPER_BODY_WITH_HIPS', missing, 800)
    expect(controller.update('UPPER_BODY_WITH_HIPS', missing, 1100).status).toBe('MISSING_REQUIRED')
    expect(controller.update('UPPER_BODY_WITH_HIPS', good, 1200).status).toBe('MISSING_REQUIRED')
    expect(controller.update('UPPER_BODY_WITH_HIPS', good, 1700).status).toBe('READY')
  })

  it('changes repeated full-body failure into an honest space-limited message', () => {
    const config: FramingAssistConfig = { visibilityThreshold: 0.55, edgeWarningMargin: 0.045, hardFrameMargin: 0.012, enterDelayMs: 100, recoveryDelayMs: 100, spaceLimitedDelayMs: 700 }
    const controller = new FramingAssistController(config)
    const cropped = normalized((pose) => {
      for (const index of [25, 26, 27, 28]) pose.landmarks[index] = { ...pose.landmarks[index], visibility: 0.1, presence: 0.1 }
    })
    controller.update('FULL_BODY', cropped, 0)
    controller.update('FULL_BODY', cropped, 100)
    controller.update('FULL_BODY', cropped, 700)
    const state = controller.update('FULL_BODY', cropped, 800)
    expect(state).toMatchObject({ status: 'SPACE_LIMITED', isReady: false })
    expect(state.primaryHint).toContain('镜头范围可能不足')
  })
})
