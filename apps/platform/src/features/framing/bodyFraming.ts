import { mapNormalizedLandmarkToCanvas, type FitMappingInput } from '../pose/fitMapping'

/**
 * Body-aware framing for the training pictures (Web V1.1, C2/C3).
 *
 * The camera picture (and the standard video) is always shown whole with `object-contain`; this module only decides
 * how far the picture may be enlarged so the person is easier to see. The rule is one-sided: the enlarged picture must
 * keep every recently seen joint, hand and foot inside the stage, with a margin. When that cannot be guaranteed (key
 * joints not visible, no recent frame), the answer is the unzoomed full picture. Nothing here touches recognition: the
 * pose model still receives the camera's own full frame.
 */

export interface StageBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface FramingTransform {
  scale: number
  x: number
  y: number
}

export const IDENTITY_FRAMING: FramingTransform = Object.freeze({ scale: 1, x: 0, y: 0 })

export const BODY_FRAMING_CONFIG = Object.freeze({
  /** Recent body boxes are unioned over this window, so a movement's full reach stays inside the picture. */
  windowMs: 2500,
  /** The body must have been seen for this long before the picture is enlarged at all. */
  settleMs: 800,
  /** No frame for this long: show the whole picture again. */
  staleMs: 900,
  minVisibility: 0.5,
  /** Room added around the body box, as a share of the box height (head room, reach of hands and feet). */
  marginRatio: 0.14,
  /** Free border kept inside the stage on every side after enlarging. */
  padding: 0.05,
  maxScale: 2.6,
})

/** Nose, shoulders, elbows, wrists, hips, knees and ankles: all must be visible before the picture is enlarged. */
export const KEY_LANDMARKS: ReadonlyArray<number> = Object.freeze([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28])

export interface LandmarkLike {
  x: number
  y: number
  visibility?: number
}

function visible(landmark: LandmarkLike | undefined, minVisibility: number): landmark is LandmarkLike {
  return Boolean(landmark) && Number.isFinite(landmark!.x) && Number.isFinite(landmark!.y) && (landmark!.visibility ?? 1) >= minVisibility
}

/**
 * The box (in stage pixels, before any framing transform) around every visible landmark of one frame, or null when a
 * key joint is not visible — the framing then falls back to the whole picture.
 */
export function landmarkBox(
  landmarks: ReadonlyArray<LandmarkLike>,
  mapping: FitMappingInput,
  minVisibility = BODY_FRAMING_CONFIG.minVisibility,
  required: ReadonlyArray<number> = KEY_LANDMARKS,
): StageBox | null {
  if (!required.every((index) => visible(landmarks[index], minVisibility))) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const landmark of landmarks) {
    if (!visible(landmark, minVisibility)) continue
    const point = mapNormalizedLandmarkToCanvas(landmark.x, landmark.y, mapping)
    left = Math.min(left, point.x)
    top = Math.min(top, point.y)
    right = Math.max(right, point.x)
    bottom = Math.max(bottom, point.y)
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null
}

export function unionBoxes(boxes: ReadonlyArray<StageBox>): StageBox | null {
  if (!boxes.length) return null
  return boxes.reduce((acc, box) => ({
    left: Math.min(acc.left, box.left),
    top: Math.min(acc.top, box.top),
    right: Math.max(acc.right, box.right),
    bottom: Math.max(acc.bottom, box.bottom),
  }))
}

/** Grows the box by `marginRatio` of its height on every side, clipped to the stage. */
export function expandBox(box: StageBox, width: number, height: number, marginRatio = BODY_FRAMING_CONFIG.marginRatio): StageBox {
  const margin = (box.bottom - box.top) * marginRatio
  return {
    left: Math.max(0, box.left - margin),
    top: Math.max(0, box.top - margin),
    right: Math.min(width, box.right + margin),
    bottom: Math.min(height, box.bottom + margin),
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * The largest enlargement (≤ maxScale) that keeps `box` inside the stage with `padding`, centred on the box. Moving the
 * picture is clamped twice: first so the enlarged picture still covers the stage where it can, then — winning over
 * that — so no part of the box leaves the stage.
 */
export function fitTransform(
  box: StageBox,
  width: number,
  height: number,
  options: { padding?: number; maxScale?: number } = {},
): FramingTransform {
  const padding = options.padding ?? BODY_FRAMING_CONFIG.padding
  const maxScale = options.maxScale ?? BODY_FRAMING_CONFIG.maxScale
  const boxWidth = box.right - box.left
  const boxHeight = box.bottom - box.top
  if (!(width > 0 && height > 0 && boxWidth > 0 && boxHeight > 0)) return IDENTITY_FRAMING
  const scale = Math.min(maxScale, (width * (1 - 2 * padding)) / boxWidth, (height * (1 - 2 * padding)) / boxHeight)
  if (!(scale > 1.02)) return IDENTITY_FRAMING
  let x = width / 2 - scale * (box.left + box.right) / 2
  let y = height / 2 - scale * (box.top + box.bottom) / 2
  x = clamp(x, width - scale * width, 0)
  y = clamp(y, height - scale * height, 0)
  // Shown box: x + scale·left ≥ 0 and x + scale·right ≤ width (and the same vertically).
  x = clamp(x, -scale * box.left, width - scale * box.right)
  y = clamp(y, -scale * box.top, height - scale * box.bottom)
  return { scale, x, y }
}

/** The box as it appears on the stage under a framing transform. */
export function transformBox(box: StageBox, transform: FramingTransform): StageBox {
  return {
    left: transform.x + transform.scale * box.left,
    top: transform.y + transform.scale * box.top,
    right: transform.x + transform.scale * box.right,
    bottom: transform.y + transform.scale * box.bottom,
  }
}

export function boxInside(box: StageBox, transform: FramingTransform, width: number, height: number, tolerance = 0.5): boolean {
  const shown = transformBox(box, transform)
  return shown.left >= -tolerance && shown.top >= -tolerance && shown.right <= width + tolerance && shown.bottom <= height + tolerance
}

export function isIdentity(transform: FramingTransform): boolean {
  return Math.abs(transform.scale - 1) < 1e-3 && Math.abs(transform.x) < 0.5 && Math.abs(transform.y) < 0.5
}

/** Whether moving from `current` to `target` is worth an on-screen change (avoids a picture that never stops moving). */
export function significantChange(current: FramingTransform, target: FramingTransform, width: number, height: number): boolean {
  if (isIdentity(target) !== isIdentity(current)) return true
  return Math.abs(target.scale - current.scale) > 0.06
    || Math.abs(target.x - current.x) > width * 0.04
    || Math.abs(target.y - current.y) > height * 0.04
}

/** Live framing for the user's own camera picture: a rolling union of recent body boxes. */
export class BodyFramer {
  private samples: Array<{ at: number; box: StageBox }> = []
  private firstSeenAt: number | null = null
  private lastFrameAt = -Infinity

  push(box: StageBox | null, now: number): void {
    this.lastFrameAt = now
    if (!box) {
      // A key joint is not visible: zooming could hide it, so start over from the whole picture.
      this.samples = []
      this.firstSeenAt = null
      return
    }
    if (this.firstSeenAt === null) this.firstSeenAt = now
    this.samples.push({ at: now, box })
    const since = now - BODY_FRAMING_CONFIG.windowMs
    while (this.samples.length && this.samples[0].at < since) this.samples.shift()
  }

  reset(): void {
    this.samples = []
    this.firstSeenAt = null
    this.lastFrameAt = -Infinity
  }

  /** The recent body box (stage pixels, before framing), or null when the whole picture should be shown. */
  recentBox(now: number): StageBox | null {
    if (now - this.lastFrameAt > BODY_FRAMING_CONFIG.staleMs) return null
    if (this.firstSeenAt === null || now - this.firstSeenAt < BODY_FRAMING_CONFIG.settleMs) return null
    return unionBoxes(this.samples.map((sample) => sample.box))
  }

  target(width: number, height: number, now: number): FramingTransform {
    const box = this.recentBox(now)
    return box ? fitTransform(expandBox(box, width, height), width, height) : IDENTITY_FRAMING
  }
}

/**
 * Framing for the standard video of one chapter: the union of the performer's reference-track boxes over the whole
 * chapter, so the performer stays in view for every movement of that chapter.
 */
export function chapterFraming(
  frames: ReadonlyArray<{ t: number; confidence: number; landmarks: ReadonlyArray<LandmarkLike> }>,
  startSeconds: number,
  endSeconds: number,
  mapping: FitMappingInput,
  options: { maxScale?: number } = {},
): FramingTransform {
  const boxes: StageBox[] = []
  for (const frame of frames) {
    if (frame.t < startSeconds || frame.t > endSeconds || !(frame.confidence > 0) || !frame.landmarks.length) continue
    // The reference performer turns and bends: any visible landmark counts, the key-joint rule applies only live.
    const box = landmarkBox(frame.landmarks, mapping, BODY_FRAMING_CONFIG.minVisibility, [])
    if (box) boxes.push(box)
  }
  // A chapter with too few tracked frames keeps the whole picture.
  if (boxes.length < 5) return IDENTITY_FRAMING
  const union = unionBoxes(boxes)
  return union ? fitTransform(expandBox(union, mapping.destWidth, mapping.destHeight), mapping.destWidth, mapping.destHeight, { maxScale: options.maxScale ?? 2 }) : IDENTITY_FRAMING
}
