// Comfortable reach area → apple positions. Each side's area is a fan around the shoulder, from
// "arm hanging" up to the highest comfortable elevation the player showed during calibration.
// The area grows slowly when the player reaches further during play, never the other way round.
import type { CalibrationProfile, MotionFrame, Point, ReachProfile, Side } from '../../motion/contracts'

export type Zone = 'side' | 'high' | 'low'
export interface ZoneSlot {
  zone: Zone
  side: Side
}

export const ZONE_LABEL: Record<Zone, string> = { side: '侧面', high: '中高位', low: '中低位' }

export const REACH_CONFIG = Object.freeze({
  /**
   * Elevation (deg from "arm hanging") at the easiest → hardest setting, the share of the personal
   * maximum that may be used, the sideways bias (1 = straight out to the side, negative = toward the
   * body midline) and the distance as a share of arm length.
   * side = 左侧/右侧, high = 中高位 (above, toward the centre), low = 中低位 (in front of the body).
   */
  side: { from: 50, to: 100, cap: 0.9, bias: 1, radius: 0.92 },
  high: { from: 100, to: 175, cap: 0.97, bias: -0.35, radius: 0.9 },
  low: { from: 40, to: 62, cap: 0.95, bias: -0.6, radius: 0.78 },
  /** how far the observed elevation must exceed the profile before it grows, and how fast */
  growMarginDeg: 4,
  growRate: 0.3,
  growSustainMs: 400,
  maxElevationDeg: 175,
  maxArmLength: 1.5,
})

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function elevationOf(shoulder: Point, wrist: Point): number {
  return (Math.atan2(Math.abs(wrist.x - shoulder.x), wrist.y - shoulder.y) * 180) / Math.PI
}

export class ReachModel {
  readonly sides: Record<Side, ReachProfile>
  private growCandidate: Record<Side, { since: number; value: number } | undefined> = { left: undefined, right: undefined }

  constructor(profile: CalibrationProfile) {
    this.sides = { left: { ...profile.reach.left }, right: { ...profile.reach.right } }
  }

  /** Elevation (deg) used for a zone at difficulty fraction f (0..1), capped by the personal reach. */
  elevationFor(zone: Zone, side: Side, f: number): number {
    const c = REACH_CONFIG[zone]
    const personal = this.sides[side].maxElevationDeg
    return Math.min(lerp(c.from, c.to, Math.max(0, Math.min(1, f))), personal * c.cap)
  }

  point(slot: ZoneSlot, f: number, jitter: () => number = () => 0.5): Point {
    const { zone, side } = slot
    const c = REACH_CONFIG[zone]
    const reach = this.sides[side]
    const cap = reach.maxElevationDeg * c.cap
    const r = reach.armLength * c.radius * (0.94 + jitter() * 0.06)
    const outward = side === 'left' ? -1 : 1
    const at = (deg: number): Point => {
      const phi = (deg * Math.PI) / 180
      return { x: reach.shoulder.x + outward * Math.sin(phi) * c.bias * r, y: reach.shoulder.y + Math.cos(phi) * r }
    }
    let deg = this.elevationFor(zone, side, f) + (jitter() - 0.5) * 10
    // The sideways bias changes the real on-screen elevation, so clamp on the actual point: every
    // apple must lie inside the fan the player showed as comfortable.
    for (let i = 0; i < 40 && elevationOf(reach.shoulder, at(deg)) > cap; i += 1) deg -= 3
    return at(deg)
  }

  /** Grow the comfortable area when the player clearly and steadily reaches further. */
  observe(frame: MotionFrame): void {
    const c = REACH_CONFIG
    for (const side of ['left', 'right'] as const) {
      const shoulder = side === 'left' ? frame.leftShoulder : frame.rightShoulder
      const wrist = side === 'left' ? frame.leftWrist : frame.rightWrist
      const reach = this.sides[side]
      if (!shoulder || !wrist || !frame.tracking[side]) {
        this.growCandidate[side] = undefined
        continue
      }
      const elevation = elevationOf(shoulder, wrist)
      const length = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y)
      if (length > reach.armLength) reach.armLength = Math.min(c.maxArmLength, reach.armLength + 0.1 * (length - reach.armLength))
      if (elevation <= reach.maxElevationDeg + c.growMarginDeg) {
        this.growCandidate[side] = undefined
        continue
      }
      const candidate = this.growCandidate[side]
      if (!candidate) {
        this.growCandidate[side] = { since: frame.timestamp, value: elevation }
        continue
      }
      candidate.value = Math.min(candidate.value, elevation)
      if (frame.timestamp - candidate.since >= c.growSustainMs) {
        reach.maxElevationDeg = Math.min(c.maxElevationDeg, reach.maxElevationDeg + c.growRate * (candidate.value - reach.maxElevationDeg))
        this.growCandidate[side] = undefined
      }
    }
  }

  /** Bounding box (body space) that must stay on screen: both reach fans plus resting hands. */
  extents(): { left: number; right: number; top: number; bottom: number } {
    const l = this.sides.left
    const r = this.sides.right
    return {
      left: l.shoulder.x - l.armLength * 1.02,
      right: r.shoulder.x + r.armLength * 1.02,
      top: Math.min(l.shoulder.y, r.shoulder.y) - Math.max(l.armLength, r.armLength) * 1.02,
      bottom: Math.max(l.shoulder.y, r.shoulder.y) + Math.max(l.armLength, r.armLength) * 1.0,
    }
  }
}
