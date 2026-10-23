// Posture-compensation detection: trunk side lean and shoulder shrug, relative to the player's own
// calibrated neutral posture. Adapted ideas (not code) from FormPilot_v3:
// - torso lean limit 10° (src/features/exercises/lateralRaise/config.ts torsoLeanMax);
// - shrug as the ear–shoulder vertical gap (src/features/routines/analyzers/wuqinxi/features.ts `shrug`).
// Lab additions: per-player baseline, hysteresis + dwell times, and a relaxed shrug limit for an arm
// that is raised overhead (the shoulder girdle naturally rises then). All values are engineering
// parameters for gentle game hints — not clinical thresholds — and still need human validation.
import type { MotionFrame, PostureFlags, Side } from './contracts'
import type { BodyMeasures } from './frameBuilder'

export const POSTURE_CONFIG = Object.freeze({
  leanOnDeg: 10,
  leanOffDeg: 7,
  /** used only when hips are not visible (seated behind a table): shoulder-line tilt change */
  tiltOnDeg: 9,
  tiltOffDeg: 6,
  shrugOnRatio: 0.72,
  shrugOffRatio: 0.82,
  /** when that side's wrist is above the shoulder, allow a larger natural rise */
  shrugOnRatioArmRaised: 0.5,
  shrugOffRatioArmRaised: 0.6,
  onDwellMs: 600,
  offDwellMs: 400,
})

export interface PostureBaseline {
  leanDeg: number | null
  shoulderTiltDeg: number
  earGap: Record<Side, number | null>
}

class DwellFlag {
  active = false
  private candidateSince?: number

  update(wantOn: boolean, wantOff: boolean, now: number, onMs: number, offMs: number): boolean {
    const switching = this.active ? wantOff : wantOn
    if (!switching) {
      this.candidateSince = undefined
      return this.active
    }
    this.candidateSince ??= now
    if (now - this.candidateSince >= (this.active ? offMs : onMs)) {
      this.active = !this.active
      this.candidateSince = undefined
    }
    return this.active
  }

  reset(): void {
    this.active = false
    this.candidateSince = undefined
  }
}

export class PostureMonitor {
  private baseline: PostureBaseline | null = null
  private readonly lean = new DwellFlag()
  private readonly shrug: Record<Side, DwellFlag> = { left: new DwellFlag(), right: new DwellFlag() }

  setBaseline(baseline: PostureBaseline | null): void {
    this.baseline = baseline
    this.reset()
  }

  getBaseline(): PostureBaseline | null {
    return this.baseline
  }

  reset(): void {
    this.lean.reset()
    this.shrug.left.reset()
    this.shrug.right.reset()
  }

  update(frame: MotionFrame, measures: BodyMeasures): PostureFlags {
    const c = POSTURE_CONFIG
    const now = frame.timestamp
    if (!measures.valid) {
      return { torsoLean: this.lean.active, shrug: this.shrug.left.active || this.shrug.right.active, shrugSide: this.shrugSide(), leanDegrees: null, shrugRatio: { left: null, right: null } }
    }
    const b = this.baseline
    let leanDegrees: number | null = null
    let leanOn = false
    let leanOff = true
    if (measures.leanDeg !== null) {
      leanDegrees = measures.leanDeg - (b?.leanDeg ?? 0)
      leanOn = Math.abs(leanDegrees) > c.leanOnDeg
      leanOff = Math.abs(leanDegrees) < c.leanOffDeg
    } else if (b) {
      // No hips: fall back to the change of the shoulder line, which also tilts with a side lean.
      leanDegrees = measures.shoulderTiltDeg - b.shoulderTiltDeg
      leanOn = Math.abs(leanDegrees) > c.tiltOnDeg
      leanOff = Math.abs(leanDegrees) < c.tiltOffDeg
    }
    this.lean.update(leanOn, leanOff, now, c.onDwellMs, c.offDwellMs)

    const shrugRatio = { left: null as number | null, right: null as number | null }
    for (const side of ['left', 'right'] as const) {
      const neutral = b?.earGap[side] ?? null
      const current = measures.earGap[side]
      if (neutral === null || current === null || neutral <= 0.05) {
        this.shrug[side].update(false, true, now, c.onDwellMs, c.offDwellMs)
        continue
      }
      const ratio = current / neutral
      shrugRatio[side] = ratio
      const wrist = side === 'left' ? frame.leftWrist : frame.rightWrist
      const raised = Boolean(wrist && wrist.y < 0)
      const onRatio = raised ? c.shrugOnRatioArmRaised : c.shrugOnRatio
      const offRatio = raised ? c.shrugOffRatioArmRaised : c.shrugOffRatio
      this.shrug[side].update(ratio < onRatio, ratio > offRatio, now, c.onDwellMs, c.offDwellMs)
    }
    return {
      torsoLean: this.lean.active,
      shrug: this.shrug.left.active || this.shrug.right.active,
      shrugSide: this.shrugSide(),
      leanDegrees,
      shrugRatio,
    }
  }

  private shrugSide(): PostureFlags['shrugSide'] {
    const l = this.shrug.left.active
    const r = this.shrug.right.active
    return l && r ? 'both' : l ? 'left' : r ? 'right' : null
  }
}

export function samePosture(a: PostureFlags, b: PostureFlags): boolean {
  return a.torsoLean === b.torsoLean && a.shrug === b.shrug && a.shrugSide === b.shrugSide
}
