import { describe, expect, it } from 'vitest'
import {
  BODY_FRAMING_CONFIG,
  BodyFramer,
  IDENTITY_FRAMING,
  boxInside,
  expandBox,
  fitTransform,
  isIdentity,
  landmarkBox,
  significantChange,
  transformBox,
  type StageBox,
} from '../src/features/framing/bodyFraming'

const W = 669
const H = 376

function standingLandmarks(cx: number, top: number, bottom: number, spread = 0.06, visibility = 0.95) {
  // 33 MediaPipe landmarks on a simple standing figure, normalized to the source picture.
  return Array.from({ length: 33 }, (_, index) => {
    const t = index / 32
    const side = index % 2 === 0 ? -1 : 1
    return { x: cx + side * spread * (0.4 + t), y: top + (bottom - top) * t, visibility }
  })
}

const MAPPING = { destWidth: W, destHeight: H, sourceWidth: 1280, sourceHeight: 720, fit: 'contain' as const, mirrored: true }

describe('body-aware framing (Web V1.1 C2/C3)', () => {
  it('never moves a box out of the stage, wherever it is', () => {
    const boxes: StageBox[] = [
      { left: 290, top: 90, right: 369, bottom: 351 },
      { left: 4, top: 30, right: 120, bottom: 300 },
      { left: 540, top: 10, right: 665, bottom: 200 },
      { left: 200, top: 250, right: 260, bottom: 372 },
      { left: 100, top: 100, right: 160, bottom: 160 },
    ]
    for (const box of boxes) {
      const transform = fitTransform(expandBox(box, W, H), W, H)
      expect(transform.scale).toBeGreaterThanOrEqual(1)
      expect(transform.scale).toBeLessThanOrEqual(BODY_FRAMING_CONFIG.maxScale)
      expect(boxInside(box, transform, W, H), JSON.stringify({ box, transform })).toBe(true)
      expect(boxInside(expandBox(box, W, H), transform, W, H)).toBe(true)
    }
  })

  it('centres a small person and enlarges up to the limit', () => {
    const box = { left: 310, top: 140, right: 350, bottom: 240 }
    const transform = fitTransform(expandBox(box, W, H), W, H)
    expect(transform.scale).toBeCloseTo(BODY_FRAMING_CONFIG.maxScale, 5)
    const shown = transformBox(box, transform)
    expect((shown.left + shown.right) / 2).toBeCloseTo(W / 2, 0)
  })

  it('keeps the whole picture when the body already fills the stage', () => {
    expect(fitTransform({ left: 0, top: 0, right: W, bottom: H }, W, H)).toEqual(IDENTITY_FRAMING)
  })

  it('refuses a frame where a key joint (an ankle) is not visible', () => {
    const landmarks = standingLandmarks(0.5, 0.2, 0.8)
    expect(landmarkBox(landmarks, MAPPING)).not.toBeNull()
    landmarks[27] = { ...landmarks[27], visibility: 0.1 }
    expect(landmarkBox(landmarks, MAPPING)).toBeNull()
  })

  it('maps landmarks with the same mirrored contain mapping as the skeleton', () => {
    const box = landmarkBox(standingLandmarks(0.3, 0.2, 0.8), MAPPING)!
    // Mirrored: a person on the left of the source appears on the right of the stage.
    expect((box.left + box.right) / 2).toBeGreaterThan(W / 2)
  })

  it('waits until the body has been seen for a moment, and falls back to the whole picture when it is lost', () => {
    const framer = new BodyFramer()
    const box = { left: 310, top: 140, right: 350, bottom: 240 }
    framer.push(box, 0)
    expect(isIdentity(framer.target(W, H, 0))).toBe(true)
    framer.push(box, BODY_FRAMING_CONFIG.settleMs + 10)
    expect(isIdentity(framer.target(W, H, BODY_FRAMING_CONFIG.settleMs + 10))).toBe(false)
    // No frame for longer than staleMs.
    expect(isIdentity(framer.target(W, H, BODY_FRAMING_CONFIG.settleMs + 10 + BODY_FRAMING_CONFIG.staleMs + 1))).toBe(true)
    framer.push(null, 5000)
    expect(isIdentity(framer.target(W, H, 5000))).toBe(true)
  })

  it('keeps every movement of the recent window inside the picture (arms up, then down)', () => {
    const framer = new BodyFramer()
    const down = { left: 300, top: 120, right: 360, bottom: 330 }
    const up = { left: 300, top: 60, right: 360, bottom: 330 }
    for (let t = 0; t <= 2000; t += 100) framer.push(t % 400 < 200 ? down : up, t)
    const transform = framer.target(W, H, 2000)
    expect(boxInside(up, transform, W, H)).toBe(true)
    expect(boxInside(down, transform, W, H)).toBe(true)
  })

  it('ignores tiny changes so the picture does not keep moving', () => {
    const a = { scale: 1.5, x: -100, y: -50 }
    expect(significantChange(a, { scale: 1.52, x: -102, y: -51 }, W, H)).toBe(false)
    expect(significantChange(a, { scale: 1.7, x: -100, y: -50 }, W, H)).toBe(true)
    expect(significantChange(a, IDENTITY_FRAMING, W, H)).toBe(true)
  })
})
