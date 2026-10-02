// Archery renderer (Phaser). Side-on forest range: the target stands down the lane on the bow-hand
// side; the bow is in the foreground with the two hand cursors on it — the bow hand on the grip, the
// string hand on the nock. Drawing pulls the nock back, the limbs flex, a reticle on the target shows
// where the arrow would land now (driven by the real bow-hand drift and steadiness) and tightens while
// the hold fills. RELEASE sends the arrow along that line; the hit is exactly the predicted point.
// Bow flex and reticle are eased every rendered frame (the pose only arrives at ~30 Hz); the hit itself is
// computed from the unsmoothed release data.
import * as Phaser from 'phaser'
import type { Point } from '../../motion/contracts'
import { sfx } from '../../shared/audio'
import { HandCursor, paintHandTextures } from '../../shared/handCursor'
import { perf } from '../../shared/perf'
import { FONT_FAMILY, paintTexture } from '../../shared/phaserHost'
import { drawDebugBody } from '../../shared/play/debugOverlay'
import { Follow1D } from '../../shared/smoothing'
import { paintSparkle } from '../../shared/world/painters'
import { paintArrow, paintRangeBackdrop, paintSign, paintTargetFace, paintTargetStand } from '../../shared/world/range'
import { RINGS, SHOT_TIMING, STAGES } from './config'
import { archeryHandPoses, type ArcheryController, type ArcheryControllerEffect } from './controller'
import { aimOffset, type Shot } from './round'

export interface ArcherySceneData {
  controller: ArcheryController
  dpr: number
  debug: boolean
}

const STAGE_RADIUS = [0.16, 0.13, 0.105] as const

export class ArcheryScene extends Phaser.Scene {
  private controller!: ArcheryController
  private dpr = 1
  private debug = false
  /** +1: target on screen-left (string hand = right); −1: mirrored */
  private m = 1
  private backdrop?: Phaser.GameObjects.Image
  private target!: Phaser.GameObjects.Image
  private stand!: Phaser.GameObjects.Image
  private sign!: Phaser.GameObjects.Image
  private bow!: Phaser.GameObjects.Graphics
  private reticle!: Phaser.GameObjects.Graphics
  private arrow!: Phaser.GameObjects.Image
  private stuck: Phaser.GameObjects.Image[] = []
  private cursors!: { bow: HandCursor; string: HandCursor }
  private sparkles!: Phaser.GameObjects.Particles.ParticleEmitter
  private straw!: Phaser.GameObjects.Particles.ParticleEmitter
  private debugBody?: Phaser.GameObjects.Graphics
  private stageView = 0
  private targetR = 0
  private flying = false
  private snapAt = -Infinity
  private creakLevel = 0
  private resizeTimer?: Phaser.Time.TimerEvent
  private readonly flexView = new Follow1D(40)
  private readonly aimView = { x: new Follow1D(60), y: new Follow1D(60) }

  constructor() {
    super('archery')
  }

  init(data: ArcherySceneData): void {
    this.controller = data.controller
    this.dpr = data.dpr
    this.debug = data.debug
    this.m = data.controller.drawSide === 'right' ? 1 : -1
  }

  create(): void {
    paintTexture(this, 'target-face', 360, 360, (ctx, w) => paintTargetFace(ctx, w))
    paintTexture(this, 'target-stand', 160, 200, (ctx, w, h) => paintTargetStand(ctx, w, h))
    paintTexture(this, 'arrow', 320, 40, (ctx, w, h) => paintArrow(ctx, w, h))
    paintTexture(this, 'sparkle', 48, 48, (ctx, w) => paintSparkle(ctx, w))
    paintTexture(this, 'straw', 16, 6, (ctx, w, h) => {
      ctx.fillStyle = '#e8cf86'
      ctx.fillRect(0, 0, w, h)
    })
    for (const s of STAGES) paintTexture(this, `sign-${s.distanceM}`, 160, 120, (ctx, w, h) => paintSign(ctx, w, h, `${s.distanceM} 米`))
    this.paintBackdrop()
    this.backdrop = this.add.image(0, 0, 'range').setOrigin(0).setDepth(0)
    this.stand = this.add.image(0, 0, 'target-stand').setOrigin(0.5, 0).setDepth(4)
    this.target = this.add.image(0, 0, 'target-face').setDepth(5)
    this.sign = this.add.image(0, 0, `sign-${STAGES[0].distanceM}`).setOrigin(0.5, 1).setDepth(3)
    this.reticle = this.add.graphics().setDepth(40)
    this.bow = this.add.graphics().setDepth(60)
    this.arrow = this.add.image(0, 0, 'arrow').setOrigin(0, 0.5).setDepth(61)
    paintHandTextures(this, this.dpr)
    const bowSide = this.controller.drawSide === 'right' ? 'left' : 'right'
    this.cursors = { bow: new HandCursor(this, bowSide, 70), string: new HandCursor(this, this.controller.drawSide, 72) }
    this.sparkles = this.add.particles(0, 0, 'sparkle', {
      speed: { min: 80 * this.dpr, max: 300 * this.dpr }, lifespan: 750, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 }, blendMode: 'ADD', emitting: false,
    }).setDepth(80)
    this.straw = this.add.particles(0, 0, 'straw', {
      speed: { min: 60 * this.dpr, max: 200 * this.dpr }, lifespan: 600, gravityY: 500 * this.dpr, rotate: { min: 0, max: 360 },
      alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(30)
    if (this.debug) this.debugBody = this.add.graphics().setDepth(90)
    this.targetR = this.scale.height * STAGE_RADIUS[0]
    this.layoutTarget()
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

  private paintBackdrop(): void {
    paintTexture(this, 'range', this.scale.width, this.scale.height, (ctx, w, h) => paintRangeBackdrop(ctx, w, h, this.m < 0))
  }

  private onResize(): void {
    this.resizeTimer?.remove()
    this.resizeTimer = this.time.delayedCall(180, () => {
      this.paintBackdrop()
      this.backdrop?.setTexture('range')
      this.targetR = this.scale.height * STAGE_RADIUS[this.stageView]
      this.layoutTarget()
    })
  }

  /** Screen x from a left-layout fraction (mirrored for a left-hand string). */
  private X(fraction: number): number {
    return this.m > 0 ? this.scale.width * fraction : this.scale.width * (1 - fraction)
  }

  private targetCenter(stage = this.stageView): Point {
    return { x: this.X(0.24 + 0.03 * stage), y: this.scale.height * (0.37 - 0.018 * stage) }
  }

  private layoutTarget(): void {
    const c = this.targetCenter()
    const r = this.targetR
    this.target.setPosition(c.x, c.y).setDisplaySize(r * 2.1, r * 2.1)
    const groundY = this.scale.height * 0.53
    this.stand.setPosition(c.x, c.y + r * 0.6).setDisplaySize(r * 1.5, Math.max(10, groundY - (c.y + r * 0.6)))
    this.sign.setPosition(c.x + this.m * r * 1.6, groundY + this.scale.height * 0.01).setDisplaySize(r * 0.9, r * 0.68)
  }

  // ---------- bow geometry ----------

  private bowGeometry(flex: number): { grip: Point; top: Point; bottom: Point; control: Point; nock: Point; L: number } {
    const H = this.scale.height
    const L = H * 0.25
    const grip = { x: this.X(0.58), y: H * 0.62 }
    const m = this.m
    const top = { x: grip.x + m * 0.15 * L * (1 + 0.6 * flex), y: grip.y - L * (1 - 0.05 * flex) }
    const bottom = { x: top.x, y: grip.y + L * (1 - 0.05 * flex) }
    const control = { x: grip.x - m * 0.38 * L, y: grip.y }
    const nock = { x: top.x + m * (0.02 + 0.95 * flex) * L, y: grip.y }
    return { grip: { x: (top.x + 2 * control.x + bottom.x) / 4, y: grip.y }, top, bottom, control, nock, L }
  }

  // ---------- frame loop ----------

  update(time: number): void {
    const now = performance.now()
    this.controller.step(now)
    const d = this.controller.draw()
    const playing = this.controller.status === 'playing'
    const sinceShot = this.controller.sinceShotMs(now)
    // string snaps back after a release with a short damped wobble
    const snapT = (now - this.snapAt) / 320
    const snap = snapT >= 0 && snapT < 1 ? Math.sin(snapT * Math.PI * 4) * (1 - snapT) * 0.12 : 0
    const live = playing && (d.phase === 'draw' || d.phase === 'hold' || d.phase === 'armed')
    // after a release the string snaps straight back (no easing), otherwise the flex glides
    if (sinceShot >= 0 && sinceShot < 60) this.flexView.snap(0, now)
    const flex = this.flexView.step(Math.max(0, Math.min(1.15, live ? d.drawRatio : 0)), now) + snap
    const g = this.bowGeometry(flex)
    this.drawBow(g, live)
    this.drawReticle(d.phase, d.holdProgress, live, time, now)
    // arrow on the string while drawing; hidden while one is in flight
    // the next arrow is nocked once the previous one has landed
    const showArrow = playing && !this.flying && (sinceShot < 0 || sinceShot > SHOT_TIMING.releaseShowMs + SHOT_TIMING.flightMs + SHOT_TIMING.hitShowMs)
    this.arrow.setVisible(showArrow)
    if (showArrow) {
      const aimAt = this.targetCenter()
      const angle = Math.atan2(aimAt.y - g.nock.y, aimAt.x - g.nock.x)
      const len = Math.abs(g.nock.x - g.grip.x) + g.L * 0.55
      this.arrow.setPosition(g.nock.x, g.nock.y).setRotation(angle + Math.PI).setDisplaySize(len, g.L * 0.07)
      this.arrow.setOrigin(1, 0.5)
    }
    // creak as the string tightens (three steps per draw)
    const level = live ? Math.min(3, Math.floor(d.drawRatio * 3)) : 0
    if (level > this.creakLevel) sfx.creak(level / 3)
    this.creakLevel = level
    // hands
    const phase = this.controller.phase(now)
    const poses = archeryHandPoses(phase, d.phase)
    const size = Math.max(56 * this.dpr, this.scale.height * 0.09)
    const scale = 1 / (this.scale.height * 0.3)
    this.cursors.bow.setSize(size)
    this.cursors.string.setSize(size)
    const bowSide = this.controller.drawSide === 'right' ? 'left' : 'right'
    this.cursors.bow.update(now, { position: g.grip, tracked: this.controller.tracked(bowSide), pose: poses.bow, near: d.phase === 'armed' }, scale)
    this.cursors.string.update(now, { position: g.nock, tracked: this.controller.tracked(this.controller.drawSide), pose: poses.string, near: d.phase === 'armed' }, scale)
    if (this.debugBody) {
      const W = this.scale.width
      const s = this.scale.height * 0.16
      drawDebugBody(this.debugBody, this.controller.latestFrame(), (p) => ({ x: W / 2 + p.x * s, y: this.scale.height * 0.2 + p.y * s }), s, this.dpr)
    }
  }

  private drawBow(g: ReturnType<ArcheryScene['bowGeometry']>, live: boolean): void {
    const b = this.bow
    b.clear()
    const w = Math.max(6, g.L * 0.07)
    // limbs: dark outline, wood, highlight
    const limb = (width: number, color: number, alpha: number) => {
      b.lineStyle(width, color, alpha)
      b.beginPath()
      b.moveTo(g.top.x, g.top.y)
      for (let t = 0.05; t <= 1.0001; t += 0.05) {
        const u = 1 - t
        b.lineTo(u * u * g.top.x + 2 * u * t * g.control.x + t * t * g.bottom.x, u * u * g.top.y + 2 * u * t * g.control.y + t * t * g.bottom.y)
      }
      b.strokePath()
    }
    limb(w + 6 * this.dpr, 0x1f3a2e, 0.25)
    limb(w, 0x8a5a32, 1)
    limb(w * 0.35, 0xe2b47d, 0.9)
    // grip wrap
    b.fillStyle(0x553623, 1)
    b.fillRoundedRect(g.grip.x - w * 0.8, g.grip.y - g.L * 0.12, w * 1.6, g.L * 0.24, w * 0.5)
    // string
    b.lineStyle(Math.max(2, 2.5 * this.dpr), live ? 0xfffaf0 : 0xf4ead2, 1)
    b.beginPath()
    b.moveTo(g.top.x, g.top.y)
    b.lineTo(g.nock.x, g.nock.y)
    b.lineTo(g.bottom.x, g.bottom.y)
    b.strokePath()
  }

  private drawReticle(phase: string, holdProgress: number, live: boolean, time: number, now: number): void {
    const r = this.reticle
    r.clear()
    if (!live || this.flying) {
      this.aimView.x.reset()
      this.aimView.y.reset()
      return
    }
    const d = this.controller.draw()
    const c = this.targetCenter()
    const offset = aimOffset({ aim: d.aim, stability: d.stability, drawRatio: Math.max(d.drawRatio, phase === 'draw' ? 0 : 1) }, this.controller.round.params, STAGES[this.stageView].offsetScale)
    const p = { x: c.x + this.aimView.x.step(offset.x, now) * this.targetR, y: c.y + this.aimView.y.step(offset.y, now) * this.targetR }
    const armed = phase === 'armed'
    const size = this.targetR * (phase === 'draw' ? 0.55 : 0.18 + 0.32 * (1 - holdProgress))
    const color = armed ? 0xffc94d : 0xffffff
    const alpha = phase === 'draw' ? 0.5 : 0.95
    r.lineStyle(Math.max(3, 4 * this.dpr), 0x1f3a2e, 0.35 * alpha)
    r.strokeCircle(p.x, p.y, size + 2 * this.dpr)
    r.lineStyle(Math.max(2, 3 * this.dpr), color, alpha)
    r.strokeCircle(p.x, p.y, size)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      r.beginPath()
      r.moveTo(p.x + dx * size * 0.55, p.y + dy * size * 0.55)
      r.lineTo(p.x + dx * size * 1.25, p.y + dy * size * 1.25)
      r.strokePath()
    }
    if (phase === 'hold' || armed) {
      // the hold fills a gold ring around the reticle
      const ringR = size + 10 * this.dpr
      r.lineStyle(Math.max(5, 7 * this.dpr), 0x1f3a2e, 0.25)
      r.strokeCircle(p.x, p.y, ringR)
      r.lineStyle(Math.max(5, 7 * this.dpr), 0xffc94d, 1)
      r.beginPath()
      r.arc(p.x, p.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * holdProgress, false)
      r.strokePath()
      if (armed) {
        const pulse = 0.5 + 0.5 * Math.sin(time / 130)
        r.lineStyle(3 * this.dpr, 0xfff6c9, 0.4 + 0.5 * pulse)
        r.strokeCircle(p.x, p.y, ringR + (6 + 6 * pulse) * this.dpr)
      }
    }
  }

  // ---------- effects ----------

  private onEffect(effect: ArcheryControllerEffect): void {
    switch (effect.type) {
      case 'armed': sfx.armed(); break
      case 'shot': this.shoot(effect.shot, effect.combo); break
      case 'stage': this.time.delayedCall(SHOT_TIMING.flightMs + 600, () => this.moveTarget(effect.stage)); break
      case 'milestone': this.time.delayedCall(SHOT_TIMING.flightMs + 200, () => { this.banner(`连中 ${effect.combo} 箭！`, '#ffe08a'); sfx.milestone() }); break
      default: break
    }
  }

  private shoot(shot: Shot, combo: number): void {
    sfx.release()
    this.snapAt = performance.now()
    this.flying = true
    const c = this.targetCenter()
    const hit = { x: c.x + shot.offset.x * this.targetR, y: c.y + shot.offset.y * this.targetR }
    const missed = shot.ring === null
    // a miss flies past the target into the hay wall behind it
    const land = missed ? { x: hit.x - this.m * this.targetR * 0.2, y: Math.max(hit.y, this.scale.height * 0.46) } : hit
    const g = this.bowGeometry(0)
    const flight = this.add.image(g.nock.x, g.nock.y, 'arrow').setOrigin(0, 0.5).setDepth(62)
    const startLen = Math.abs(g.nock.x - g.grip.x) + g.L * 0.55
    const endLen = this.targetR * 0.75
    const angle = Math.atan2(land.y - g.nock.y, land.x - g.nock.x)
    flight.setRotation(angle).setDisplaySize(startLen, g.L * 0.07)
    const start = { x: g.nock.x + Math.cos(angle) * startLen * 0.2, y: g.nock.y }
    const control = { x: (start.x + land.x) / 2, y: Math.min(start.y, land.y) - this.scale.height * 0.06 }
    this.tweens.addCounter({
      from: 0, to: 1, duration: SHOT_TIMING.flightMs, ease: 'Sine.easeOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0
        const u = 1 - t
        const x = u * u * start.x + 2 * u * t * control.x + t * t * land.x
        const y = u * u * start.y + 2 * u * t * control.y + t * t * land.y
        const dx = 2 * u * (control.x - start.x) + 2 * t * (land.x - control.x)
        const dy = 2 * u * (control.y - start.y) + 2 * t * (land.y - control.y)
        const len = startLen + (endLen - startLen) * t
        // tip leads: place the arrow so its tip is at (x, y)
        const a = Math.atan2(dy, dx)
        flight.setRotation(a + Math.PI).setDisplaySize(len, g.L * 0.07 * (1 - 0.5 * t)).setOrigin(0, 0.5).setPosition(x, y)
      },
      onComplete: () => {
        this.flying = false
        flight.setDepth(missed ? 2 : 6)
        this.stuck.push(flight)
        if (this.stuck.length > 6) this.stuck.shift()?.destroy()
        this.land(shot, land, combo)
      },
    })
  }

  private land(shot: Shot, at: Point, combo: number): void {
    sfx.hit(shot.ring)
    this.straw.explode(shot.ring === null ? 6 : 12, at.x, at.y)
    if (shot.ring === null) {
      this.floatText('差一点', at.x, at.y - this.targetR * 0.5, '#fffaf0', 28)
      return
    }
    const ring = RINGS[shot.ring]
    this.tweens.add({ targets: this.target, x: this.target.x - this.m * 6 * this.dpr, duration: 60, yoyo: true, repeat: 1 })
    this.sparkles.explode(shot.ring === 0 ? 26 : 12, at.x, at.y)
    if (shot.ring === 0) this.cameras.main.shake(110, 0.003)
    this.floatText(`+${shot.points}`, at.x, at.y - this.targetR * 0.45, '#fff6c9', 36)
    this.floatText(ring.label, this.targetCenter().x, this.targetCenter().y - this.targetR * 1.35, shot.ring === 0 ? '#ffe08a' : '#fffaf0', shot.ring === 0 ? 40 : 30, 120)
    if (combo >= 2) this.floatText(`连中 ×${combo}`, at.x, at.y + this.targetR * 0.55, '#ffd36b', 24, 200)
  }

  private moveTarget(stage: number): void {
    this.stageView = stage
    const r = this.scale.height * STAGE_RADIUS[stage]
    this.banner(`靶子远了一点：${STAGES[stage].name}`, '#fff6c9')
    for (const a of this.stuck) a.destroy()
    this.stuck = []
    this.sign.setTexture(`sign-${STAGES[stage].distanceM}`)
    this.tweens.addCounter({
      from: this.targetR, to: r, duration: 700, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        this.targetR = tw.getValue() ?? r
        this.layoutTarget()
      },
    })
  }

  private banner(content: string, color: string): void {
    const W = this.scale.width
    const H = this.scale.height
    const text = this.add.text(W / 2, H * 0.27, content, {
      fontFamily: FONT_FAMILY, fontSize: `${Math.round(42 * this.dpr)}px`, fontStyle: 'bold', color,
      stroke: '#2f6b4f', strokeThickness: Math.round(8 * this.dpr),
    }).setOrigin(0.5).setDepth(100).setScale(0.4).setAlpha(0)
    this.tweens.add({ targets: text, scale: 1, alpha: 1, duration: 360, ease: 'Back.easeOut' })
    this.tweens.add({ targets: text, alpha: 0, y: H * 0.24, delay: 1300, duration: 500, onComplete: () => text.destroy() })
  }

  private floatText(content: string, x: number, y: number, color: string, size: number, delay = 0): void {
    const text = this.add.text(x, y, content, {
      fontFamily: FONT_FAMILY, fontSize: `${Math.round(size * this.dpr)}px`, fontStyle: 'bold', color,
      stroke: '#2f6b4f', strokeThickness: Math.round(6 * this.dpr),
    }).setOrigin(0.5).setDepth(95).setAlpha(0)
    this.tweens.add({ targets: text, alpha: 1, y: y - 20 * this.dpr, duration: 200, delay })
    this.tweens.add({ targets: text, alpha: 0, y: y - 70 * this.dpr, duration: 600, delay: delay + 750, onComplete: () => text.destroy() })
  }
}
