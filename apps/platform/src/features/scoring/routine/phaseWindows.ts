import type { ReferenceTrack } from '../../routines/followAlong/referenceTrack'
import { computePoseMetric, type PoseMetricId } from './poseMetrics'

/** One bound on a metric of the standard video's pose. */
export interface WindowCondition {
  metric: PoseMetricId
  min?: number
  max?: number
}

/**
 * A movement phase (e.g. 两手托天的托举顶点), found in the standard video's own pose track: every stretch of the
 * chapter where all conditions hold for at least `minSeconds`. The video is the clock, so these windows tell the
 * evaluator when the user is supposed to be in that phase.
 */
export interface PhaseWindowSpec {
  /** Phase name shown in evidence, e.g. 托举顶点. */
  label: string
  /** All must hold; an empty list means "whenever the standard video's pose is reliable". */
  when: ReadonlyArray<WindowCondition>
  minSeconds: number
  /** Long holds are split into equal parts no longer than this, so each part is one observation. */
  maxSeconds?: number
}

export interface PhaseWindow {
  start: number
  end: number
}

export const PHASE_WINDOW_CONFIG = Object.freeze({
  minReferenceConfidence: 0.5,
  /** Short dropouts (a frame or two without a match) do not split a phase. */
  maxGapSeconds: 0.4,
})

function holds(conditions: ReadonlyArray<WindowCondition>, frame: ReferenceTrack['frames'][number], aspect: number): boolean {
  if (frame.confidence < PHASE_WINDOW_CONFIG.minReferenceConfidence || !frame.landmarks.length) return false
  for (const condition of conditions) {
    const value = computePoseMetric(condition.metric, { landmarks: frame.landmarks, aspect })
    if (value === null) return false
    if (condition.min !== undefined && value < condition.min) return false
    if (condition.max !== undefined && value > condition.max) return false
  }
  return true
}

export function detectPhaseWindows(track: ReferenceTrack, fromSeconds: number, toSeconds: number, spec: PhaseWindowSpec): PhaseWindow[] {
  const aspect = track.width / track.height
  const windows: PhaseWindow[] = []
  let current: PhaseWindow | undefined
  let lastTrue = -Infinity
  const close = () => {
    if (current && current.end - current.start >= spec.minSeconds) windows.push(current)
    current = undefined
  }
  for (const frame of track.frames) {
    if (frame.t < fromSeconds) continue
    if (frame.t >= toSeconds) break
    if (!holds(spec.when, frame, aspect)) continue
    if (current && frame.t - lastTrue <= PHASE_WINDOW_CONFIG.maxGapSeconds) {
      current.end = frame.t
    } else {
      close()
      current = { start: frame.t, end: frame.t }
    }
    lastTrue = frame.t
  }
  close()
  return spec.maxSeconds ? windows.flatMap((window) => split(window, spec.maxSeconds as number)) : windows
}

function split(window: PhaseWindow, maxSeconds: number): PhaseWindow[] {
  const length = window.end - window.start
  const parts = Math.max(1, Math.ceil(length / maxSeconds))
  const step = length / parts
  return Array.from({ length: parts }, (_, index) => ({ start: window.start + index * step, end: window.start + (index + 1) * step }))
}
