// Forest archery range art (Canvas 2D, generated in code, same palette as orchard and river).
// The range is seen from the side: the target stands down the lane on the bow-hand side of the
// screen, so pushing the bow toward it and pulling the string back mirrors the player's own motion.
import { mulberry32 } from '../random'
import { PALETTE as P } from './palette'
import { paintHills, paintMeadow, paintSky, paintTreeLine } from './painters'

type Ctx = CanvasRenderingContext2D

/**
 * Backdrop: sky, hills, forest edge, a mown lane leading from the archer's spot (`from`, fractions)
 * to the target area (`to`), hay wall behind the target and a low fence. `mirror` flips the layout.
 */
export function paintRangeBackdrop(ctx: Ctx, w: number, h: number, mirror: boolean): void {
  ctx.save()
  if (mirror) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  paintSky(ctx, w, h, { x: 0.86, y: 0.13 })
  paintHills(ctx, w, h, 71, 0.4, 0.07, P.hillFar, '#cfe9d2')
  paintTreeLine(ctx, w, h, 72, 0.47, h * 0.06, P.forestFar, 'rgba(170, 215, 175, 0.5)')
  paintTreeLine(ctx, w, h, 73, 0.5, h * 0.045, P.forestDeep, 'rgba(120, 190, 140, 0.45)')
  paintMeadow(ctx, w, h, 74, h * 0.5)
  // mown lane in perspective, from the archer (bottom right) to the target (left)
  const lane = ctx.createLinearGradient(w, h, w * 0.2, h * 0.5)
  lane.addColorStop(0, 'rgba(160, 214, 120, 0.85)')
  lane.addColorStop(1, 'rgba(190, 228, 150, 0.6)')
  ctx.fillStyle = lane
  ctx.beginPath()
  ctx.moveTo(w * 0.4, h)
  ctx.lineTo(w * 1.05, h)
  ctx.lineTo(w * 0.36, h * 0.53)
  ctx.lineTo(w * 0.12, h * 0.53)
  ctx.closePath()
  ctx.fill()
  // mowing stripes
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = 6
  for (let i = 1; i < 6; i += 1) {
    const t = i / 6
    ctx.beginPath()
    ctx.moveTo(w * (0.4 + 0.65 * t), h)
    ctx.lineTo(w * (0.12 + 0.24 * t), h * 0.53)
    ctx.stroke()
  }
  // hay wall behind the target
  const rand = mulberry32(75)
  for (let i = 0; i < 5; i += 1) {
    const x = w * (0.08 + i * 0.065)
    const y = h * 0.5
    const g = ctx.createLinearGradient(0, y - h * 0.08, 0, y)
    g.addColorStop(0, '#f3dd95')
    g.addColorStop(1, '#c9a75a')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(x, y - h * 0.08, w * 0.07, h * 0.085, h * 0.02)
    ctx.fill()
    ctx.strokeStyle = 'rgba(140, 100, 40, 0.35)'
    ctx.lineWidth = 2
    for (let k = 0; k < 6; k += 1) {
      const sx = x + rand() * w * 0.07
      ctx.beginPath()
      ctx.moveTo(sx, y - h * 0.075)
      ctx.lineTo(sx + (rand() - 0.5) * 8, y - h * 0.005)
      ctx.stroke()
    }
  }
  // low wooden fence along the far edge of the lane
  ctx.strokeStyle = P.woodDark
  ctx.lineWidth = Math.max(3, h * 0.006)
  ctx.beginPath()
  ctx.moveTo(w * 0.45, h * 0.52)
  ctx.lineTo(w * 0.98, h * 0.545)
  ctx.moveTo(w * 0.45, h * 0.535)
  ctx.lineTo(w * 0.98, h * 0.565)
  ctx.stroke()
  for (let i = 0; i <= 8; i += 1) {
    const x = w * (0.45 + i * 0.066)
    const y = h * (0.52 + i * 0.0035)
    ctx.beginPath()
    ctx.moveTo(x, y - h * 0.012)
    ctx.lineTo(x, y + h * 0.035)
    ctx.stroke()
  }
  ctx.restore()
}

/** Straw target face (rings) — drawn square, the scene sets its size. */
export function paintTargetFace(ctx: Ctx, size: number): void {
  const c = size / 2
  const R = size * 0.48
  ctx.save()
  ctx.shadowColor = 'rgba(40, 50, 20, 0.35)'
  ctx.shadowBlur = size * 0.04
  ctx.shadowOffsetY = size * 0.02
  ctx.fillStyle = '#e8cf86'
  ctx.beginPath()
  ctx.arc(c, c, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // rings: outer → inner (matches the five scoring rings)
  const colors = ['#f4ead2', '#2bb5a8', '#e5483b', '#f4ead2', '#ffc94d']
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = colors[i]
    ctx.beginPath()
    ctx.arc(c, c, R * 0.95 * (1 - i * 0.2), 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(31, 58, 46, 0.25)'
    ctx.lineWidth = Math.max(1, size * 0.006)
    ctx.stroke()
  }
  ctx.fillStyle = '#fff6c9'
  ctx.beginPath()
  ctx.arc(c, c, R * 0.05, 0, Math.PI * 2)
  ctx.fill()
}

/** Wooden easel the target stands on. */
export function paintTargetStand(ctx: Ctx, w: number, h: number): void {
  ctx.strokeStyle = P.woodDark
  ctx.lineCap = 'round'
  ctx.lineWidth = w * 0.06
  ctx.beginPath()
  ctx.moveTo(w * 0.5, h * 0.05)
  ctx.lineTo(w * 0.18, h * 0.98)
  ctx.moveTo(w * 0.5, h * 0.05)
  ctx.lineTo(w * 0.82, h * 0.98)
  ctx.moveTo(w * 0.5, h * 0.05)
  ctx.lineTo(w * 0.56, h * 0.9)
  ctx.stroke()
}

/** Arrow pointing left (tip at x = 0). */
export function paintArrow(ctx: Ctx, w: number, h: number): void {
  const y = h / 2
  ctx.strokeStyle = P.barkDark
  ctx.lineWidth = h * 0.16
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(w * 0.1, y)
  ctx.lineTo(w * 0.92, y)
  ctx.stroke()
  ctx.fillStyle = '#5b6a62'
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(w * 0.13, y - h * 0.34)
  ctx.lineTo(w * 0.11, y)
  ctx.lineTo(w * 0.13, y + h * 0.34)
  ctx.closePath()
  ctx.fill()
  // fletching in the left-hand colour
  ctx.fillStyle = P.leftHand
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(w * 0.8, y)
    ctx.lineTo(w * 0.98, y + s * h * 0.42)
    ctx.lineTo(w * 1.0, y + s * h * 0.05)
    ctx.closePath()
    ctx.fill()
  }
}

/** Distance sign on a post ("10 米"). */
export function paintSign(ctx: Ctx, w: number, h: number, label: string): void {
  ctx.fillStyle = P.woodDark
  ctx.fillRect(w * 0.45, h * 0.4, w * 0.1, h * 0.6)
  ctx.fillStyle = P.woodLight
  ctx.beginPath()
  ctx.roundRect(w * 0.05, h * 0.05, w * 0.9, h * 0.42, h * 0.08)
  ctx.fill()
  ctx.fillStyle = P.ink
  ctx.font = `800 ${Math.round(h * 0.26)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, w / 2, h * 0.27)
}
