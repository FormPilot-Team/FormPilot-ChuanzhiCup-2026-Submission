import type { CourseDefinition, CourseStep } from './CourseDefinition'

/** What the controller needs from a course: its timings and its steps. Routines use it with their own step type. */
export type CourseTimeline<TStep = CourseStep> = Pick<CourseDefinition, 'countdownSeconds' | 'transitionMs'> & { steps: ReadonlyArray<TStep> }

export type CourseState = 'PREPARING' | 'COUNTDOWN' | 'ACTIVE' | 'PAUSED' | 'TRANSITION' | 'COURSE_COMPLETE' | 'COURSE_INCOMPLETE'
export interface CourseSnapshot { state: CourseState; stepIndex: number; countdown: number; elapsedMs: number; transitionRemainingMs: number; previousState?: CourseState }

export class CourseController<TStep = CourseStep> {
  private snapshot: CourseSnapshot = { state: 'PREPARING', stepIndex: 0, countdown: 3, elapsedMs: 0, transitionRemainingMs: 0 }
  private stateStartedAt?: number; private activeStartedAt?: number; private pausedAt?: number
  constructor(private readonly definition: CourseTimeline<TStep>) { this.snapshot.countdown = definition.countdownSeconds }
  getSnapshot(): CourseSnapshot { return { ...this.snapshot } }
  getStep(): TStep { return this.definition.steps[this.snapshot.stepIndex] }
  update(now: number, input: { ready: boolean; progress: number; target: number }): CourseSnapshot {
    if (this.snapshot.state === 'PAUSED' || this.snapshot.state === 'COURSE_COMPLETE' || this.snapshot.state === 'COURSE_INCOMPLETE') return this.getSnapshot()
    if (this.snapshot.state === 'PREPARING' && input.ready) { this.snapshot.state = 'COUNTDOWN'; this.stateStartedAt = now }
    if (this.snapshot.state === 'COUNTDOWN') {
      if (!input.ready) { this.snapshot.state = 'PREPARING'; this.stateStartedAt = undefined; this.snapshot.countdown = this.definition.countdownSeconds }
      else {
        const elapsed = now - (this.stateStartedAt ?? now); this.snapshot.countdown = Math.max(0, this.definition.countdownSeconds - Math.floor(elapsed / 1000))
        if (elapsed >= this.definition.countdownSeconds * 1000) { this.snapshot.state = 'ACTIVE'; this.activeStartedAt = now; this.stateStartedAt = now; this.snapshot.countdown = 0 }
      }
    } else if (this.snapshot.state === 'ACTIVE') {
      this.snapshot.elapsedMs = now - (this.activeStartedAt ?? now)
      if (input.progress >= input.target) { this.snapshot.state = 'TRANSITION'; this.stateStartedAt = now; this.snapshot.transitionRemainingMs = this.definition.transitionMs }
    } else if (this.snapshot.state === 'TRANSITION') {
      const elapsed = now - (this.stateStartedAt ?? now); this.snapshot.transitionRemainingMs = Math.max(0, this.definition.transitionMs - elapsed)
      if (elapsed >= this.definition.transitionMs) {
        if (this.snapshot.stepIndex >= this.definition.steps.length - 1) this.snapshot.state = 'COURSE_COMPLETE'
        else { this.snapshot.stepIndex += 1; this.snapshot.state = 'PREPARING'; this.snapshot.countdown = this.definition.countdownSeconds; this.snapshot.elapsedMs = 0; this.stateStartedAt = undefined; this.activeStartedAt = undefined }
      }
    }
    return this.getSnapshot()
  }
  pause(now: number): CourseSnapshot { if (!['COURSE_COMPLETE','COURSE_INCOMPLETE','PAUSED'].includes(this.snapshot.state)) { this.snapshot.previousState = this.snapshot.state; this.snapshot.state = 'PAUSED'; this.pausedAt = now } return this.getSnapshot() }
  resume(now: number): CourseSnapshot { if (this.snapshot.state === 'PAUSED') { const delta = now - (this.pausedAt ?? now); if (this.stateStartedAt !== undefined) this.stateStartedAt += delta; if (this.activeStartedAt !== undefined) this.activeStartedAt += delta; this.snapshot.state = this.snapshot.previousState ?? 'PREPARING'; this.snapshot.previousState = undefined; this.pausedAt = undefined } return this.getSnapshot() }
  manualEnd(): CourseSnapshot { this.snapshot.state = 'COURSE_INCOMPLETE'; return this.getSnapshot() }
}
