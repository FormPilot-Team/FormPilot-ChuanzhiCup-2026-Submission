// Boating renderer (Phaser). A pseudo-3D river seen from just behind the player's boat: scenery,
// ripples, lanterns and landmarks are placed at (lateral x, distance z) in metres and projected, so
// the river streams toward the player exactly as fast as the boat moves. All rules live in
// round.ts / controller.ts; this file only draws them.
//
// The shared hand language: each hand has a stroke track (划桨轨迹提示) at its side of the screen. Round 1
// made it a real guide: the start point says 从这里开始, the track fills in gold as the hand moves out
// ("I have done 60 %") and drains as it comes back, an arrow shows the direction, and the whole track
// flashes when the stroke counts. The hand cursor rides along it and the oar follows the same progress,
// eased every rendered frame (the pose only arrives at ~30 Hz). Until a side has paddled, a translucent
// ghost hand demonstrates the stroke a few times. A pulsing guide dot shows the side to paddle next
// (节奏引导点), turning gold when a lantern is waiting there.
import * as Phaser from 'phaser'
import type { Point, Side } from '../../motion/contracts'
import { sfx } from '../../shared/audio'
import { HandCursor, handTextureKey, paintHandTextures } from '../../shared/handCursor'
import { perf } from '../../shared/perf'
import { FONT_FAMILY, paintTexture } from '../../shared/phaserHost'
import { drawDebugBody } from '../../shared/play/debugOverlay'
import { paintGlow, paintLeaf, paintSparkle } from '../../shared/world/painters'
import { Follow1D } from '../../shared/smoothing'
import { HAND_ACCENT } from '../../shared/world/palette'
import {
  paintBoat, paintLandmark, paintLantern, paintLilyPad, paintOar, paintPine, paintReeds, paintRiverBanks, paintRiverSky, paintRipple,
  paintRock, paintRoundTree,
} from '../../shared/world/river'
import { LANDMARKS } from './config'
import type { BoatController, BoatControllerEffect, OarView } from './controller'
import type { Lantern } from './round'

export interface BoatSceneData {
  controller: BoatController
  dpr: number
  debug: boolean
}

const HORIZON = 0.42
const CAM_H = 1.5
const Z_NEAR = 2.2
const Z_FAR = 85
/** the boat sits this far in front of the camera */
const Z_BOAT = 2.6
const RIVER_HALF = 2.4
const LANTERN_X = 1.75

/** Ghost-hand demonstration: out, back, a short rest (ms); loops before waiting for the player. */
const DEMO = Object.freeze({ outMs: 900, backMs: 750, restMs: 450, loops: 3, idleReplayMs: 10_000, replayLoops: 2 })

interface WorldSprite {
  image: Phaser.GameObjects.Image
  /** absolute river distance (m) */
  at: number
  x: number
  /** size in metres */
  w: number
  h: number
  kind: 'scenery' | 'ripple' | 'lantern' | 'landmark'
  lantern?: Lantern
  bob?: number
  /** collected lantern flying into the boat (its tween owns the image) */
  flying?: boolean
  dead?: boolean
}

interface Track {
  inner: Point
  control: Point
  outer: Point
}

export class BoatScene extends Phaser.Scene {
  private controller!: BoatController
  private dpr = 1
  private debug = false
  private sky?: Phaser.GameObjects.Image
  private banks?: Phaser.GameObjects.Image
  private sprites: WorldSprite[] = []
  private nextSceneryAt = 0
  private nextRippleAt = 0
  private landmarkIndex = 0
  private seenLanterns = new Set<number>()
  private boat!: Phaser.GameObjects.Image
  private oars!: Record<Side, Phaser.GameObjects.Image>
  private tracks!: Phaser.GameObjects.Graphics
  private guide!: Phaser.GameObjects.Graphics
  private cursors!: Record<Side, HandCursor>
  private splash!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private wake!: Phaser.GameObjects.Particles.ParticleEmitter
  private debugBody?: Phaser.GameObjects.Graphics
  private lastStroke: Record<Side, number> = { left: -Infinity, right: -Infinity }
  private lastSide: Side = 'right'
  private seed = 1
  private boatBaseY = 0
  private resizeTimer?: Phaser.Time.TimerEvent
  private readonly shown: Record<Side, Follow1D> = { left: new Follow1D(45), right: new Follow1D(45) }
  private startLabels!: Record<Side, Phaser.GameObjects.Text>
  private ghosts!: Record<Side, Phaser.GameObjects.Image>
  private demo: { side: Side; startedAt: number; loopsLeft: number } | null = null
  private demoBudget: number = DEMO.loops
  private demoStrokes = 0
  private lastAnyStroke = 0

  constructor() {
    super('boating')
  }

  init(data: BoatSceneData): void {
    this.controller = data.controller
    this.dpr = data.dpr
    this.debug = data.debug
  }

  create(): void {
    this.paintSprites()
    this.paintBackdrop()
    this.sky = this.add.image(0, 0, 'river-sky').setOrigin(0).setDepth(0)
    this.banks = this.add.image(0, 0, 'river-banks').setOrigin(0).setDepth(1)
    this.boat = this.add.image(0, 0, 'boat').setDepth(300)
    this.oars = {
      left: this.add.image(0, 0, 'oar').setOrigin(0.04, 0.5).setFlipX(true).setDepth(299),
      right: this.add.image(0, 0, 'oar').setOrigin(0.04, 0.5).setDepth(299),
    }
    this.oars.left.setOrigin(0.96, 0.5)
    this.tracks = this.add.graphics().setDepth(390)
    this.guide = this.add.graphics().setDepth(391)
    paintHandTextures(this, this.dpr)
    this.cursors = { left: new HandCursor(this, 'left', 400), right: new HandCursor(this, 'right', 400) }
    const label = (side: Side) => this.add.text(0, 0, '从这里开始', {
      fontFamily: FONT_FAMILY, fontSize: `${Math.round(22 * this.dpr)}px`, fontStyle: 'bold', color: '#fffaf0',
      stroke: '#2f6b4f', strokeThickness: Math.round(6 * this.dpr),
    }).setOrigin(0.5, 1).setDepth(392).setAlpha(0).setName(`start-${side}`)
    this.startLabels = { left: label('left'), right: label('right') }
    this.ghosts = {
      left: this.add.image(0, 0, handTextureKey('left', 'open')).setOrigin(0.5, 0.61).setDepth(395).setAlpha(0),
      right: this.add.image(0, 0, handTextureKey('right', 'open')).setOrigin(0.5, 0.61).setDepth(395).setAlpha(0),
    }
    this.splash = this.add.particles(0, 0, 'droplet', {
      speed: { min: 80 * this.dpr, max: 260 * this.dpr }, angle: { min: 200, max: 340 }, gravityY: 600 * this.dpr, lifespan: 700,
      scale: { start: 0.9, end: 0.2 }, alpha: { start: 0.95, end: 0 }, emitting: false,
    }).setDepth(302)
    this.sparkles = this.add.particles(0, 0, 'sparkle', {
      speed: { min: 80 * this.dpr, max: 280 * this.dpr }, lifespan: 750, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 }, blendMode: 'ADD', emitting: false,
    }).setDepth(420)
    // golden wake along the boat while the rhythm is steady ("顺流")
    this.wake = this.add.particles(0, 0, 'sparkle', {
      lifespan: 900, frequency: -1, speedY: { min: 60 * this.dpr, max: 140 * this.dpr }, speedX: { min: -40 * this.dpr, max: 40 * this.dpr },
      scale: { start: 0.45, end: 0 }, alpha: { start: 0.9, end: 0 }, blendMode: 'ADD',
    }).setDepth(298)
    if (this.debug) this.debugBody = this.add.graphics().setDepth(450)
    this.relayout()
    const off = this.controller.subscribe((e) => this.onEffect(e))
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this)
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.onPostRender, this)
    const teardown = () => {
      off()
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this)
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.onPostRender, this)
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown)
    this.events.once(Phaser.Scenes.Events.DESTROY, teardown)
  }

  private onPostRender(): void {
    const now = performance.now()
    perf.frame(now)
    this.controller.markRendered(now)
  }

  // ---------- projection ----------

  private get horizonY(): number {
    return this.scale.height * HORIZON
  }

  private get focal(): number {
    return ((this.scale.height - this.horizonY) * Z_NEAR) / CAM_H
  }

  /** world (lateral x m, distance ahead z m) → screen point of the water/ground at that spot */
  private project(x: number, z: number): { x: number; y: number; scale: number } {
    const f = this.focal
    return { x: this.scale.width / 2 + (f * x) / z, y: this.horizonY + (f * CAM_H) / z, scale: f / z }
  }

  // ---------- textures ----------

  private paintSprites(): void {
    paintTexture(this, 'tree-round-0', 220, 300, (ctx, w, h) => paintRoundTree(ctx, w, h, 3))
    paintTexture(this, 'tree-round-1', 220, 300, (ctx, w, h) => paintRoundTree(ctx, w, h, 8))
    paintTexture(this, 'tree-pine', 160, 320, (ctx, w, h) => paintPine(ctx, w, h))
    paintTexture(this, 'reeds', 120, 120, (ctx, w, h) => paintReeds(ctx, w, h, 5))
    paintTexture(this, 'lily', 120, 70, (ctx, w, h) => paintLilyPad(ctx, w, h, false))
    paintTexture(this, 'lily-flower', 120, 70, (ctx, w, h) => paintLilyPad(ctx, w, h, true))
    paintTexture(this, 'rock', 120, 80, (ctx, w, h) => paintRock(ctx, w, h))
    paintTexture(this, 'ripple', 90, 30, (ctx, w, h) => paintRipple(ctx, w, h))
    paintTexture(this, 'lantern', 140, 140, (ctx, w) => paintLantern(ctx, w))
    paintTexture(this, 'boat', 420 * this.dpr, 260 * this.dpr, (ctx, w, h) => paintBoat(ctx, w, h))
    paintTexture(this, 'oar', 300, 40, (ctx, w, h) => paintOar(ctx, w, h))
    paintTexture(this, 'droplet', 24, 24, (ctx, w) => paintGlow(ctx, w, 'rgba(235, 250, 255, 1)'))
    paintTexture(this, 'sparkle', 48, 48, (ctx, w) => paintSparkle(ctx, w))
    paintTexture(this, 'leaf', 48, 48, (ctx, w) => paintLeaf(ctx, w))
    for (const kind of ['bridge', 'lotus', 'arch', 'falls', 'dock'] as const) {
      paintTexture(this, `landmark-${kind}`, 600, 300, (ctx, w, h) => paintLandmark(ctx, w, h, kind))
    }
  }

  private paintBackdrop(): void {
    const W = this.scale.width
    const H = this.scale.height
    const horizonY = this.horizonY
    paintTexture(this, 'river-sky', W, H, (ctx, w, h) => paintRiverSky(ctx, w, h, HORIZON))
    paintTexture(this, 'river-banks', W, H, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      paintRiverBanks(ctx, w, h, horizonY, (y) => ((y - horizonY) * RIVER_HALF) / CAM_H)
    })
  }

  private onResize(): void {
    this.resizeTimer?.remove()
    this.resizeTimer = this.time.delayedCall(180, () => {
      this.paintBackdrop()
      this.sky?.setTexture('river-sky')
      this.banks?.setTexture('river-banks')
      this.relayout()
    })
  }

  private relayout(): void {
    const W = this.scale.width
    const H = this.scale.height
    const boat = this.project(0, Z_BOAT)
    const boatW = 1.7 * boat.scale
    this.boatBaseY = Math.min(H - boatW * 0.18, boat.y)
    this.boat.setDisplaySize(boatW, boatW * (260 / 420)).setPosition(W / 2, this.boatBaseY)
  }

  /** Stroke track for a side, in screen px. */
  private track(side: Side): Track {
    const W = this.scale.width
    const H = this.scale.height
    const s = side === 'left' ? -1 : 1
    const x = (f: number) => W / 2 + s * W * f
    // a gentle, almost level outward arc at waist height: the path a relaxed forearm sweep really takes
    return { inner: { x: x(0.17), y: H * 0.74 }, control: { x: x(0.3), y: H * 0.79 }, outer: { x: x(0.41), y: H * 0.7 } }
  }

  private trackPoint(t: Track, u: number): Point {
    const v = 1 - u
    return {
      x: v * v * t.inner.x + 2 * v * u * t.control.x + u * u * t.outer.x,
      y: v * v * t.inner.y + 2 * v * u * t.control.y + u * u * t.outer.y,
    }
  }

  // ---------- frame loop ----------

  update(time: number): void {
    const now = performance.now()
    this.controller.step(now)
    const round = this.controller.round
    const d = round.distance
    this.spawnWorld(d)
    this.drawWorld(d, time)
    this.drawBoat(time)
    this.drawTracks(now, time)
    if (round.flow && round.speed > 1 && Math.random() < 0.5) {
      const side = Math.random() < 0.5 ? -1 : 1
      this.wake.emitParticle(1, this.scale.width / 2 + side * this.boat.displayWidth * (0.35 + Math.random() * 0.2), this.boat.y - this.boat.displayHeight * 0.1)
    }
    if (this.debugBody) {
      const W = this.scale.width
      const s = this.scale.height * 0.22
      drawDebugBody(this.debugBody, this.controller.latestFrame(), (p) => ({ x: W / 2 + p.x * s, y: this.scale.height * 0.25 + p.y * s }), s, this.dpr)
    }
  }

  private spawnWorld(d: number): void {
    const rand = () => {
      this.seed = (this.seed * 16807) % 2147483647
      return (this.seed - 1) / 2147483646
    }
    const add = (kind: WorldSprite['kind'], key: string, at: number, x: number, w: number, h: number, extra: Partial<WorldSprite> = {}) => {
      const image = this.add.image(-9999, -9999, key).setOrigin(0.5, 1)
      this.sprites.push({ image, at, x, w, h, kind, ...extra })
    }
    while (this.nextSceneryAt < d + Z_FAR) {
      const at = this.nextSceneryAt
      for (const s of [-1, 1]) {
        if (rand() < 0.75) {
          const key = rand() < 0.35 ? 'tree-pine' : rand() < 0.5 ? 'tree-round-0' : 'tree-round-1'
          const size = 3.5 + rand() * 3
          add('scenery', key, at + rand() * 2, s * (RIVER_HALF + 1.6 + rand() * 7), size * (key === 'tree-pine' ? 0.5 : 0.75), size)
        }
        if (rand() < 0.35) add('scenery', 'reeds', at + rand() * 2, s * (RIVER_HALF + 0.1 + rand() * 0.4), 0.9, 0.9)
        if (rand() < 0.22) add('scenery', rand() < 0.5 ? 'lily-flower' : 'lily', at + rand() * 2, s * (RIVER_HALF - 0.3 - rand() * 0.5), 0.8, 0.45)
        if (rand() < 0.08) add('scenery', 'rock', at + rand() * 2, s * (RIVER_HALF + 0.3), 1.1, 0.7)
      }
      this.nextSceneryAt += 3.2
    }
    while (this.nextRippleAt < d + 40) {
      add('ripple', 'ripple', this.nextRippleAt, (rand() - 0.5) * RIVER_HALF * 1.6, 0.7, 0.22)
      this.nextRippleAt += 0.9 + rand() * 0.6
    }
    while (this.landmarkIndex < LANDMARKS.length && LANDMARKS[this.landmarkIndex].at < d + Z_FAR) {
      const l = LANDMARKS[this.landmarkIndex++]
      const span = l.kind === 'bridge' || l.kind === 'arch'
      const x = span ? 0 : l.kind === 'falls' ? RIVER_HALF + 2.2 : l.kind === 'dock' ? -RIVER_HALF - 1.2 : -RIVER_HALF + 0.9
      add('landmark', `landmark-${l.kind}`, l.at + Z_BOAT, x, span ? RIVER_HALF * 2 + 3 : 5, span ? 3.6 : 2.6)
    }
    for (const lantern of this.controller.round.lanterns) {
      if (this.seenLanterns.has(lantern.id) || lantern.state !== 'pending') continue
      this.seenLanterns.add(lantern.id)
      add('lantern', 'lantern', lantern.at, lantern.side === 'left' ? -LANTERN_X : LANTERN_X, 1.1, 1.1, { lantern, bob: rand() * 6 })
    }
  }

  private drawWorld(d: number, time: number): void {
    const keep: WorldSprite[] = []
    for (const s of this.sprites) {
      if (s.dead) continue
      if (s.flying) {
        keep.push(s)
        continue
      }
      // the boat (and its lanterns) sit Z_BOAT in front of the camera
      const z = s.at - d + (s.kind === 'lantern' ? Z_BOAT : 0)
      if (z < 0.9 || (s.kind === 'lantern' && s.lantern!.state === 'collected')) {
        s.image.destroy()
        continue
      }
      keep.push(s)
      if (z > Z_FAR) {
        s.image.setVisible(false)
        continue
      }
      const p = this.project(s.x, z)
      const fadeIn = Math.min(1, (Z_FAR - z) / 12)
      const fadeOut = s.kind === 'landmark' || s.kind === 'scenery' ? Math.min(1, (z - 0.9) / 2.2) : 1
      s.image.setVisible(true).setPosition(p.x, p.y).setDisplaySize(s.w * p.scale, s.h * p.scale).setDepth(10 + 200 * (1 - z / Z_FAR))
      s.image.setAlpha(fadeIn * fadeOut * (s.kind === 'ripple' ? 0.6 : 1))
      if (s.kind === 'lantern') {
        const cue = this.controller.round.cue()
        const active = cue?.lantern.id === s.lantern!.id && cue.inWindow
        s.image.y += Math.sin(time / 420 + (s.bob ?? 0)) * p.scale * 0.06
        if (active) s.image.setScale(s.image.scaleX * (1.12 + 0.06 * Math.sin(time / 120)), s.image.scaleY * (1.12 + 0.06 * Math.sin(time / 120)))
        if (s.lantern!.state === 'missed') s.image.setAlpha(s.image.alpha * 0.5)
      }
    }
    this.sprites = keep
  }

  private drawBoat(time: number): void {
    const W = this.scale.width
    const round = this.controller.round
    const bob = Math.sin(time / 520) * this.boat.displayHeight * 0.015
    const recent = (side: Side) => Math.max(0, 1 - (performance.now() - this.lastStroke[side]) / 500)
    const tilt = (recent('left') - recent('right')) * 0.03 + Math.sin(time / 900) * 0.01
    this.boat.setRotation(tilt).setY(this.boatBaseY + bob - Math.min(1, round.speed / 4) * 2 * this.dpr)
    const oarLen = this.boat.displayWidth * 0.62
    for (const side of ['left', 'right'] as const) {
      const s = side === 'left' ? -1 : 1
      const oar = this.oars[side]
      // rest: blade forward (toward the horizon); stroke: swept back past the boat (eased progress)
      const angle = -0.55 + (this.shown[side].value ?? 0) * 0.95
      const pivot = { x: W / 2 + s * this.boat.displayWidth * 0.43, y: this.boat.y - this.boat.displayHeight * 0.12 }
      oar.setPosition(pivot.x, pivot.y).setDisplaySize(oarLen, oarLen * (40 / 300)).setRotation(s * angle)
    }
  }

  private drawTracks(now: number, time: number): void {
    const g = this.tracks
    const guide = this.guide
    g.clear()
    guide.clear()
    const width = Math.max(10 * this.dpr, this.scale.height * 0.016)
    const cue = this.controller.round.cue()
    const playing = this.controller.status === 'playing'
    const nextSide: Side = cue?.inWindow ? cue.lantern.side : this.lastSide === 'left' ? 'right' : 'left'
    const views = { left: this.controller.oar('left'), right: this.controller.oar('right') }
    this.updateDemo(now, nextSide, views, playing)
    for (const side of ['left', 'right'] as const) {
      const t = this.track(side)
      const view = views[side]
      const progress = this.shown[side].step(view.progress, now)
      const strokeFlash = Math.max(0, 1 - (now - this.lastStroke[side]) / 450)
      const path = (from: number, to: number) => {
        g.beginPath()
        const a = this.trackPoint(t, from)
        g.moveTo(a.x, a.y)
        for (let u = from; u <= to + 1e-6; u += 0.04) {
          const q = this.trackPoint(t, Math.min(u, to))
          g.lineTo(q.x, q.y)
        }
        g.strokePath()
      }
      // the path: soft shadow, then a light rail
      g.lineStyle(width + 6 * this.dpr, 0x1f3a2e, 0.2)
      path(0, 1)
      g.lineStyle(width, 0xffffff, 0.5 + 0.35 * strokeFlash)
      path(0, 1)
      // live fill: how far this stroke has got (it drains while the hand comes back)
      if (progress > 0.01) {
        g.lineStyle(width, HAND_ACCENT, view.returning ? 0.6 : 0.95)
        path(0, progress)
        g.lineStyle(Math.max(2, width * 0.3), 0xfff6c9, view.returning ? 0.35 : 0.8)
        path(0, progress)
      }
      // the whole track lights up when the stroke counts
      if (strokeFlash > 0) {
        g.lineStyle(width + 10 * this.dpr * strokeFlash, 0xfff6c9, 0.55 * strokeFlash)
        path(0, 1)
      }
      // direction: a chevron near the outer end, pointing outward along the track
      const a = this.trackPoint(t, 0.8)
      const b = this.trackPoint(t, 0.88)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const cs = width * 0.9
      g.lineStyle(Math.max(2, 3 * this.dpr), 0x2f6b4f, 0.55)
      g.beginPath()
      g.moveTo(b.x - Math.cos(ang - 0.6) * cs, b.y - Math.sin(ang - 0.6) * cs)
      g.lineTo(b.x, b.y)
      g.lineTo(b.x - Math.cos(ang + 0.6) * cs, b.y - Math.sin(ang + 0.6) * cs)
      g.strokePath()
      // start point (从这里开始) and the outer end (where the stroke counts)
      g.fillStyle(0xffffff, 0.95)
      g.fillCircle(t.inner.x, t.inner.y, width * 0.85)
      g.lineStyle(3 * this.dpr, 0x2f6b4f, 0.8)
      g.strokeCircle(t.inner.x, t.inner.y, width * 0.85)
      const endR = width * (0.95 + strokeFlash * 0.8)
      g.fillStyle(strokeFlash > 0 || progress > 0.85 ? 0xfff0b8 : 0xffffff, 0.92)
      g.fillCircle(t.outer.x, t.outer.y, endR)
      g.lineStyle(3 * this.dpr, HAND_ACCENT, 1)
      g.strokeCircle(t.outer.x, t.outer.y, endR)
      const label = this.startLabels[side]
      const showLabel = playing && view.strokes < 2
      // above a hand resting on the start point (the cursor reaches ~0.6 of its size above its centre)
      const cursorSize = Math.max(56 * this.dpr, this.scale.height * 0.085)
      label.setPosition(t.inner.x, t.inner.y - cursorSize * 0.68)
      label.setAlpha(label.alpha + ((showLabel ? 1 : 0) - label.alpha) * 0.12)
      // guide dot on the side to paddle next (gold when a lantern waits there)
      if (side === nextSide && playing) {
        const pulse = 0.5 + 0.5 * Math.sin(time / 260)
        const gold = Boolean(cue?.inWindow)
        guide.lineStyle(4 * this.dpr, gold ? 0xffc94d : 0xffffff, 0.4 + 0.5 * pulse)
        guide.strokeCircle(t.outer.x, t.outer.y, width * (1.6 + pulse * 0.9))
        if (gold) {
          guide.fillStyle(0xffc94d, 0.25 + 0.2 * pulse)
          guide.fillCircle(t.outer.x, t.outer.y, width * 2.2)
        }
      }
      const cursor = this.cursors[side]
      const size = Math.max(56 * this.dpr, this.scale.height * 0.085)
      cursor.setSize(size)
      cursor.update(now, { position: this.trackPoint(t, progress), tracked: view.tracked, pose: view.pose, near: view.cued }, 1 / (this.scale.height * 0.3))
      this.drawGhost(side, t, size, now)
    }
  }

  /**
   * Ghost hand: a translucent hand shows the stroke (out along the track and back) on the side to
   * paddle next, only until that side has paddled, only while the player's own hand there is at rest,
   * and at most a few loops; it returns for two loops if nobody has paddled for a while.
   */
  private updateDemo(now: number, nextSide: Side, views: Record<Side, OarView>, playing: boolean): void {
    if (!playing) {
      this.demo = null
      return
    }
    if (this.lastAnyStroke === 0) this.lastAnyStroke = now
    if (this.demoBudget === 0 && now - this.lastAnyStroke > DEMO.idleReplayMs) {
      this.demoBudget = DEMO.replayLoops
      this.lastAnyStroke = now
    }
    const loopMs = DEMO.outMs + DEMO.backMs + DEMO.restMs
    if (this.demo) {
      const view = views[this.demo.side]
      const loops = Math.floor((now - this.demo.startedAt) / loopMs)
      if (view.strokes > this.demoStrokes || view.progress > 0.2 || loops >= this.demo.loopsLeft) {
        this.demoBudget = Math.max(0, this.demoBudget - Math.max(1, Math.min(this.demo.loopsLeft, loops + 1)))
        this.demo = null
      }
      return
    }
    const view = views[nextSide]
    const idle = now - this.lastAnyStroke > DEMO.idleReplayMs * 0.9 || view.strokes === 0
    if (this.demoBudget > 0 && idle && view.tracked && view.progress < 0.1) {
      this.demo = { side: nextSide, startedAt: now, loopsLeft: this.demoBudget }
      this.demoStrokes = view.strokes
    }
  }

  private drawGhost(side: Side, t: Track, size: number, now: number): void {
    const ghost = this.ghosts[side]
    const demo = this.demo
    if (!demo || demo.side !== side) {
      ghost.setAlpha(Math.max(0, ghost.alpha - 0.06))
      return
    }
    const loopMs = DEMO.outMs + DEMO.backMs + DEMO.restMs
    const k = (now - demo.startedAt) % loopMs
    const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)))
    const u = k < DEMO.outMs ? ease(k / DEMO.outMs) : k < DEMO.outMs + DEMO.backMs ? 1 - ease((k - DEMO.outMs) / DEMO.backMs) : 0
    const q = this.trackPoint(t, u)
    const fade = Math.min(1, (now - demo.startedAt) / 300)
    ghost.setTexture(handTextureKey(side, k < DEMO.outMs ? 'half' : 'open'))
    ghost.setPosition(q.x, q.y).setDisplaySize(size * 0.92, size * 0.92).setAlpha(0.42 * fade)
  }

  /** Test / screenshot hook: is the ghost hand demonstrating right now, and on which side. */
  demoState(): { side: Side } | null {
    return this.demo ? { side: this.demo.side } : null
  }

  // ---------- effects ----------

  private onEffect(effect: BoatControllerEffect): void {
    switch (effect.type) {
      case 'stroke': this.onStroke(effect.side, effect.flow); break
      case 'lantern': this.collectLantern(effect.lantern, effect.points); break
      case 'flow': if (effect.on) { this.banner('顺流而下！', '#fff6c9'); sfx.flow() } break
      case 'landmark': this.banner(`到达${effect.name}  +${effect.points}`, '#fff6c9'); sfx.milestone(); break
      case 'milestone': this.banner(effect.combo >= 20 ? `了不起！连划 ${effect.combo} 下` : `太棒了！连划 ${effect.combo} 下`, '#ffe08a'); sfx.milestone(); break
      default: break
    }
  }

  private onStroke(side: Side, flow: boolean): void {
    this.lastStroke[side] = performance.now()
    this.lastAnyStroke = performance.now()
    this.lastSide = side
    const oar = this.oars[side]
    const s = side === 'left' ? -1 : 1
    const len = oar.displayWidth * 0.9
    // the right oar points along +x rotated by its angle, the (flipped) left oar along −x
    const blade = { x: oar.x + s * Math.cos(oar.rotation) * len, y: oar.y + s * Math.sin(oar.rotation) * len }
    this.splash.explode(flow ? 22 : 14, blade.x, Math.max(blade.y, this.boat.y))
    const end = this.track(side).outer
    this.sparkles.explode(8, end.x, end.y)
    this.cursors[side].celebrate()
    this.cameras.main.shake(70, 0.0018)
    sfx.stroke(side === 'left' ? 0 : 1, flow)
  }

  private collectLantern(lantern: Lantern, points: number): void {
    const s = this.sprites.find((w) => w.lantern?.id === lantern.id)
    const end = { x: this.scale.width / 2, y: this.boat.y - this.boat.displayHeight * 0.3 }
    sfx.collect(3)
    this.floatText(`+${points}`, s ? s.image.x : end.x, (s ? s.image.y : end.y) - 40 * this.dpr, '#fff6c9', 34)
    if (!s) return
    const img = s.image
    s.flying = true
    img.setDepth(380)
    this.sparkles.explode(18, img.x, img.y - img.displayHeight * 0.4)
    this.tweens.add({
      targets: img, x: end.x, y: end.y, displayWidth: img.displayWidth * 0.5, displayHeight: img.displayHeight * 0.5, duration: 520, ease: 'Sine.easeInOut',
      onComplete: () => {
        this.sparkles.explode(10, end.x, end.y)
        s.dead = true
        img.destroy()
      },
    })
  }

  private banner(content: string, color: string): void {
    const W = this.scale.width
    const H = this.scale.height
    const text = this.add.text(W / 2, H * 0.26, content, {
      fontFamily: FONT_FAMILY, fontSize: `${Math.round(42 * this.dpr)}px`, fontStyle: 'bold', color,
      stroke: '#2f6b4f', strokeThickness: Math.round(8 * this.dpr),
    }).setOrigin(0.5).setDepth(500).setScale(0.4).setAlpha(0)
    this.tweens.add({ targets: text, scale: 1, alpha: 1, duration: 360, ease: 'Back.easeOut' })
    this.tweens.add({ targets: text, alpha: 0, y: H * 0.22, delay: 1300, duration: 500, onComplete: () => text.destroy() })
  }

  private floatText(content: string, x: number, y: number, color: string, size: number): void {
    const text = this.add.text(x, y, content, {
      fontFamily: FONT_FAMILY, fontSize: `${Math.round(size * this.dpr)}px`, fontStyle: 'bold', color,
      stroke: '#2f6b4f', strokeThickness: Math.round(6 * this.dpr),
    }).setOrigin(0.5).setDepth(510).setAlpha(0)
    this.tweens.add({ targets: text, alpha: 1, y: y - 20 * this.dpr, duration: 200 })
    this.tweens.add({ targets: text, alpha: 0, y: y - 70 * this.dpr, duration: 600, delay: 650, onComplete: () => text.destroy() })
  }
}
