// Apple Picking renderer (Phaser). It only draws what the AppleController says; all rules live in
// round.ts / controller.ts. Body-space positions (torso units) are mapped to the screen with one
// shared transform, so a hand cursor over an apple on screen is exactly a hit in body space.
import * as Phaser from 'phaser'
import type { Point, Side } from '../../motion/contracts'
import { sfx } from '../../shared/audio'
import { HandCursor, paintHandTextures } from '../../shared/handCursor'
import { perf } from '../../shared/perf'
import { FONT_FAMILY, paintTexture } from '../../shared/phaserHost'
import { drawDebugBody } from '../../shared/play/debugOverlay'
import { PALETTE } from '../../shared/world/palette'
import {
  paintApple, paintBasket, paintButterfly, paintCloud, paintGlow, paintHills, paintLeaf, paintMeadow, paintOrchard,
  paintSky, paintSparkle, paintTreeLine, paintTwig,
} from '../../shared/world/painters'
import type { AppleController, ControllerEffect } from './controller'
import type { AppleTarget } from './round'

export interface AppleSceneData {
  controller: AppleController
  dpr: number
  debug: boolean
}

interface Layout {
  s: number
  ax: number
  ay: number
}

interface AppleView {
  id: number
  target: AppleTarget
  apple: Phaser.GameObjects.Image
  twig: Phaser.GameObjects.Image
  zone: Phaser.GameObjects.Graphics
  halo: Phaser.GameObjects.Image
  bornAt: number
  /** 0..1 eased hover highlight */
  hover: number
}

const GOLD = 0xffc94d

const HUD_TOP_FRACTION = 0.13

export class AppleScene extends Phaser.Scene {
  private controller!: AppleController
  private dpr = 1
  private debug = false
  private layout: Layout = { s: 100, ax: 0, ay: 0 }
  private layoutGoal: Layout | null = null
  private bg?: Phaser.GameObjects.Image
  private land?: Phaser.GameObjects.Image
  private clouds: Phaser.GameObjects.Image[] = []
  private holdRing!: Phaser.GameObjects.Graphics
  private debugGfx?: Phaser.GameObjects.Graphics
  private debugBody?: Phaser.GameObjects.Graphics
  private cursors!: Record<Side, HandCursor>
  private burst!: Phaser.GameObjects.Graphics
  private appleView: AppleView | null = null
  private basket!: Phaser.GameObjects.Image
  private pile: Phaser.GameObjects.Image[] = []
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private leafBurst!: Phaser.GameObjects.Particles.ParticleEmitter
  private ambient: Phaser.GameObjects.GameObject[] = []
  private unsubscribe?: () => void
  private resizeTimer?: Phaser.Time.TimerEvent

  constructor() {
    super('apple')
  }

  init(data: AppleSceneData): void {
    this.controller = data.controller
    this.dpr = data.dpr
    this.debug = data.debug
  }

  create(): void {
    this.paintStaticTextures()
    this.buildBackground()
    this.basket = this.add.image(0, 0, 'basket').setDepth(30)
    this.holdRing = this.add.graphics().setDepth(45)
    this.burst = this.add.graphics().setDepth(65)
    paintHandTextures(this, this.dpr)
    this.cursors = { left: new HandCursor(this, 'left', 50), right: new HandCursor(this, 'right', 50) }
    this.sparkles = this.add.particles(0, 0, 'sparkle', {
      speed: { min: 90 * this.dpr, max: 320 * this.dpr }, lifespan: 750, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 }, blendMode: 'ADD', emitting: false,
    }).setDepth(60)
    this.leafBurst = this.add.particles(0, 0, 'leaf', {
      speed: { min: 60 * this.dpr, max: 180 * this.dpr }, lifespan: 1100, gravityY: 260 * this.dpr, scale: { start: 0.55, end: 0.25 },
      rotate: { min: 0, max: 360 }, alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(41)
    if (this.debug) {
      this.debugBody = this.add.graphics().setDepth(20)
      this.debugGfx = this.add.graphics().setDepth(90)
    }
    this.layout = this.computeLayout()
    this.relayoutStatic()
    this.unsubscribe = this.controller.subscribe((effect) => this.onEffect(effect))
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.onPostRender, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown())
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown())
  }

  private teardown(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.game.events.off(Phaser.Core.Events.POST_RENDER, this.onPostRender, this)
  }

  private onPostRender(): void {
    const now = performance.now()
    perf.frame(now)
    this.controller.markRendered(now)
  }

  // ---------- textures & world ----------

  private paintStaticTextures(): void {
    const d = this.dpr
    paintTexture(this, 'apple', 160, 160, (ctx, w) => paintApple(ctx, w))
    paintTexture(this, 'twig', 140, 140, (ctx, w) => paintTwig(ctx, w))
    paintTexture(this, 'leaf', 48, 48, (ctx, w) => paintLeaf(ctx, w))
    paintTexture(this, 'sparkle', 48, 48, (ctx, w) => paintSparkle(ctx, w))
    paintTexture(this, 'glow', 128, 128, (ctx, w) => paintGlow(ctx, w, 'rgba(255, 255, 255, 1)'))
    paintTexture(this, 'apple-halo', 128, 128, (ctx, w) => paintGlow(ctx, w, 'rgba(255, 236, 160, 1)'))
    paintTexture(this, 'pollen', 24, 24, (ctx, w) => paintGlow(ctx, w, 'rgba(255, 248, 210, 1)'))
    paintTexture(this, 'basket', 260 * d, 170 * d, (ctx, w, h) => paintBasket(ctx, w, h))
    paintTexture(this, 'butterfly-a', 48, 48, (ctx, w) => paintButterfly(ctx, w, '#ffd36b'))
    paintTexture(this, 'butterfly-b', 48, 48, (ctx, w) => paintButterfly(ctx, w, '#a9d8ff'))
    for (let i = 0; i < 3; i += 1) paintTexture(this, `cloud${i}`, 420, 160, (ctx, w, h) => paintCloud(ctx, w, h, 40 + i))
  }

  private paintBackground(): void {
    const W = this.scale.width
    const H = this.scale.height
    // Two layers so clouds can drift between the sky and the trees (2.5D depth).
    paintTexture(this, 'apple-sky', W, H, (ctx, w, h) => {
      paintSky(ctx, w, h, { x: 0.82, y: 0.14 })
      paintHills(ctx, w, h, 3, 0.56, 0.07, PALETTE.hillFar, '#cfe9d2')
      paintTreeLine(ctx, w, h, 5, 0.62, h * 0.06, PALETTE.forestFar, 'rgba(170, 215, 175, 0.5)')
      paintHills(ctx, w, h, 8, 0.7, 0.05, PALETTE.hillMid, PALETTE.hillFar)
    })
    paintTexture(this, 'apple-land', W, H, (ctx, w, h) => {
      paintOrchard(ctx, w, h, 4, { y0: h * 0.17, y1: h * 0.58, groundY: h * 0.86 })
      paintMeadow(ctx, w, h, 6, h * 0.8)
    })
  }

  private buildBackground(): void {
    this.paintBackground()
    this.bg = this.add.image(0, 0, 'apple-sky').setOrigin(0).setDepth(0)
    this.land = this.add.image(0, 0, 'apple-land').setOrigin(0).setDepth(3)
    this.buildAmbient()
  }

  private buildAmbient(): void {
    for (const object of [...this.clouds, ...this.ambient]) {
      this.tweens.killTweensOf(object)
      object.destroy()
    }
    const W = this.scale.width
    const H = this.scale.height
    // drifting clouds
    this.clouds = [0, 1, 2].map((i) => {
      const cloud = this.add.image(W * (0.15 + i * 0.33), H * (0.1 + (i % 2) * 0.05), `cloud${i}`).setDepth(1).setAlpha(0.9)
      cloud.setScale((W / 1600) * (0.8 + i * 0.15))
      this.tweens.add({ targets: cloud, x: cloud.x + W * 0.12, duration: 26000 + i * 7000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
      return cloud
    })
    // floating pollen motes (micro-fantasy, very cheap)
    const pollen = this.add.particles(0, 0, 'pollen', {
      x: { min: 0, max: W }, y: { min: H * 0.25, max: H * 0.95 }, lifespan: 7000, frequency: 420, quantity: 1,
      speedY: { min: -14 * this.dpr, max: -32 * this.dpr }, speedX: { min: -10 * this.dpr, max: 10 * this.dpr },
      scale: { min: 0.35 * this.dpr, max: 0.8 * this.dpr },
      alpha: { onUpdate: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.75 },
      blendMode: 'ADD',
    }).setDepth(5)
    // the occasional falling leaf from the canopy
    const leaves = this.add.particles(0, 0, 'leaf', {
      x: { min: W * 0.05, max: W * 0.95 }, y: { min: H * 0.3, max: H * 0.55 }, lifespan: 5200, frequency: 1700, quantity: 1,
      speedY: { min: 30 * this.dpr, max: 60 * this.dpr }, speedX: { min: -25 * this.dpr, max: 25 * this.dpr },
      rotate: { start: 0, end: 360 }, scale: { min: 0.35, max: 0.6 }, alpha: { start: 0.9, end: 0 },
    }).setDepth(6)
    const butterflies = ['butterfly-a', 'butterfly-b'].map((key, i) => {
      const b = this.add.image(W * (0.15 + i * 0.7), H * 0.82, key).setDepth(7).setScale(this.dpr * 0.9)
      this.tweens.add({ targets: b, scaleX: { from: this.dpr * 0.9, to: this.dpr * 0.2 }, duration: 140 + i * 30, yoyo: true, repeat: -1 })
      this.wander(b, i)
      return b
    })
    this.ambient = [pollen, leaves, ...butterflies]
  }

  private wander(target: Phaser.GameObjects.Image, i: number): void {
    const W = this.scale.width
    const H = this.scale.height
    const side = i === 0 ? 0 : 0.72
    this.tweens.add({
      targets: target,
      x: W * (side + Math.random() * 0.26), y: H * (0.74 + Math.random() * 0.16),
      duration: 3200 + Math.random() * 2500, ease: 'Sine.easeInOut',
      onComplete: () => target.active && this.wander(target, i),
    })
  }

  private onResize(): void {
    this.resizeTimer?.remove()
    this.resizeTimer = this.time.delayedCall(180, () => {
      this.paintBackground()
      this.bg?.setTexture('apple-sky')
      this.land?.setTexture('apple-land')
      this.buildAmbient()
      this.layout = this.computeLayout()
      this.relayoutStatic()
    })
  }

  private relayoutStatic(): void {
    const W = this.scale.width
    const H = this.scale.height
    const basketW = Math.min(W * 0.17, 280 * this.dpr)
    this.basket.setDisplaySize(basketW, basketW * (170 / 260))
    this.basket.setPosition(W / 2, H - this.basket.displayHeight / 2 - H * 0.015)
    this.pile.forEach((apple, i) => apple.setPosition(...this.pileSlot(i)))
  }

  private pileSlot(i: number): [number, number] {
    const b = this.basket
    const cols = [-0.28, -0.1, 0.1, 0.28, -0.18, 0, 0.18, -0.06, 0.06]
    const rows = [0, 0, 0, 0, -1, -1, -1, -2, -2]
    const k = i % cols.length
    return [b.x + cols[k] * b.displayWidth, b.y - b.displayHeight * 0.2 + rows[k] * b.displayHeight * 0.12]
  }

  // ---------- body space → screen ----------

  private computeLayout(): Layout {
    const W = this.scale.width
    const H = this.scale.height
    const ext = this.controller.round.reach.extents()
    const top = H * HUD_TOP_FRACTION
    const bottom = H * 0.03
    const usableW = W * 0.9
    const usableH = H - top - bottom
    const s = Math.min(usableW / (ext.right - ext.left), usableH / (ext.bottom - ext.top))
    return {
      s,
      ax: W / 2 - (s * (ext.left + ext.right)) / 2,
      ay: top + (usableH - s * (ext.bottom - ext.top)) / 2 - s * ext.top,
    }
  }

  private toScreen(p: Point): { x: number; y: number } {
    return { x: this.layout.ax + p.x * this.layout.s, y: this.layout.ay + p.y * this.layout.s }
  }

  // ---------- frame loop ----------

  update(time: number): void {
    const now = performance.now()
    this.controller.step(now)
    // the comfortable area may grow during play: follow it smoothly, never jump
    this.layoutGoal = this.computeLayout()
    const g = this.layoutGoal
    const l = this.layout
    if (Math.abs(g.s - l.s) > 0.5 || Math.abs(g.ax - l.ax) > 0.5 || Math.abs(g.ay - l.ay) > 0.5) {
      this.layout = { s: l.s + (g.s - l.s) * 0.04, ax: l.ax + (g.ax - l.ax) * 0.04, ay: l.ay + (g.ay - l.ay) * 0.04 }
    }
    this.drawApple(time)
    this.drawCursors(now)
    if (this.debugBody) drawDebugBody(this.debugBody, this.controller.latestFrame(), (p) => this.toScreen(p), this.layout.s, this.dpr)
    if (this.debugGfx) this.drawDebug()
  }

  private drawCursors(now: number): void {
    // a little smaller than the apple, so the apple stays visible under the hand
    const size = Math.max(54 * this.dpr, 0.3 * this.layout.s)
    for (const side of ['left', 'right'] as const) {
      const c = this.controller.cursor(side, now)
      const cursor = this.cursors[side]
      cursor.setSize(size)
      cursor.update(now, { position: c.position ? this.toScreen(c.position) : null, sampleAt: c.sampleAt ?? undefined, tracked: c.tracked, pose: c.pose, near: c.near }, 1 / this.layout.s)
    }
  }

  private drawApple(time: number): void {
    const target = this.controller.target()
    const view = this.appleView
    this.holdRing.clear()
    if (!view || !target || view.id !== target.id) return
    const p = this.toScreen(target.center)
    const rPx = target.radius * this.layout.s
    const progress = this.controller.holdProgress
    view.hover += ((this.controller.appleNear() || progress > 0 ? 1 : 0) - view.hover) * 0.18
    const hover = view.hover
    // the apple loosens from the twig as the hold fills: the sway grows into a little shake
    const sway = Math.sin(time / 600 + view.id) * 0.06 + (progress > 0 ? Math.sin(time / 38) * 0.05 * (0.3 + progress) : 0)
    const size = rPx * 1.55 * (1 + 0.08 * hover)
    view.apple.setPosition(p.x, p.y).setRotation(sway)
    if (!view.apple.getData('popping')) view.apple.setDisplaySize(size * view.apple.getData('grow'), size * view.apple.getData('grow'))
    view.twig.setPosition(p.x + rPx * 0.05, p.y - rPx * 0.95).setDisplaySize(rPx * 1.6, rPx * 1.6).setRotation(sway * 0.5 - progress * 0.12)
    const haloSize = rPx * (3 + hover * 0.6)
    view.halo.setPosition(p.x, p.y).setDisplaySize(haloSize, haloSize).setAlpha((0.12 + 0.55 * hover) * view.twig.alpha)
    view.zone.clear()
    view.zone.lineStyle(Math.max(2, (2.5 + 1.5 * hover) * this.dpr), 0xffffff, 0.5 + 0.4 * hover)
    view.zone.strokeCircle(p.x, p.y, rPx)
    view.zone.fillStyle(0xffffff, 0.08 + 0.1 * hover)
    view.zone.fillCircle(p.x, p.y, rPx)
    if (progress > 0) {
      const width = Math.max(8 * this.dpr, 0.16 * rPx)
      const ringR = rPx + width * 0.9
      this.holdRing.lineStyle(width, 0x1f3a2e, 0.25)
      this.holdRing.strokeCircle(p.x, p.y, ringR)
      this.holdRing.lineStyle(width, GOLD, 1)
      this.holdRing.beginPath()
      this.holdRing.arc(p.x, p.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false)
      this.holdRing.strokePath()
      // bright head of the progress arc
      const head = -Math.PI / 2 + Math.PI * 2 * progress
      this.holdRing.fillStyle(0xfff6c9, 1)
      this.holdRing.fillCircle(p.x + Math.cos(head) * ringR, p.y + Math.sin(head) * ringR, width * 0.62)
    }
  }

  private drawDebug(): void {
    const g = this.debugGfx!
    g.clear()
    const t = this.controller.target()
    if (t) {
      const c = this.toScreen(t.center)
      g.lineStyle(2, 0xff00ff, 0.9)
      g.strokeCircle(c.x, c.y, t.radius * this.layout.s)
      g.lineStyle(1, 0xff00ff, 0.6)
      g.strokeCircle(c.x, c.y, (t.radius + 0.08) * this.layout.s)
    }
    // personal comfortable area (fan outline) per side
    for (const side of ['left', 'right'] as const) {
      const reach = this.controller.round.reach.sides[side]
      const o = this.toScreen(reach.shoulder)
      const r = reach.armLength * this.layout.s
      const out = side === 'left' ? -1 : 1
      const end = (reach.maxElevationDeg * Math.PI) / 180
      g.lineStyle(1.5, 0x00ffff, 0.7)
      g.beginPath()
      g.moveTo(o.x, o.y)
      for (let a = 0; a <= end + 1e-6; a += end / 24) g.lineTo(o.x + out * Math.sin(a) * r, o.y + Math.cos(a) * r)
      g.closePath()
      g.strokePath()
    }
  }

  // ---------- effects ----------

  private onEffect(effect: ControllerEffect): void {
    switch (effect.type) {
      case 'spawn': this.spawnApple(effect.target); break
      case 'collect': this.collectApple(effect.side, effect.points, effect.combo); break
      case 'expire': this.expireApple(); break
      case 'milestone': this.milestone(effect.combo); break
      case 'end': this.finish(); break
      default: break
    }
  }

  private spawnApple(target: AppleTarget): void {
    this.clearAppleView()
    const apple = this.add.image(0, 0, 'apple').setDepth(40).setData('grow', 0.01).setData('popping', false)
    const twig = this.add.image(0, 0, 'twig').setDepth(39).setAlpha(0)
    const zone = this.add.graphics().setDepth(38).setAlpha(0)
    const halo = this.add.image(0, 0, 'apple-halo').setDepth(37).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0)
    this.appleView = { id: target.id, target, apple, twig, zone, halo, bornAt: this.time.now, hover: 0 }
    this.tweens.addCounter({ from: 0.01, to: 1, duration: 520, ease: 'Back.easeOut', onUpdate: (tw) => apple.active && apple.setData('grow', tw.getValue()) })
    this.tweens.add({ targets: [twig, zone], alpha: 1, duration: 400 })
    const p = this.toScreen(target.center)
    this.leafBurst.explode(5, p.x, p.y - target.radius * this.layout.s)
    sfx.appear()
  }

  private clearAppleView(): void {
    const v = this.appleView
    if (!v) return
    v.zone.destroy()
    v.twig.destroy()
    v.halo.destroy()
    if (!v.apple.getData('popping')) v.apple.destroy()
    this.appleView = null
  }

  /** Expanding white ring: the instant "got it!" flash. */
  private ringBurst(x: number, y: number, r: number): void {
    const g = this.burst
    this.tweens.addCounter({
      from: 0, to: 1, duration: 360, ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0
        g.clear()
        g.lineStyle(Math.max(3, 10 * this.dpr * (1 - t)), 0xffffff, 1 - t)
        g.strokeCircle(x, y, r * (0.8 + 1.1 * t))
        g.fillStyle(0xfff6c9, 0.45 * (1 - t))
        g.fillCircle(x, y, r * (0.7 + 0.5 * t))
      },
      onComplete: () => g.clear(),
    })
  }

  private collectApple(side: Side, points: number, combo: number): void {
    const v = this.appleView
    if (!v) return
    this.appleView = null
    const apple = v.apple
    apple.setData('popping', true).setDepth(70)
    const start = { x: apple.x, y: apple.y }
    const end = { x: this.basket.x, y: this.basket.y - this.basket.displayHeight * 0.25 }
    const control = { x: (start.x + end.x) / 2 + (start.x < end.x ? -1 : 1) * this.scale.width * 0.04, y: Math.min(start.y, end.y) - this.scale.height * 0.18 }
    const size = apple.displayWidth
    this.sparkles.explode(22, start.x, start.y)
    this.leafBurst.explode(6, start.x, start.y - size * 0.4)
    this.ringBurst(start.x, start.y, size * 0.55)
    this.cameras.main.shake(90, 0.0025)
    this.cursors[side].celebrate()
    v.twig.destroy()
    v.zone.destroy()
    v.halo.destroy()
    this.floatText(`+${points}`, start.x, start.y - size * 0.7, '#fff6c9', 34)
    if (combo >= 2) this.floatText(`连摘 ×${combo}`, start.x, start.y - size * 1.25, '#ffd36b', 26, 120)
    sfx.collect(combo)
    this.tweens.add({ targets: apple, displayWidth: size * 1.3, displayHeight: size * 1.3, duration: 120, yoyo: true })
    const endSize = this.basket.displayWidth * 0.26
    this.tweens.addCounter({
      from: 0, to: 1, duration: 680, delay: 140, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0
        const u = 1 - t
        apple.setPosition(u * u * start.x + 2 * u * t * control.x + t * t * end.x, u * u * start.y + 2 * u * t * control.y + t * t * end.y)
        apple.setDisplaySize(size + (endSize - size) * t, size + (endSize - size) * t)
        apple.setRotation(t * Math.PI * 1.5)
      },
      onComplete: () => {
        apple.destroy()
        this.landInBasket()
      },
    })
  }

  private landInBasket(): void {
    sfx.land()
    this.sparkles.explode(8, this.basket.x, this.basket.y - this.basket.displayHeight * 0.3)
    this.tweens.add({ targets: this.basket, scaleY: this.basket.scaleY * 0.9, scaleX: this.basket.scaleX * 1.06, duration: 90, yoyo: true, ease: 'Quad.easeOut' })
    if (this.pile.length < 9) {
      const size = this.basket.displayWidth * 0.24
      const [x, y] = this.pileSlot(this.pile.length)
      const piece = this.add.image(x, y, 'apple').setDisplaySize(size, size).setDepth(31).setRotation((Math.random() - 0.5) * 0.6)
      this.pile.push(piece)
    }
  }

  private expireApple(): void {
    const v = this.appleView
    if (!v) return
    this.appleView = null
    // the apple simply floats back up into the leaves — no failure sound, no text
    v.halo.destroy()
    this.tweens.add({ targets: [v.apple, v.twig, v.zone], alpha: 0, y: '-=40', duration: 700, ease: 'Sine.easeIn', onComplete: () => { v.apple.destroy(); v.twig.destroy(); v.zone.destroy() } })
  }

  private milestone(combo: number): void {
    const W = this.scale.width
    const H = this.scale.height
    sfx.milestone()
    const text = this.add.text(W / 2, H * 0.3, combo >= 10 ? `了不起！连摘 ${combo} 个` : `太棒了！连摘 ${combo} 个`, {
      fontFamily: FONT_FAMILY, fontSize: `${Math.round(46 * this.dpr)}px`, fontStyle: 'bold', color: '#fff6c9',
      stroke: '#2f6b4f', strokeThickness: Math.round(8 * this.dpr),
    }).setOrigin(0.5).setDepth(80).setScale(0.4).setAlpha(0)
    this.tweens.add({ targets: text, scale: 1, alpha: 1, duration: 360, ease: 'Back.easeOut' })
    this.tweens.add({ targets: text, alpha: 0, y: H * 0.26, delay: 1300, duration: 500, onComplete: () => text.destroy() })
    for (let i = 0; i < 5; i += 1) this.time.delayedCall(i * 90, () => this.sparkles.explode(10, W * (0.3 + Math.random() * 0.4), H * (0.24 + Math.random() * 0.12)))
  }

  private finish(): void {
    this.clearAppleView()
  }

  private floatText(content: string, x: number, y: number, color: string, size: number, delay = 0): void {
    const text = this.add.text(x, y, content, {
      fontFamily: FONT_FAMILY, fontSize: `${Math.round(size * this.dpr)}px`, fontStyle: 'bold', color,
      stroke: '#2f6b4f', strokeThickness: Math.round(6 * this.dpr),
    }).setOrigin(0.5).setDepth(85).setAlpha(0)
    this.tweens.add({ targets: text, alpha: 1, y: y - 20 * this.dpr, duration: 200, delay })
    this.tweens.add({ targets: text, alpha: 0, y: y - 70 * this.dpr, duration: 600, delay: delay + 650, onComplete: () => text.destroy() })
  }
}
