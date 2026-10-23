// Hand cursor art (Canvas 2D, generated in code). Three poses — open, half-closed, fist. Round-1
// playtest: both hands share ONE look — a warm-white hand with a thin warm outline and a soft shadow, a
// little translucent, sitting quietly in the forest scenes. No colour coding and no 左/右 text: the two
// hands are told apart by where they are on screen, exactly like a mirror. The only left/right difference
// is the mirrored shape (the thumb points toward the screen centre, palm facing the player).
import { PALETTE as P } from './palette'

export type HandPose = 'open' | 'half' | 'grab'
export type HandSide = 'left' | 'right'

type Ctx = CanvasRenderingContext2D

interface Capsule {
  x: number
  y: number
  angle: number
  length: number
  width: number
  /** curl toward the palm (0 = straight) */
  curl?: number
}

// Right hand, unit square, fingers up. x grows to the right (pinky side).
const FINGERS: Record<HandPose, Capsule[]> = {
  open: [
    { x: 0.385, y: 0.47, angle: -0.2, length: 0.235, width: 0.088 },
    { x: 0.475, y: 0.455, angle: -0.06, length: 0.265, width: 0.09 },
    { x: 0.565, y: 0.465, angle: 0.08, length: 0.245, width: 0.088 },
    { x: 0.648, y: 0.495, angle: 0.24, length: 0.185, width: 0.08 },
  ],
  half: [
    { x: 0.39, y: 0.47, angle: -0.08, length: 0.15, width: 0.09, curl: 0.9 },
    { x: 0.477, y: 0.46, angle: 0, length: 0.17, width: 0.092, curl: 0.9 },
    { x: 0.563, y: 0.468, angle: 0.06, length: 0.16, width: 0.09, curl: 0.9 },
    { x: 0.642, y: 0.495, angle: 0.14, length: 0.13, width: 0.082, curl: 0.9 },
  ],
  // fist: only the knuckle bumps show above the palm
  grab: [
    { x: 0.39, y: 0.455, angle: 0, length: 0.012, width: 0.1 },
    { x: 0.477, y: 0.44, angle: 0, length: 0.012, width: 0.104 },
    { x: 0.563, y: 0.445, angle: 0, length: 0.012, width: 0.1 },
    { x: 0.643, y: 0.47, angle: 0, length: 0.012, width: 0.092 },
  ],
}

const THUMB: Record<HandPose, Capsule> = {
  open: { x: 0.36, y: 0.66, angle: -0.95, length: 0.2, width: 0.095 },
  half: { x: 0.36, y: 0.66, angle: -0.55, length: 0.16, width: 0.095 },
  // wrapped across the front of the fist (drawn on top, see paintHand)
  grab: { x: 0.36, y: 0.705, angle: 1.42, length: 0.21, width: 0.095 },
}

function capsulePath(ctx: Ctx, c: Capsule, s: number): void {
  // angle 0 = straight up; positive leans toward the pinky side
  const dx = Math.sin(c.angle)
  const dy = -Math.cos(c.angle)
  const x0 = c.x * s
  const y0 = c.y * s
  const len = c.length * s
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  if (c.curl) {
    // bent finger: rise, then fold the tip back toward the palm
    const mx = x0 + dx * len * 0.75
    const my = y0 + dy * len * 0.75
    ctx.quadraticCurveTo(mx + dx * len * 0.35, my + dy * len * 0.35, mx - dy * 0 + dx * len * 0.05, my + len * 0.32 * c.curl)
  } else {
    ctx.lineTo(x0 + dx * len, y0 + dy * len)
  }
}

function shapes(ctx: Ctx, pose: HandPose, s: number, stroke: (width: number) => void, fillPalm: () => void): void {
  for (const finger of FINGERS[pose]) {
    capsulePath(ctx, finger, s)
    stroke(finger.width * s)
  }
  if (pose !== 'grab') {
    capsulePath(ctx, THUMB[pose], s)
    stroke(THUMB[pose].width * s)
  }
  fillPalm()
}

function palmPath(ctx: Ctx, pose: HandPose, s: number, grow = 0): void {
  const fist = pose === 'grab'
  const w = (fist ? 0.4 : 0.36) * s + grow * 2
  const h = (fist ? 0.36 : 0.33) * s + grow * 2
  const x = 0.5 * s - w / 2 + (fist ? 0.01 * s : 0)
  const y = (fist ? 0.42 : 0.46) * s - grow
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, [0.11 * s + grow, 0.11 * s + grow, 0.16 * s + grow, 0.16 * s + grow])
}

/** Paint one hand cursor into a square canvas of `size` px (the same design for both sides). */
export function paintHand(ctx: Ctx, size: number, pose: HandPose, side: HandSide): void {
  const s = size * 0.9
  const pad = (size - s) / 2
  const outline = Math.max(1.5, s * 0.026)
  ctx.save()
  ctx.translate(pad, pad)
  if (side === 'left') {
    ctx.translate(s, 0)
    ctx.scale(-1, 1)
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 1) soft shadow + thin warm outline (union of all parts)
  ctx.save()
  ctx.shadowColor = 'rgba(24, 48, 36, 0.3)'
  ctx.shadowBlur = s * 0.055
  ctx.shadowOffsetY = s * 0.022
  ctx.strokeStyle = P.handLine
  ctx.fillStyle = P.handLine
  shapes(ctx, pose, s, (w) => {
    ctx.lineWidth = w + outline * 2
    ctx.stroke()
  }, () => {
    palmPath(ctx, pose, s, outline)
    ctx.fill()
  })
  ctx.restore()

  // 2) warm-white fill, a touch of shade toward the wrist
  const grad = ctx.createLinearGradient(0, s * 0.2, 0, s * 0.85)
  grad.addColorStop(0, P.handLight)
  grad.addColorStop(0.55, P.handFill)
  grad.addColorStop(1, P.handShade)
  ctx.strokeStyle = grad
  ctx.fillStyle = grad
  shapes(ctx, pose, s, (w) => {
    ctx.lineWidth = w
    ctx.stroke()
  }, () => {
    palmPath(ctx, pose, s)
    ctx.fill()
  })

  // 3) pose details: finger creases on the fist, a faint palm line otherwise
  ctx.strokeStyle = 'rgba(120, 88, 62, 0.28)'
  ctx.lineWidth = Math.max(1.2, s * 0.016)
  if (pose === 'grab') {
    for (let i = 0; i < 3; i += 1) {
      const x = s * (0.433 + i * 0.086)
      ctx.beginPath()
      ctx.moveTo(x, s * 0.47)
      ctx.lineTo(x, s * 0.58)
      ctx.stroke()
    }
    // thumb wrapped over the front, outlined so it reads as its own part
    capsulePath(ctx, THUMB.grab, s)
    ctx.strokeStyle = P.handLine
    ctx.lineWidth = THUMB.grab.width * s + outline * 2
    ctx.stroke()
    ctx.strokeStyle = grad
    ctx.lineWidth = THUMB.grab.width * s
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.moveTo(s * 0.4, s * 0.62)
    ctx.quadraticCurveTo(s * 0.5, s * (pose === 'half' ? 0.66 : 0.68), s * 0.6, s * 0.6)
    ctx.stroke()
  }
  ctx.restore()
}

/** Camera-window marker colours (formal mode): the same warm white as the cursor, for both hands. */
export const HAND_MARKER = { fill: P.handFill, ring: 'rgba(108, 80, 58, 0.75)' } as const
