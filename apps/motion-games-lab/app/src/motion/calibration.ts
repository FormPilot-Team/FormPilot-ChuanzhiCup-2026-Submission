// Initial calibration: neutral posture (baseline for lean/shrug hints) and each side's comfortable
// reach. The reach is what the player chose to show as comfortable — never a clinical ROM value.
import type { CalibrationProfile, CalibrationStatus, MotionFrame, Point, ReachProfile, Side } from './contracts'
import type { BodyMeasures } from './frameBuilder'
import type { PostureBaseline } from './posture'

export const CALIBRATION_CONFIG = Object.freeze({
  neutralMs: 1500,
  /** wrist must be this far below the shoulder line (torso units) during the neutral step */
  neutralWristBelow: 0.2,
  /** a reach attempt counts as started above this elevation */
  reachStartDeg: 25,
  /** minimum elevation for an early (steady) finish */
  reachMinDeg: 40,
  /** steady = within this many degrees of the best elevation… */
  reachSteadyDeg: 10,
  /** …for this long */
  reachHoldMs: 700,
  /** give up waiting and keep the best elevation seen */
  reachTimeoutMs: 9000,
  minElevationDeg: 40,
  maxElevationDeg: 175,
})

export const DEFAULT_REACH: Record<Side, ReachProfile> = Object.freeze({
  left: { shoulder: { x: -0.375, y: 0 }, armLength: 1.05, maxElevationDeg: 130 },
  right: { shoulder: { x: 0.375, y: 0 }, armLength: 1.05, maxElevationDeg: 130 },
})

/** Angle between "straight down" and shoulder→wrist (0 = hanging, 90 = horizontal, 180 = overhead). */
export function elevationDeg(shoulder: Point, wrist: Point): number {
  return (Math.atan2(Math.abs(wrist.x - shoulder.x), wrist.y - shoulder.y) * 180) / Math.PI
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
const meanOrNull = (values: (number | null)[]) => {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v))
  return finite.length ? mean(finite) : null
}

interface NeutralSample {
  at: number
  leanDeg: number | null
  tiltDeg: number
  earGap: Record<Side, number | null>
  shoulder: Record<Side, Point>
  armLength: Record<Side, number>
}

export class Calibrator {
  private step: CalibrationStatus['step'] = 'idle'
  private stepStartedAt = 0
  private progress = 0
  private skipReach = false
  private neutral: NeutralSample[] = []
  private lastValidAt?: number
  private reach: Partial<Record<Side, { best: number; length: number; steadySince?: number; started: boolean }>> = {}
  private live: number | null = null
  private result: CalibrationProfile | null = null
  private baseline: PostureBaseline | null = null

  start(options: { skipReach?: boolean } = {}): void {
    this.step = 'neutral'
    this.stepStartedAt = Number.NaN
    this.progress = 0
    this.skipReach = Boolean(options.skipReach)
    this.neutral = []
    this.lastValidAt = undefined
    this.reach = {}
    this.live = null
    this.result = null
    this.baseline = null
  }

  status(): CalibrationStatus {
    return { step: this.step, progress: this.progress, liveElevationDeg: this.live, profile: this.result }
  }

  postureBaseline(): PostureBaseline | null {
    return this.baseline
  }

  /** Returns true when calibration just finished on this frame. */
  update(frame: MotionFrame, measures: BodyMeasures): boolean {
    if (this.step === 'idle' || this.step === 'done') return false
    const now = frame.timestamp
    if (Number.isNaN(this.stepStartedAt)) this.stepStartedAt = now
    if (this.step === 'neutral') return this.updateNeutral(frame, measures, now)
    return this.updateReach(this.step === 'reach-left' ? 'left' : 'right', frame, now)
  }

  private updateNeutral(frame: MotionFrame, measures: BodyMeasures, now: number): boolean {
    const c = CALIBRATION_CONFIG
    const ok = frame.tracking.body && frame.leftWrist && frame.rightWrist && frame.leftShoulder && frame.rightShoulder
      && frame.leftWrist.y > c.neutralWristBelow && frame.rightWrist.y > c.neutralWristBelow
    if (!ok) {
      // Short dropouts are tolerated; a longer one restarts the neutral step.
      if (this.lastValidAt === undefined || now - this.lastValidAt > 300) {
        this.neutral = []
        this.progress = 0
      }
      return false
    }
    this.lastValidAt = now
    this.neutral.push({
      at: now,
      leanDeg: measures.leanDeg,
      tiltDeg: measures.shoulderTiltDeg,
      earGap: { ...measures.earGap },
      shoulder: { left: frame.leftShoulder!, right: frame.rightShoulder! },
      armLength: {
        left: Math.hypot(frame.leftWrist!.x - frame.leftShoulder!.x, frame.leftWrist!.y - frame.leftShoulder!.y),
        right: Math.hypot(frame.rightWrist!.x - frame.rightShoulder!.x, frame.rightWrist!.y - frame.rightShoulder!.y),
      },
    })
    const span = now - this.neutral[0].at
    this.progress = Math.min(1, span / c.neutralMs)
    if (span < c.neutralMs) return false
    const n = this.neutral
    this.baseline = {
      leanDeg: meanOrNull(n.map((s) => s.leanDeg)),
      shoulderTiltDeg: mean(n.map((s) => s.tiltDeg)),
      earGap: { left: meanOrNull(n.map((s) => s.earGap.left)), right: meanOrNull(n.map((s) => s.earGap.right)) },
    }
    if (this.skipReach) return this.finish(true)
    this.advance('reach-left', now)
    return false
  }

  private updateReach(side: Side, frame: MotionFrame, now: number): boolean {
    const c = CALIBRATION_CONFIG
    const shoulder = side === 'left' ? frame.leftShoulder : frame.rightShoulder
    const wrist = side === 'left' ? frame.leftWrist : frame.rightWrist
    const state = (this.reach[side] ??= { best: 0, length: 0, started: false })
    const timedOut = now - this.stepStartedAt >= c.reachTimeoutMs
    if (shoulder && wrist) {
      const elevation = elevationDeg(shoulder, wrist)
      this.live = elevation
      if (elevation >= c.reachStartDeg) state.started = true
      if (state.started) {
        if (elevation > state.best) state.best = elevation
        state.length = Math.max(state.length, Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y))
        const steady = state.best >= c.reachMinDeg && elevation >= state.best - c.reachSteadyDeg
        if (steady) state.steadySince ??= now
        else state.steadySince = undefined
      }
    } else {
      this.live = null
      state.steadySince = undefined
    }
    const held = state.steadySince !== undefined ? (now - state.steadySince) / c.reachHoldMs : 0
    this.progress = Math.min(1, held)
    if (held < 1 && !timedOut) return false
    if (side === 'left') {
      this.advance('reach-right', now)
      return false
    }
    return this.finish(false)
  }

  private advance(step: CalibrationStatus['step'], now: number): void {
    this.step = step
    this.stepStartedAt = now
    this.progress = 0
    this.live = null
  }

  private finish(usedDefaults: boolean): boolean {
    const c = CALIBRATION_CONFIG
    const n = this.neutral
    const reachFor = (side: Side): ReachProfile => {
      const fallback = DEFAULT_REACH[side]
      const shoulder = n.length ? { x: mean(n.map((s) => s.shoulder[side].x)), y: mean(n.map((s) => s.shoulder[side].y)) } : fallback.shoulder
      const hanging = n.length ? mean(n.map((s) => s.armLength[side])) : 0
      const measured = this.reach[side]
      const armLength = Math.max(0.7, Math.min(1.5, Math.max(hanging, measured?.length ?? 0) || fallback.armLength))
      const best = usedDefaults || !measured?.started ? fallback.maxElevationDeg : measured.best
      return { shoulder, armLength, maxElevationDeg: Math.max(c.minElevationDeg, Math.min(c.maxElevationDeg, best)) }
    }
    this.result = {
      id: `cal-${Date.now().toString(36)}`,
      createdAt: Date.now(),
      usedDefaults,
      reach: { left: reachFor('left'), right: reachFor('right') },
    }
    this.step = 'done'
    this.progress = 1
    return true
  }
}

export function defaultCalibration(): CalibrationProfile {
  return { id: 'default', createdAt: Date.now(), usedDefaults: true, reach: { left: { ...DEFAULT_REACH.left }, right: { ...DEFAULT_REACH.right } } }
}
