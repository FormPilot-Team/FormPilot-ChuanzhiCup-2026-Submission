// Hand cursor art (Canvas 2D, generated in code). Three poses — open, half-closed, fist — per side,
// in the two hand colours. The look is a friendly flat "mitten" with a white outline: clearly a hand,
// neither childish nor realistic. Drawn palm-facing in the mirror view, so the right hand's thumb
// points toward screen centre (left) and the left hand is its mirror image.
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

/**
 * Paint one hand cursor into a square canvas of `size` px. `label` (左/右) is printed on the palm
 * so left and right never rely on colour alone.
 */
export function paintHand(ctx: Ctx, size: number, pose: HandPose, side: HandSide, label?: string): void {
  const s = size * 0.9
  const pad = (size - s) / 2
  const color = side === 'left' ? P.leftHand : P.rightHand
  const deep = side === 'left' ? '#178a80' : '#d9701b'
  const light = side === 'left' ? '#8ff0e3' : '#ffd29a'
  const outline = Math.max(2, s * 0.045)
  ctx.save()
  ctx.translate(pad, pad)
  if (side === 'left') {
    ctx.translate(s, 0)
    ctx.scale(-1, 1)
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 1) soft shadow + white outline (union of all parts)
  ctx.save()
  ctx.shadowColor = 'rgba(20, 45, 35, 0.35)'
  ctx.shadowBlur = s * 0.06
  ctx.shadowOffsetY = s * 0.025
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  shapes(ctx, pose, s, (w) => {
    ctx.lineWidth = w + outline * 2
    ctx.stroke()
  }, () => {
    palmPath(ctx, pose, s, outline)
    ctx.fill()
  })
  ctx.restore()

  // 2) colour fill
  const grad = ctx.createLinearGradient(0, s * 0.2, 0, s * 0.85)
  grad.addColorStop(0, light)
  grad.addColorStop(0.45, color)
  grad.addColorStop(1, deep)
  ctx.strokeStyle = grad
  ctx.fillStyle = grad
  shapes(ctx, pose, s, (w) => {
    ctx.lineWidth = w
    ctx.stroke()
  }, () => {
    palmPath(ctx, pose, s)
    ctx.fill()
  })

  // 3) pose details: knuckle creases on the fist, a soft palm highlight otherwise
  if (pose === 'grab') {
    // curled finger segments
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)'
    ctx.lineWidth = Math.max(1.5, s * 0.02)
    for (let i = 0; i < 3; i += 1) {
      const x = s * (0.433 + i * 0.086)
      ctx.beginPath()
      ctx.moveTo(x, s * 0.47)
      ctx.lineTo(x, s * 0.6)
      ctx.stroke()
    }
    // thumb wrapped over the front, with its own outline so it reads as a separate part
    capsulePath(ctx, THUMB.grab, s)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = THUMB.grab.width * s + outline * 1.4
    ctx.stroke()
    ctx.strokeStyle = grad
    ctx.lineWidth = THUMB.grab.width * s
    ctx.stroke()
  } else {
    const shine = ctx.createRadialGradient(s * 0.44, s * 0.55, 0, s * 0.44, s * 0.55, s * 0.18)
    shine.addColorStop(0, 'rgba(255, 255, 255, 0.45)')
    shine.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = shine
    ctx.beginPath()
    ctx.arc(s * 0.44, s * 0.55, s * 0.18, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  if (label) {
    // label stays readable (not mirrored): printed after the transform is restored
    ctx.save()
    ctx.font = `800 ${Math.round(s * 0.17)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = Math.max(2, s * 0.03)
    ctx.strokeStyle = deep
    const cx = pad + (side === 'left' ? s * 0.495 : s * 0.505)
    const cy = pad + s * (pose === 'grab' ? 0.565 : 0.655)
    ctx.strokeText(label, cx, cy)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, cx, cy)
    ctx.restore()
  }
}

/** Small round marker in the hand colour (used in the camera window, not on the playfield). */
export const HAND_HEX = { left: P.leftHand, right: P.rightHand } as const
