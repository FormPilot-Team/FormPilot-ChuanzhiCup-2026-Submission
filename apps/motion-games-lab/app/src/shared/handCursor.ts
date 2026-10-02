// Shared hand cursor for every game (Phaser). One per hand, the same warm-white design for both (the
// Round-1 playtest rejected colour-coded 左/右 hands); three poses:
//   open  — default, just following the hand
//   half  — engaged: inside a target / holding the oar / drawing the string
//   grab  — the moment something is achieved (apple picked, stroke caught, string held)
// plus a faint halo when the hand is near something it can interact with, and a gentle fade when the
// hand is not tracked.
// Pose → render decoupling: a cursor fed from pose samples (`sampleAt` given) is filtered once per pose
// sample and drawn every rendered frame from a PoseFollower2D, so it glides at the display rate instead
// of jumping at the 30 Hz pose rate. Positions the scene already animates (a hand riding a stroke track,
// a hand on the bow) are drawn as given. Games hit-test on the unsmoothed motion data, never on this.
import * as Phaser from 'phaser'
import type { Point, Side } from '../motion/contracts'
import { paintTexture } from './phaserHost'
import { PoseFollower2D } from './smoothing'
import { paintGlow } from './world/painters'
import { paintHand, type HandPose } from './world/hands'
import { HAND_HALO } from './world/palette'

export type CursorPose = HandPose

export interface CursorInput {
  /** screen position (px) of the palm centre, or null when unknown */
  position: Point | null
  /**
   * capture timestamp of the pose sample this position comes from: the cursor then smooths and
   * interpolates it per rendered frame. Omit for positions the scene already animates smoothly.
   */
  sampleAt?: number
  tracked: boolean
  pose: CursorPose
  /** something interactive is close: show the halo */
  near?: boolean
}

const TEXTURE_PX = 160
/** a little translucent, so the scene shows through the hand */
export const CURSOR_OPACITY = 0.94

export function handTextureKey(side: Side, pose: CursorPose): string {
  return `hand-${side}-${pose}`
}

/** Paint the six hand textures (three poses, mirrored per side) once per scene (cheap; ~160 px each). */
export function paintHandTextures(scene: Phaser.Scene, dpr: number): void {
  const size = Math.round(TEXTURE_PX * Math.min(2, Math.max(1, dpr)))
  for (const side of ['left', 'right'] as const) {
    for (const pose of ['open', 'half', 'grab'] as const) {
      paintTexture(scene, handTextureKey(side, pose), size, size, (ctx, w) => paintHand(ctx, w, pose, side))
    }
  }
  if (!scene.textures.exists('cursor-glow')) paintTexture(scene, 'cursor-glow', 128, 128, (ctx, w) => paintGlow(ctx, w, 'rgba(255, 255, 255, 1)'))
}

export class HandCursor {
  private readonly halo: Phaser.GameObjects.Image
  private readonly hand: Phaser.GameObjects.Image
  private readonly follower = new PoseFollower2D()
  private lastSampleAt: number | null = null
  private pose: CursorPose = 'open'
  private alpha = 0
  private nearAmount = 0
  private punch = 1
  private shown: Point | null = null
  private size = 80

  constructor(scene: Phaser.Scene, readonly side: Side, depth: number) {
    this.halo = scene.add.image(0, 0, 'cursor-glow').setTint(HAND_HALO).setDepth(depth).setAlpha(0)
    // origin on the palm centre of the painted hand, so the palm sits exactly on the hit point
    this.hand = scene.add.image(0, 0, handTextureKey(side, 'open')).setOrigin(0.5, 0.61).setDepth(depth + 1).setAlpha(0)
  }

  /** Display size of the hand in px (its height). */
  setSize(px: number): void {
    this.size = px
  }

  /** Current on-screen (smoothed) position, for effects anchored to the hand. */
  position(): Point | null {
    return this.shown
  }

  currentPose(): CursorPose {
    return this.pose
  }

  /** A short pop + soft halo (success moments). */
  celebrate(): void {
    this.punch = 1.2
    this.nearAmount = 1.3
  }

  update(now: number, input: CursorInput, speedScale: number): void {
    const visible = input.tracked && input.position !== null
    this.alpha += ((visible ? 1 : 0) - this.alpha) * (visible ? 0.3 : 0.12)
    if (input.position && input.tracked) {
      if (input.sampleAt === undefined) this.shown = { ...input.position }
      else {
        if (input.sampleAt !== this.lastSampleAt) {
          this.lastSampleAt = input.sampleAt
          this.follower.push(input.position, input.sampleAt, now, speedScale)
        }
        this.shown = this.follower.sample(now)
      }
    } else if (!input.tracked) {
      this.follower.reset()
      this.lastSampleAt = null
    }
    if (input.pose !== this.pose) {
      this.pose = input.pose
      this.hand.setTexture(handTextureKey(this.side, input.pose))
      this.punch = input.pose === 'grab' ? 1.12 : input.pose === 'half' ? 0.95 : 1.04
    }
    this.punch += (1 - this.punch) * 0.18
    this.nearAmount += ((input.near ? 1 : 0) - this.nearAmount) * 0.15
    if (!this.shown || this.alpha < 0.02) {
      this.hand.setAlpha(0)
      this.halo.setAlpha(0)
      return
    }
    const { x, y } = this.shown
    const size = this.size * this.punch
    this.hand.setPosition(x, y).setDisplaySize(size, size).setAlpha(this.alpha * CURSOR_OPACITY)
    const haloSize = this.size * (1.35 + 0.25 * Math.min(1.3, this.nearAmount))
    this.halo.setPosition(x, y).setDisplaySize(haloSize, haloSize).setAlpha(this.alpha * Math.min(0.42, 0.06 + 0.3 * this.nearAmount))
  }

  setDepth(depth: number): void {
    this.halo.setDepth(depth)
    this.hand.setDepth(depth + 1)
  }

  destroy(): void {
    this.halo.destroy()
    this.hand.destroy()
  }
}
