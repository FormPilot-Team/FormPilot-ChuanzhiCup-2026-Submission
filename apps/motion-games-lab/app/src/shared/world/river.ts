// Forest-river art for Boating (Canvas 2D, generated in code, same palette and light as the orchard).
// Sprites are painted once per scene and scaled by the pseudo-3D projection in BoatScene.
import { mulberry32 } from '../random'
import { PALETTE as P } from './palette'
import { paintHills, paintSky, paintTreeLine } from './painters'

type Ctx = CanvasRenderingContext2D

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Sky, far hills and the far forest down to the horizon line (`horizon` = fraction of h). */
export function paintRiverSky(ctx: Ctx, w: number, h: number, horizon: number): void {
  paintSky(ctx, w, h, { x: 0.2, y: 0.12 })
  paintHills(ctx, w, h, 51, horizon - 0.08, 0.07, P.hillFar, '#cfe9d2')
  paintTreeLine(ctx, w, h, 52, horizon + 0.005, h * 0.05, P.forestFar, 'rgba(170, 215, 175, 0.5)')
  paintTreeLine(ctx, w, h, 53, horizon + 0.02, h * 0.035, P.forestDeep, 'rgba(120, 190, 140, 0.4)')
}

/**
 * Banks and water in perspective. The river is straight; motion comes from the sprites that drift
 * past. `edgeAt(y)` gives the half-width of the water at screen row y (same projection as the scene).
 */
export function paintRiverBanks(ctx: Ctx, w: number, h: number, horizonY: number, edgeAt: (y: number) => number): void {
  // meadow banks
  const bank = ctx.createLinearGradient(0, horizonY, 0, h)
  bank.addColorStop(0, '#8cc879')
  bank.addColorStop(0.5, P.grass)
  bank.addColorStop(1, P.grassDark)
  ctx.fillStyle = bank
  ctx.fillRect(0, horizonY, w, h - horizonY)
  // water
  const water = ctx.createLinearGradient(0, horizonY, 0, h)
  water.addColorStop(0, '#d9f1f2')
  water.addColorStop(0.18, P.waterLight)
  water.addColorStop(0.55, P.water)
  water.addColorStop(1, P.waterDeep)
  ctx.fillStyle = water
  ctx.beginPath()
  ctx.moveTo(w / 2, horizonY)
  for (let y = horizonY; y <= h; y += 4) ctx.lineTo(w / 2 + edgeAt(y), y)
  ctx.lineTo(w / 2 - edgeAt(h), h)
  for (let y = h; y >= horizonY; y -= 4) ctx.lineTo(w / 2 - edgeAt(y), y)
  ctx.closePath()
  ctx.fill()
  // sky reflection band + sun glitter in the distance
  const shine = ctx.createLinearGradient(0, horizonY, 0, horizonY + (h - horizonY) * 0.4)
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.55)')
  shine.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = shine
  ctx.beginPath()
  ctx.moveTo(w / 2, horizonY)
  for (let y = horizonY; y <= horizonY + (h - horizonY) * 0.4; y += 4) ctx.lineTo(w / 2 + edgeAt(y), y)
  for (let y = horizonY + (h - horizonY) * 0.4; y >= horizonY; y -= 4) ctx.lineTo(w / 2 - edgeAt(y), y)
  ctx.closePath()
  ctx.fill()
  // soft muddy edge where water meets the grass
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(120, 96, 60, 0.35)'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    for (let y = horizonY; y <= h; y += 4) ctx.lineTo(w / 2 + s * edgeAt(y), y)
    ctx.stroke()
  }
  // grass texture on the near banks
  const rand = mulberry32(61)
  for (let i = 0; i < w / 2.5; i += 1) {
    const y = horizonY + Math.pow(rand(), 0.6) * (h - horizonY)
    const near = (y - horizonY) / (h - horizonY)
    const side = rand() > 0.5 ? 1 : -1
    const x = w / 2 + side * (edgeAt(y) + 6 + rand() * w * 0.5)
    const len = 3 + near * 16
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(154, 208, 114, 0.6)' : 'rgba(50, 110, 55, 0.4)'
    ctx.lineWidth = 1 + near
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - 0.5) * 6, y - len)
    ctx.stroke()
  }
}

/** Round broadleaf tree (bank scenery). */
export function paintRoundTree(ctx: Ctx, w: number, h: number, seed: number): void {
  const rand = mulberry32(seed)
  const cx = w / 2
  ctx.fillStyle = P.bark
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.06, h)
  ctx.lineTo(cx - w * 0.03, h * 0.45)
  ctx.lineTo(cx + w * 0.03, h * 0.45)
  ctx.lineTo(cx + w * 0.07, h)
  ctx.closePath()
  ctx.fill()
  const r = w * 0.27
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2
    const x = cx + Math.cos(a) * r * 0.75
    const y = h * 0.36 + Math.sin(a) * r * 0.6
    circle(ctx, x + 2, y + 3, r * 0.62, P.leafDark)
  }
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.3
    const x = cx + Math.cos(a) * r * 0.65
    const y = h * 0.34 + Math.sin(a) * r * 0.52
    const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, 2, x, y, r * 0.6)
    g.addColorStop(0, P.leafLight)
    g.addColorStop(0.65, P.leaf)
    g.addColorStop(1, P.leafDark)
    circle(ctx, x, y, r * 0.55, g)
  }
}

/** Slim conifer (bank scenery). */
export function paintPine(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2
  ctx.fillStyle = P.barkDark
  ctx.fillRect(cx - w * 0.04, h * 0.8, w * 0.08, h * 0.2)
  for (let i = 0; i < 4; i += 1) {
    const top = h * (0.04 + i * 0.18)
    const bottom = top + h * 0.34
    const half = w * (0.16 + i * 0.09)
    const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0)
    g.addColorStop(0, P.forestDeep)
    g.addColorStop(0.45, '#3f8a5a')
    g.addColorStop(1, P.forestDeep)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(cx, top)
    ctx.quadraticCurveTo(cx + half * 0.6, (top + bottom) / 2, cx + half, bottom)
    ctx.lineTo(cx - half, bottom)
    ctx.quadraticCurveTo(cx - half * 0.6, (top + bottom) / 2, cx, top)
    ctx.fill()
  }
}

export function paintReeds(ctx: Ctx, w: number, h: number, seed: number): void {
  const rand = mulberry32(seed)
  ctx.lineCap = 'round'
  for (let i = 0; i < 9; i += 1) {
    const x = w * (0.15 + rand() * 0.7)
    const top = h * (0.05 + rand() * 0.35)
    ctx.strokeStyle = rand() > 0.5 ? '#5e9c4a' : '#7cb35c'
    ctx.lineWidth = w * 0.035
    ctx.beginPath()
    ctx.moveTo(x, h)
    ctx.quadraticCurveTo(x + (rand() - 0.5) * w * 0.2, (top + h) / 2, x + (rand() - 0.5) * w * 0.15, top)
    ctx.stroke()
    if (rand() > 0.5) {
      ctx.fillStyle = '#8a5a32'
      ctx.beginPath()
      ctx.ellipse(x, top + h * 0.06, w * 0.035, h * 0.07, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

export function paintLilyPad(ctx: Ctx, w: number, h: number, flower: boolean): void {
  const g = ctx.createRadialGradient(w * 0.45, h * 0.45, 2, w / 2, h / 2, w * 0.5)
  g.addColorStop(0, '#9ed27a')
  g.addColorStop(1, '#4f8f45')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(w / 2, h / 2, w * 0.48, h * 0.44, 0, 0.25, Math.PI * 2 - 0.1)
  ctx.lineTo(w / 2, h / 2)
  ctx.closePath()
  ctx.fill()
  if (flower) {
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      ctx.fillStyle = i % 2 ? '#ffd0dd' : '#f59fb8'
      ctx.beginPath()
      ctx.ellipse(w / 2 + Math.cos(a) * w * 0.1, h * 0.42 + Math.sin(a) * h * 0.08, w * 0.09, h * 0.06, a, 0, Math.PI * 2)
      ctx.fill()
    }
    circle(ctx, w / 2, h * 0.42, w * 0.05, P.gold)
  }
}

export function paintRock(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#b9c2bb')
  g.addColorStop(1, '#6f7c74')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(w * 0.05, h)
  ctx.quadraticCurveTo(w * 0.1, h * 0.25, w * 0.45, h * 0.15)
  ctx.quadraticCurveTo(w * 0.9, h * 0.1, w * 0.95, h)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(134, 196, 111, 0.6)'
  ctx.beginPath()
  ctx.ellipse(w * 0.45, h * 0.22, w * 0.22, h * 0.08, -0.2, 0, Math.PI * 2)
  ctx.fill()
}

/** White ripple arc floating on the water (shows the boat's speed). */
export function paintRipple(ctx: Ctx, w: number, h: number): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.lineWidth = h * 0.18
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(w * 0.1, h * 0.7)
  ctx.quadraticCurveTo(w * 0.5, h * 0.1, w * 0.9, h * 0.7)
  ctx.stroke()
}

/** Floating lotus lantern with a warm glow — the collectible. */
export function paintLantern(ctx: Ctx, size: number): void {
  const c = size / 2
  const glow = ctx.createRadialGradient(c, c * 0.95, 0, c, c * 0.95, c)
  glow.addColorStop(0, 'rgba(255, 236, 160, 0.9)')
  glow.addColorStop(0.45, 'rgba(255, 220, 140, 0.35)')
  glow.addColorStop(1, 'rgba(255, 220, 140, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  // leaf base
  ctx.fillStyle = '#5aa173'
  ctx.beginPath()
  ctx.ellipse(c, size * 0.66, size * 0.3, size * 0.08, 0, 0, Math.PI * 2)
  ctx.fill()
  // petals
  const petals: [number, number, string][] = [[-0.2, 0.9, '#f07f9f'], [0.2, 0.9, '#f07f9f'], [-0.1, 1, '#f59fb8'], [0.1, 1, '#f59fb8'], [0, 1.08, '#ffd0dd']]
  for (const [dx, k, color] of petals) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(c + dx * size * 0.9, size * 0.64)
    ctx.quadraticCurveTo(c + dx * size * 1.25 - size * 0.08, size * (0.64 - 0.22 * k), c + dx * size * 0.6, size * (0.64 - 0.3 * k))
    ctx.quadraticCurveTo(c + dx * size * 0.4 + size * 0.08, size * (0.64 - 0.12 * k), c + dx * size * 0.9, size * 0.64)
    ctx.fill()
  }
  // candle flame
  circle(ctx, c, size * 0.42, size * 0.05, '#fff4c2')
  circle(ctx, c, size * 0.43, size * 0.028, '#ffb347')
}

/** Small wooden rowboat seen from behind (the player's boat). */
export function paintBoat(ctx: Ctx, w: number, h: number): void {
  ctx.save()
  ctx.shadowColor = 'rgba(20, 50, 60, 0.35)'
  ctx.shadowBlur = h * 0.08
  ctx.shadowOffsetY = h * 0.04
  const hull = ctx.createLinearGradient(0, h * 0.35, 0, h)
  hull.addColorStop(0, P.woodLight)
  hull.addColorStop(0.5, P.wood)
  hull.addColorStop(1, P.woodDark)
  ctx.fillStyle = hull
  ctx.beginPath()
  ctx.moveTo(w * 0.04, h * 0.42)
  ctx.quadraticCurveTo(w * 0.5, h * 0.28, w * 0.96, h * 0.42)
  ctx.quadraticCurveTo(w * 0.92, h * 0.92, w * 0.5, h * 0.98)
  ctx.quadraticCurveTo(w * 0.08, h * 0.92, w * 0.04, h * 0.42)
  ctx.fill()
  ctx.restore()
  // planks
  ctx.strokeStyle = 'rgba(90, 55, 25, 0.45)'
  ctx.lineWidth = Math.max(2, h * 0.015)
  for (let i = 1; i < 4; i += 1) {
    const y = h * (0.42 + i * 0.13)
    ctx.beginPath()
    ctx.moveTo(w * (0.06 + i * 0.03), y)
    ctx.quadraticCurveTo(w * 0.5, y + h * 0.06, w * (0.94 - i * 0.03), y)
    ctx.stroke()
  }
  // inside of the boat + seat
  ctx.fillStyle = '#6e4526'
  ctx.beginPath()
  ctx.moveTo(w * 0.1, h * 0.42)
  ctx.quadraticCurveTo(w * 0.5, h * 0.3, w * 0.9, h * 0.42)
  ctx.quadraticCurveTo(w * 0.5, h * 0.5, w * 0.1, h * 0.42)
  ctx.fill()
  ctx.fillStyle = P.woodLight
  ctx.fillRect(w * 0.18, h * 0.38, w * 0.64, h * 0.05)
  // rim highlight
  ctx.strokeStyle = 'rgba(255, 236, 200, 0.85)'
  ctx.lineWidth = Math.max(2, h * 0.025)
  ctx.beginPath()
  ctx.moveTo(w * 0.04, h * 0.42)
  ctx.quadraticCurveTo(w * 0.5, h * 0.28, w * 0.96, h * 0.42)
  ctx.stroke()
  // a little flag at the bow-side seat
  ctx.fillStyle = P.leftHand
  ctx.beginPath()
  ctx.moveTo(w * 0.5, h * 0.05)
  ctx.lineTo(w * 0.62, h * 0.11)
  ctx.lineTo(w * 0.5, h * 0.17)
  ctx.fill()
  ctx.strokeStyle = P.barkDark
  ctx.lineWidth = Math.max(2, w * 0.01)
  ctx.beginPath()
  ctx.moveTo(w * 0.5, h * 0.04)
  ctx.lineTo(w * 0.5, h * 0.36)
  ctx.stroke()
}

/** Oar blade + shaft (drawn pointing right; rotated in the scene). */
export function paintOar(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, P.woodLight)
  g.addColorStop(1, P.woodDark)
  ctx.fillStyle = g
  ctx.fillRect(0, h * 0.42, w * 0.72, h * 0.16)
  ctx.beginPath()
  ctx.moveTo(w * 0.68, h * 0.4)
  ctx.quadraticCurveTo(w * 0.86, h * 0.02, w * 0.99, h * 0.18)
  ctx.lineTo(w * 0.99, h * 0.82)
  ctx.quadraticCurveTo(w * 0.86, h * 0.98, w * 0.68, h * 0.6)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 236, 200, 0.6)'
  ctx.fillRect(0, h * 0.43, w * 0.7, h * 0.04)
}

/** Landmarks the river passes: painted at a fixed size and scaled by distance. */
export function paintLandmark(ctx: Ctx, w: number, h: number, kind: 'bridge' | 'lotus' | 'arch' | 'falls' | 'dock'): void {
  const rand = mulberry32(kind.length * 7)
  if (kind === 'bridge' || kind === 'arch') {
    const stone = kind === 'arch'
    const deck = h * 0.36
    ctx.fillStyle = stone ? '#b8bfb6' : P.wood
    ctx.beginPath()
    ctx.moveTo(0, deck)
    ctx.quadraticCurveTo(w / 2, stone ? deck - h * 0.16 : deck - h * 0.06, w, deck)
    ctx.lineTo(w, deck + h * 0.12)
    if (stone) {
      ctx.lineTo(w * 0.86, deck + h * 0.12)
      ctx.lineTo(w * 0.86, h)
      ctx.lineTo(w * 0.8, h)
      ctx.quadraticCurveTo(w / 2, deck + h * 0.05, w * 0.2, h)
      ctx.lineTo(w * 0.14, h)
      ctx.lineTo(w * 0.14, deck + h * 0.12)
    }
    ctx.lineTo(0, deck + h * 0.12)
    ctx.closePath()
    ctx.fill()
    if (!stone) {
      ctx.fillStyle = P.woodDark
      for (const x of [0.12, 0.38, 0.62, 0.88]) ctx.fillRect(w * x - w * 0.015, deck, w * 0.03, h - deck)
    }
    // railing
    ctx.strokeStyle = stone ? '#8f978d' : P.woodDark
    ctx.lineWidth = h * 0.025
    ctx.beginPath()
    ctx.moveTo(0, deck - h * 0.1)
    ctx.quadraticCurveTo(w / 2, (stone ? deck - h * 0.26 : deck - h * 0.16), w, deck - h * 0.1)
    ctx.stroke()
    for (let i = 0; i <= 10; i += 1) {
      const x = (w * i) / 10
      const t = i / 10
      const y = deck - h * 0.1 - (stone ? h * 0.16 : h * 0.06) * 4 * t * (1 - t)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x, y + h * 0.1)
      ctx.stroke()
    }
    return
  }
  if (kind === 'lotus') {
    for (let i = 0; i < 14; i += 1) {
      const x = w * (0.05 + rand() * 0.9)
      const y = h * (0.55 + rand() * 0.4)
      const s = w * (0.08 + rand() * 0.06)
      ctx.save()
      ctx.translate(x - s / 2, y - s / 2)
      paintLilyPad(ctx, s, s * 0.6, rand() > 0.45)
      ctx.restore()
    }
    return
  }
  if (kind === 'falls') {
    // rocky outcrop with a little waterfall
    ctx.fillStyle = '#8c968d'
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(w * 0.05, h * 0.25)
    ctx.quadraticCurveTo(w * 0.3, h * 0.05, w * 0.55, h * 0.2)
    ctx.lineTo(w * 0.62, h)
    ctx.closePath()
    ctx.fill()
    const fall = ctx.createLinearGradient(0, h * 0.2, 0, h)
    fall.addColorStop(0, 'rgba(230, 248, 255, 0.95)')
    fall.addColorStop(1, 'rgba(190, 233, 242, 0.85)')
    ctx.fillStyle = fall
    ctx.fillRect(w * 0.26, h * 0.16, w * 0.14, h * 0.8)
    for (let i = 0; i < 12; i += 1) circle(ctx, w * (0.24 + rand() * 0.2), h * (0.92 + rand() * 0.06), w * 0.03, 'rgba(255,255,255,0.8)')
    ctx.fillStyle = 'rgba(134, 196, 111, 0.8)'
    ctx.beginPath()
    ctx.ellipse(w * 0.3, h * 0.14, w * 0.25, h * 0.06, 0, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  // dock: wooden pier with posts and a lantern pole
  ctx.fillStyle = P.wood
  ctx.fillRect(0, h * 0.55, w * 0.7, h * 0.1)
  ctx.fillStyle = P.woodDark
  for (const x of [0.05, 0.3, 0.55]) ctx.fillRect(w * x, h * 0.6, w * 0.04, h * 0.4)
  ctx.fillRect(w * 0.62, h * 0.1, w * 0.03, h * 0.45)
  circle(ctx, w * 0.635, h * 0.12, w * 0.05, 'rgba(255, 220, 140, 0.9)')
}
