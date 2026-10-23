// Apple target detection: TARGET_ENTER → TARGET_HOLD (progress …, then completed once) → TARGET_EXIT.
// Rules (from the Phase 0 feasibility analysis; values are lab engineering parameters):
// - only valid frames advance a hold; a lost hand / stale frame ends the attempt (never a success);
// - enter radius < exit radius (hysteresis), so trembling on the edge does not restart the hold;
// - a hand that completed a target, or that was already inside when the target appeared, must leave
//   the exit radius before it can start a new attempt on that target (release / re-arm);
// - one hand owns a target's attempt; the other hand is ignored until the owner leaves.
// - hit-testing uses the palm-centre estimate (MotionFrame.leftHand / rightHand), the same point the
//   hand cursor is drawn at, so "looks touching" and "counts as touching" agree.
// The idea of timed hold + cooldown comes from FormPilot_v3 GestureHoldController, which lacks
// re-arming (Phase 0 audit); this is a new implementation.
import { SIDES, type MotionEvent, type MotionFrame, type MotionTarget, type Point, type Side } from './contracts'

export const TARGET_CONFIG = Object.freeze({
  /** exit radius = radius + this (torso units) */
  exitMargin: 0.08,
  /** frames further apart than this cancel an attempt instead of counting the gap as hold time */
  maxGapMs: 250,
})

type Pending = MotionEvent extends infer E ? (E extends MotionEvent ? Omit<E, 'id' | 'emittedAt'> : never) : never

interface SideState {
  phase: 'outside' | 'holding' | 'completed'
  /** must be seen outside the exit radius before a new attempt */
  armed: boolean
  attemptId: number
  holdStartedAt: number
  lastAt: number
}

interface TargetState {
  target: MotionTarget
  owner?: Side
  sides: Record<Side, SideState>
}

export interface TrackerSnapshot {
  targetId: number
  owner: Side | null
  left: SideState['phase']
  right: SideState['phase']
  progress: number
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export class TargetTracker {
  private targets = new Map<number, TargetState>()
  private attemptCounter = 0
  private progressById = new Map<number, number>()

  /** Replace the active target set. New targets start disarmed for hands that are already inside. */
  setTargets(targets: readonly MotionTarget[], frame: MotionFrame | null): Pending[] {
    const events: Pending[] = []
    const next = new Map<number, TargetState>()
    for (const target of targets) {
      const existing = this.targets.get(target.id)
      if (existing) {
        existing.target = target
        next.set(target.id, existing)
        continue
      }
      const sideState = (side: Side): SideState => {
        const wrist = frame ? handOf(frame, side) : undefined
        const inside = wrist ? distance(wrist, target.center) <= target.radius + TARGET_CONFIG.exitMargin : false
        return { phase: 'outside', armed: !inside, attemptId: 0, holdStartedAt: 0, lastAt: 0 }
      }
      next.set(target.id, { target, sides: { left: sideState('left'), right: sideState('right') } })
    }
    for (const [id, state] of this.targets) {
      if (next.has(id)) continue
      for (const side of SIDES) {
        const s = state.sides[side]
        if (s.phase !== 'outside') {
          events.push({ type: 'TARGET_EXIT', timestamp: frame?.timestamp ?? 0, targetId: id, side, attemptId: s.attemptId, completed: s.phase === 'completed', reason: 'target-removed' })
        }
      }
      this.progressById.delete(id)
    }
    this.targets = next
    return events
  }

  getTargets(): MotionTarget[] {
    return [...this.targets.values()].map((s) => s.target)
  }

  /** Cancel every attempt in progress (pause, tracking loss). Hands must re-enter afterwards. */
  cancelAll(timestamp: number): Pending[] {
    const events: Pending[] = []
    for (const state of this.targets.values()) {
      for (const side of SIDES) {
        const s = state.sides[side]
        if (s.phase === 'holding') {
          events.push({ type: 'TARGET_EXIT', timestamp, targetId: state.target.id, side, attemptId: s.attemptId, completed: false, reason: 'tracking-lost' })
        }
        if (s.phase !== 'outside') this.release(state, side)
      }
      state.owner = undefined
      this.progressById.set(state.target.id, 0)
    }
    return events
  }

  progress(targetId: number): number {
    return this.progressById.get(targetId) ?? 0
  }

  snapshot(): TrackerSnapshot[] {
    return [...this.targets.values()].map((s) => ({
      targetId: s.target.id, owner: s.owner ?? null, left: s.sides.left.phase, right: s.sides.right.phase, progress: this.progress(s.target.id),
    }))
  }

  update(frame: MotionFrame): Pending[] {
    const events: Pending[] = []
    const now = frame.timestamp
    for (const state of this.targets.values()) {
      const { target } = state
      const exitRadius = target.radius + TARGET_CONFIG.exitMargin
      let progress = 0
      for (const side of SIDES) {
        const s = state.sides[side]
        const wrist = handOf(frame, side)
        const base = { timestamp: now, targetId: target.id, side, attemptId: s.attemptId }
        if (!wrist) {
          if (s.phase === 'holding') events.push({ ...base, type: 'TARGET_EXIT', completed: false, reason: 'tracking-lost' })
          // Re-arming needs the hand to be SEEN outside; a lost completed hand stays disarmed.
          if (s.phase !== 'outside' || state.owner === side) this.release(state, side)
          continue
        }
        const d = distance(wrist, target.center)
        if (s.phase === 'outside') {
          if (d > exitRadius) s.armed = true
          const ownedByOther = state.owner !== undefined && state.owner !== side
          if (s.armed && !ownedByOther && d <= target.radius) {
            s.phase = 'holding'
            s.attemptId = ++this.attemptCounter
            s.holdStartedAt = now
            s.lastAt = now
            state.owner = side
            events.push({ type: 'TARGET_ENTER', timestamp: now, targetId: target.id, side, attemptId: s.attemptId })
            events.push({ type: 'TARGET_HOLD', timestamp: now, targetId: target.id, side, attemptId: s.attemptId, progress: 0, completed: false })
          }
          continue
        }
        if (s.phase === 'holding') {
          if (now - s.lastAt > TARGET_CONFIG.maxGapMs) {
            events.push({ ...base, type: 'TARGET_EXIT', completed: false, reason: 'tracking-lost' })
            this.release(state, side)
            continue
          }
          s.lastAt = now
          if (d > exitRadius) {
            events.push({ ...base, type: 'TARGET_EXIT', completed: false, reason: 'moved-out' })
            this.release(state, side)
            s.armed = true
            continue
          }
          const p = Math.min(1, (now - s.holdStartedAt) / target.holdMs)
          progress = Math.max(progress, p)
          if (p >= 1) {
            s.phase = 'completed'
            s.armed = false
            events.push({ ...base, type: 'TARGET_HOLD', progress: 1, completed: true })
          } else {
            events.push({ ...base, type: 'TARGET_HOLD', progress: p, completed: false })
          }
          continue
        }
        // completed: wait for the hand to leave, then re-arm.
        progress = Math.max(progress, 1)
        if (d > exitRadius) {
          events.push({ ...base, type: 'TARGET_EXIT', completed: true, reason: 'moved-out' })
          this.release(state, side)
          s.armed = true
        }
      }
      this.progressById.set(target.id, progress)
    }
    return events
  }

  private release(state: TargetState, side: Side): void {
    const s = state.sides[side]
    if (s.phase === 'completed') s.armed = false
    s.phase = 'outside'
    if (state.owner === side) state.owner = undefined
  }
}

/** Hit point of a hand: the palm-centre estimate (falls back to the wrist for hand-made frames). */
export function handOf(frame: MotionFrame, side: Side): Point | undefined {
  if (!frame.tracking[side]) return undefined
  return side === 'left' ? (frame.leftHand ?? frame.leftWrist) : (frame.rightHand ?? frame.rightWrist)
}
