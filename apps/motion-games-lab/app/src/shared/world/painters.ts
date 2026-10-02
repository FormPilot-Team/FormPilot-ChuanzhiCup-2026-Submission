// Procedural 2.5D world art (Canvas 2D). Everything is generated in code — no external images —
// and shared by the Phaser scenes and the Game Hub cards so the three games look like one world.
import { mulberry32 } from '../random'
import { PALETTE as P } from './palette'

type Ctx = CanvasRenderingContext2D

export function paintSky(ctx: Ctx, w: number, h: number, sun = { x: 0.8, y: 0.16 }): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, P.skyTop)
  g.addColorStop(0.55, P.skyMid)
  g.addColorStop(1, P.skyHorizon)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const r = Math.min(w, h) * 0.07
  const sx = w * sun.x
  const sy = h * sun.y
  const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 6)
  glow.addColorStop(0, 'rgba(255, 244, 200, 0.85)')
  glow.addColorStop(0.25, P.sunGlow)
  glow.addColorStop(1, 'rgba(255, 240, 190, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)
  // soft light rays
  ctx.save()
  ctx.translate(sx, sy)
  for (let i = 0; i < 7; i += 1) {
    ctx.rotate(0.38 + i * 0.05)
    const ray = ctx.createLinearGradient(0, 0, -w, h)
    ray.addColorStop(0, 'rgba(255, 250, 220, 0.16)')
    ray.addColorStop(1, 'rgba(255, 250, 220, 0)')
    ctx.fillStyle = ray
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-w * 1.4, h * 0.9)
    ctx.lineTo(-w * 1.25, h * 1.2)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  ctx.fillStyle = P.sun
  ctx.beginPath()
  ctx.arc(sx, sy, r, 0, Math.PI * 2)
  ctx.fill()
}

export function paintCloud(ctx: Ctx, w: number, h: number, seed: number): void {
  const rand = mulberry32(seed)
  const puffs = 6 + Math.floor(rand() * 3)
  const base = h * 0.68
  ctx.save()
  ctx.filter = 'blur(1px)'
  for (const pass of [0, 1]) {
    for (let i = 0; i < puffs; i += 1) {
      const t = i / (puffs - 1)
      const x = w * (0.12 + t * 0.76) + (rand() - 0.5) * w * 0.05
      const r = h * (0.22 + Math.sin(t * Math.PI) * 0.26 + rand() * 0.06)
      ctx.fillStyle = pass === 0 ? 'rgba(206, 228, 240, 0.9)' : P.cloud
      ctx.beginPath()
      ctx.arc(x, base - r * 0.55 - (pass ? h * 0.05 : 0), r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Rolling hill band; y values are fractions of h. */
export function paintHills(ctx: Ctx, w: number, h: number, seed: number, base: number, amp: number, color: string, highlight: string): void {
  const rand = mulberry32(seed)
  const phases = [rand() * 6, rand() * 6, rand() * 6]
  const yAt = (x: number) => h * (base - amp * (0.55 * Math.sin(x / w * 2.2 * Math.PI + phases[0]) + 0.3 * Math.sin(x / w * 5.1 * Math.PI + phases[1]) + 0.15 * Math.sin(x / w * 11 * Math.PI + phases[2])))
  const g = ctx.createLinearGradient(0, h * (base - amp), 0, h)
  g.addColorStop(0, highlight)
  g.addColorStop(0.35, color)
  g.addColorStop(1, color)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, h)
  for (let x = 0; x <= w; x += w / 80) ctx.lineTo(x, yAt(x))
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fill()
}

/** Distant row of rounded trees. */
export function paintTreeLine(ctx: Ctx, w: number, h: number, seed: number, baseY: number, size: number, color: string, light: string): void {
  const rand = mulberry32(seed)
  let x = -size
  while (x < w + size) {
    const r = size * (0.7 + rand() * 0.6)
    const y = h * baseY - r * (0.6 + rand() * 0.5)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.arc(x + r * 0.55, y + r * 0.35, r * 0.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(x - r * 0.1, y, r * 0.75, h * baseY - y + r)
    const shine = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x - r * 0.35, y - r * 0.4, r)
    shine.addColorStop(0, light)
    shine.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = shine
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    x += r * (1.05 + rand() * 0.5)
  }
}

function blob(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function trunk(ctx: Ctx, x: number, groundY: number, topY: number, width: number, rand: () => number): void {
  const g = ctx.createLinearGradient(x - width, 0, x + width, 0)
  g.addColorStop(0, P.barkDark)
  g.addColorStop(0.45, P.bark)
  g.addColorStop(1, P.barkDark)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(x - width * 0.75, groundY)
  ctx.bezierCurveTo(x - width * 0.45, groundY - (groundY - topY) * 0.4, x - width * 0.6, topY + (groundY - topY) * 0.2, x - width * 0.25, topY)
  ctx.lineTo(x + width * 0.25, topY)
  ctx.bezierCurveTo(x + width * 0.55, topY + (groundY - topY) * 0.25, x + width * 0.4, groundY - (groundY - topY) * 0.4, x + width * 0.8, groundY)
  ctx.closePath()
  ctx.fill()
  // branches reaching into the crown
  ctx.strokeStyle = P.bark
  ctx.lineCap = 'round'
  for (let i = 0; i < 4; i += 1) {
    const side = i % 2 ? 1 : -1
    const sy = topY + (groundY - topY) * (0.05 + rand() * 0.25)
    ctx.lineWidth = width * (0.28 - i * 0.04)
    ctx.beginPath()
    ctx.moveTo(x, sy)
    ctx.quadraticCurveTo(x + side * width * 1.6, sy - width * 1.4, x + side * width * (2.6 + rand() * 1.4), sy - width * (2.2 + rand()))
    ctx.stroke()
  }
}

/**
 * A wide orchard canopy band (three apple trees whose crowns overlap) between y0 and y1,
 * trunks to the ground at groundY. Apples are added at runtime, so the crowns stay empty.
 */
export function paintOrchard(ctx: Ctx, w: number, _h: number, seed: number, layout: { y0: number; y1: number; groundY: number }): void {
  const rand = mulberry32(seed)
  const trees = [0.15, 0.5, 0.85].map((fx, i) => ({ x: w * fx + (rand() - 0.5) * w * 0.03, i }))
  const crownR = Math.max(w * 0.15, (layout.y1 - layout.y0) * 0.5)
  for (const t of trees) trunk(ctx, t.x, layout.groundY, layout.y1 - crownR * 0.25, Math.max(14, w * 0.026), rand)
  const crown = (layer: 'shadow' | 'mid' | 'light') => {
    for (const t of trees) {
      const cy = (layout.y0 + layout.y1) / 2
      const count = 20
      for (let k = 0; k < count; k += 1) {
        const a = (k / count) * Math.PI * 2 + rand() * 0.4
        const spreadX = crownR * (t.i === 1 ? 1.05 : 0.95)
        const spreadY = (layout.y1 - layout.y0) * 0.42
        const x = t.x + Math.cos(a) * spreadX * (0.45 + rand() * 0.55)
        const y = cy + Math.sin(a) * spreadY * (0.45 + rand() * 0.55)
        const r = crownR * (0.3 + rand() * 0.22)
        if (layer === 'shadow') blob(ctx, x + r * 0.08, y + r * 0.12, r * 1.05, P.leafDark)
        else if (layer === 'mid') {
          const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r)
          g.addColorStop(0, P.leafLight)
          g.addColorStop(0.6, P.leaf)
          g.addColorStop(1, P.leafDark)
          blob(ctx, x, y, r * 0.92, g)
        } else if (y < cy && rand() > 0.55) {
          // small sunlit rim on the upper blobs (kept subtle so it never reads as a bubble)
          const glint = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x - r * 0.35, y - r * 0.4, r * 0.32)
          glint.addColorStop(0, 'rgba(214, 240, 160, 0.45)')
          glint.addColorStop(1, 'rgba(214, 240, 160, 0)')
          blob(ctx, x - r * 0.35, y - r * 0.4, r * 0.32, glint)
        }
      }
    }
  }
  crown('shadow')
  crown('mid')
  crown('light')
  // leaf speckles for texture
  for (let i = 0; i < 420; i += 1) {
    const t = trees[i % 3]
    const x = t.x + (rand() - 0.5) * crownR * 2.1
    const y = layout.y0 + rand() * (layout.y1 - layout.y0)
    ctx.fillStyle = rand() > 0.5 ? 'rgba(196, 231, 142, 0.35)' : 'rgba(30, 80, 50, 0.25)'
    ctx.beginPath()
    ctx.ellipse(x, y, 3 + rand() * 4, 1.5 + rand() * 2, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function paintMeadow(ctx: Ctx, w: number, h: number, seed: number, topY: number): void {
  const rand = mulberry32(seed)
  const g = ctx.createLinearGradient(0, topY, 0, h)
  g.addColorStop(0, P.grassLight)
  g.addColorStop(0.35, P.grass)
  g.addColorStop(1, P.grassDark)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, h)
  for (let x = 0; x <= w; x += w / 60) ctx.lineTo(x, topY + Math.sin(x / w * 9 + seed) * h * 0.006)
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fill()
  // grass blades
  for (let i = 0; i < Math.floor(w / 3); i += 1) {
    const x = rand() * w
    const y = topY + rand() * (h - topY)
    const len = (6 + rand() * 14) * (0.6 + (y - topY) / (h - topY))
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(154, 208, 114, 0.7)' : 'rgba(60, 120, 60, 0.45)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 6, y - len * 0.6, x + (rand() - 0.5) * 10, y - len)
    ctx.stroke()
  }
  // tiny flowers
  const flowers = ['#fff6d6', '#ffd1dc', '#ffe27a', '#d6e8ff']
  for (let i = 0; i < Math.floor(w / 28); i += 1) {
    const x = rand() * w
    const y = topY + 10 + rand() * (h - topY - 10)
    const r = 2 + rand() * 2.5
    ctx.fillStyle = flowers[i % flowers.length]
    for (let p = 0; p < 5; p += 1) blob(ctx, x + Math.cos((p / 5) * Math.PI * 2) * r, y + Math.sin((p / 5) * Math.PI * 2) * r, r * 0.8, ctx.fillStyle)
    blob(ctx, x, y, r * 0.6, P.gold)
  }
}

export function paintApple(ctx: Ctx, size: number): void {
  const cx = size / 2
  const cy = size * 0.56
  const r = size * 0.36
  ctx.save()
  ctx.shadowColor = 'rgba(80, 20, 10, 0.25)'
  ctx.shadowBlur = size * 0.06
  ctx.shadowOffsetY = size * 0.03
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.15)
  body.addColorStop(0, '#ff8a6b')
  body.addColorStop(0.45, P.appleRed)
  body.addColorStop(1, P.appleDeep)
  ctx.fillStyle = body
  ctx.beginPath()
  // two-lobed apple outline
  ctx.moveTo(cx, cy - r * 0.78)
  ctx.bezierCurveTo(cx + r * 0.55, cy - r * 1.15, cx + r * 1.15, cy - r * 0.55, cx + r * 1.0, cy + r * 0.2)
  ctx.bezierCurveTo(cx + r * 0.9, cy + r * 0.85, cx + r * 0.35, cy + r * 1.08, cx, cy + r * 0.92)
  ctx.bezierCurveTo(cx - r * 0.35, cy + r * 1.08, cx - r * 0.9, cy + r * 0.85, cx - r * 1.0, cy + r * 0.2)
  ctx.bezierCurveTo(cx - r * 1.15, cy - r * 0.55, cx - r * 0.55, cy - r * 1.15, cx, cy - r * 0.78)
  ctx.fill()
  ctx.restore()
  // highlight
  const shine = ctx.createRadialGradient(cx - r * 0.42, cy - r * 0.35, 0, cx - r * 0.42, cy - r * 0.35, r * 0.45)
  shine.addColorStop(0, 'rgba(255, 240, 230, 0.95)')
  shine.addColorStop(1, 'rgba(255, 240, 230, 0)')
  ctx.fillStyle = shine
  ctx.beginPath()
  ctx.ellipse(cx - r * 0.42, cy - r * 0.32, r * 0.28, r * 0.42, -0.5, 0, Math.PI * 2)
  ctx.fill()
  // stem
  ctx.strokeStyle = P.barkDark
  ctx.lineWidth = size * 0.045
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, cy - r * 0.7)
  ctx.quadraticCurveTo(cx + size * 0.02, cy - r * 1.15, cx + size * 0.06, cy - r * 1.35)
  ctx.stroke()
  paintLeafAt(ctx, cx + size * 0.07, cy - r * 1.18, size * 0.2, 0.5)
}

function paintLeafAt(ctx: Ctx, x: number, y: number, len: number, angle: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  const g = ctx.createLinearGradient(0, 0, len, 0)
  g.addColorStop(0, P.leaf)
  g.addColorStop(1, P.leafLight)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(len * 0.5, -len * 0.42, len, 0)
  ctx.quadraticCurveTo(len * 0.5, len * 0.42, 0, 0)
  ctx.fill()
  ctx.strokeStyle = 'rgba(30, 80, 40, 0.5)'
  ctx.lineWidth = Math.max(1, len * 0.04)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(len * 0.85, 0)
  ctx.stroke()
  ctx.restore()
}

export function paintLeaf(ctx: Ctx, size: number): void {
  paintLeafAt(ctx, size * 0.08, size / 2, size * 0.84, 0)
}

/** Small twig + leaves an apple hangs from. */
export function paintTwig(ctx: Ctx, size: number): void {
  ctx.strokeStyle = P.bark
  ctx.lineCap = 'round'
  ctx.lineWidth = size * 0.06
  ctx.beginPath()
  ctx.moveTo(size * 0.1, size * 0.3)
  ctx.quadraticCurveTo(size * 0.5, size * 0.18, size * 0.9, size * 0.32)
  ctx.stroke()
  paintLeafAt(ctx, size * 0.22, size * 0.27, size * 0.3, -2.4)
  paintLeafAt(ctx, size * 0.7, size * 0.26, size * 0.32, -0.6)
  paintLeafAt(ctx, size * 0.82, size * 0.33, size * 0.26, 0.5)
}

export function paintBasket(ctx: Ctx, w: number, h: number): void {
  const top = h * 0.3
  ctx.save()
  ctx.shadowColor = 'rgba(40, 60, 20, 0.35)'
  ctx.shadowBlur = h * 0.08
  ctx.shadowOffsetY = h * 0.05
  const g = ctx.createLinearGradient(0, top, 0, h)
  g.addColorStop(0, P.woodLight)
  g.addColorStop(1, P.woodDark)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(w * 0.04, top)
  ctx.lineTo(w * 0.96, top)
  ctx.lineTo(w * 0.84, h * 0.97)
  ctx.quadraticCurveTo(w * 0.5, h * 1.02, w * 0.16, h * 0.97)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  // weave
  ctx.strokeStyle = 'rgba(110, 66, 30, 0.55)'
  ctx.lineWidth = Math.max(2, h * 0.025)
  for (let i = 1; i < 5; i += 1) {
    const y = top + ((h * 0.95 - top) * i) / 5
    const inset = (w * 0.12 * (y - top)) / (h - top)
    ctx.beginPath()
    ctx.moveTo(w * 0.04 + inset, y)
    ctx.lineTo(w * 0.96 - inset, y)
    ctx.stroke()
  }
  for (let i = 1; i < 9; i += 1) {
    const x = w * (0.04 + (0.92 * i) / 9)
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(w * 0.5 + (x - w * 0.5) * 0.75, h * 0.96)
    ctx.stroke()
  }
  // rim
  const rim = ctx.createLinearGradient(0, top - h * 0.06, 0, top + h * 0.08)
  rim.addColorStop(0, P.woodLight)
  rim.addColorStop(1, P.wood)
  ctx.fillStyle = rim
  ctx.beginPath()
  ctx.ellipse(w / 2, top, w * 0.47, h * 0.08, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(70, 40, 18, 0.55)'
  ctx.beginPath()
  ctx.ellipse(w / 2, top + h * 0.01, w * 0.41, h * 0.05, 0, 0, Math.PI * 2)
  ctx.fill()
}

export function paintGlow(ctx: Ctx, size: number, color: string): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, color)
  g.addColorStop(0.4, color.replace(/[\d.]+\)$/, '0.35)'))
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
}

export function paintSparkle(ctx: Ctx, size: number): void {
  const c = size / 2
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0, 'rgba(255,255,240,1)')
  g.addColorStop(0.25, 'rgba(255,236,160,0.9)')
  g.addColorStop(1, 'rgba(255,220,120,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2
    const r = i % 2 ? c * 0.28 : c
    ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
}

export function paintButterfly(ctx: Ctx, size: number, hue: string): void {
  const c = size / 2
  ctx.fillStyle = hue
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(c + s * size * 0.2, c - size * 0.08, size * 0.22, size * 0.28, s * 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(c + s * size * 0.15, c + size * 0.18, size * 0.14, size * 0.16, s * -0.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = P.ink
  ctx.fillRect(c - size * 0.03, c - size * 0.25, size * 0.06, size * 0.5)
}

// ---- Hub card scenes (static art for the three games, same world) ----

function card(ctx: Ctx, w: number, h: number, seed: number): void {
  paintSky(ctx, w, h, { x: 0.78, y: 0.2 })
  paintHills(ctx, w, h, seed, 0.6, 0.08, P.hillFar, '#c9e6cf')
  paintTreeLine(ctx, w, h, seed + 1, 0.66, h * 0.07, P.forestFar, 'rgba(160, 210, 170, 0.5)')
  paintHills(ctx, w, h, seed + 2, 0.72, 0.05, P.hillMid, P.hillFar)
}

export function paintOrchardCard(ctx: Ctx, w: number, h: number): void {
  card(ctx, w, h, 11)
  paintOrchard(ctx, w, h, 4, { y0: h * 0.1, y1: h * 0.62, groundY: h * 0.82 })
  paintMeadow(ctx, w, h, 5, h * 0.78)
  const apple = document.createElement('canvas')
  apple.width = apple.height = 64
  paintApple(apple.getContext('2d')!, 64)
  const rand = mulberry32(9)
  for (let i = 0; i < 9; i += 1) ctx.drawImage(apple, w * (0.08 + rand() * 0.84), h * (0.16 + rand() * 0.38), h * 0.12, h * 0.12)
  const basket = document.createElement('canvas')
  basket.width = 200
  basket.height = 130
  paintBasket(basket.getContext('2d')!, 200, 130)
  ctx.drawImage(basket, w * 0.4, h * 0.74, w * 0.2, w * 0.13)
}

export function paintRiverCard(ctx: Ctx, w: number, h: number): void {
  card(ctx, w, h, 21)
  paintTreeLine(ctx, w, h, 22, 0.7, h * 0.1, P.forestDeep, 'rgba(120, 190, 140, 0.45)')
  // river with perspective
  const river = ctx.createLinearGradient(0, h * 0.62, 0, h)
  river.addColorStop(0, P.waterLight)
  river.addColorStop(0.4, P.water)
  river.addColorStop(1, P.waterDeep)
  ctx.fillStyle = river
  ctx.beginPath()
  ctx.moveTo(w * 0.42, h * 0.64)
  ctx.lineTo(w * 0.58, h * 0.64)
  ctx.bezierCurveTo(w * 0.7, h * 0.78, w * 1.0, h * 0.86, w * 1.05, h)
  ctx.lineTo(-w * 0.05, h)
  ctx.bezierCurveTo(w * 0.05, h * 0.86, w * 0.3, h * 0.78, w * 0.42, h * 0.64)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 2
  const rand = mulberry32(23)
  for (let i = 0; i < 14; i += 1) {
    const y = h * (0.68 + rand() * 0.3)
    const x = w * (0.3 + rand() * 0.4)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + w * 0.03, y - 3, x + w * 0.06, y)
    ctx.stroke()
  }
  // little wooden boat
  const bx = w * 0.5
  const by = h * 0.84
  ctx.fillStyle = P.woodDark
  ctx.beginPath()
  ctx.moveTo(bx - w * 0.13, by - h * 0.04)
  ctx.lineTo(bx + w * 0.13, by - h * 0.04)
  ctx.quadraticCurveTo(bx + w * 0.1, by + h * 0.05, bx, by + h * 0.05)
  ctx.quadraticCurveTo(bx - w * 0.1, by + h * 0.05, bx - w * 0.13, by - h * 0.04)
  ctx.fill()
  ctx.fillStyle = P.wood
  ctx.fillRect(bx - w * 0.12, by - h * 0.055, w * 0.24, h * 0.025)
  ctx.strokeStyle = P.woodLight
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(bx + s * w * 0.06, by - h * 0.06)
    ctx.lineTo(bx + s * w * 0.2, by + h * 0.07)
    ctx.stroke()
  }
  paintMeadow(ctx, w, h * 0.7, 24, h * 0.66)
}

export function paintRangeCard(ctx: Ctx, w: number, h: number): void {
  card(ctx, w, h, 31)
  paintTreeLine(ctx, w, h, 32, 0.74, h * 0.12, P.forestDeep, 'rgba(120, 190, 140, 0.45)')
  paintMeadow(ctx, w, h, 33, h * 0.72)
  // straw target on a wooden stand
  const tx = w * 0.62
  const ty = h * 0.5
  const r = h * 0.2
  ctx.strokeStyle = P.woodDark
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(tx - r * 0.6, ty + r * 1.7)
  ctx.lineTo(tx, ty)
  ctx.lineTo(tx + r * 0.6, ty + r * 1.7)
  ctx.stroke()
  const rings = ['#f4ead2', P.appleRed, '#f4ead2', P.teal, P.gold]
  rings.forEach((color, i) => blob(ctx, tx, ty, r * (1 - i * 0.19), color))
  // arrow
  ctx.strokeStyle = P.barkDark
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(tx - r * 0.05, ty + r * 0.05)
  ctx.lineTo(tx - r * 1.4, ty + r * 0.45)
  ctx.stroke()
  ctx.fillStyle = P.cream
  ctx.beginPath()
  ctx.moveTo(tx - r * 1.4, ty + r * 0.45)
  ctx.lineTo(tx - r * 1.2, ty + r * 0.3)
  ctx.lineTo(tx - r * 1.25, ty + r * 0.48)
  ctx.closePath()
  ctx.fill()
}
