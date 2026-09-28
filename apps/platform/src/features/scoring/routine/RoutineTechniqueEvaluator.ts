import type { ReferenceTrack } from '../../routines/followAlong/referenceTrack'
import { scopeChapters } from '../../routines/scope'
import type { RoutineProgram, RoutineScope } from '../../routines/types'
import { routineMeasuredCriteria } from '../criteria'
import { aggregateSamples, targetScore } from '../targetScore'
import { SCORING_VERSION, type EvaluationCriterion } from '../types'
import { detectPhaseWindows, type PhaseWindow } from './phaseWindows'
import { computePoseMetric, type MetricPoint } from './poseMetrics'
import type { RoutineTechniqueRecord, TechniqueWindowObservation } from './techniqueRecord'

export const TECHNIQUE_CONFIG = Object.freeze({
  /** The first moments of a phase are still the transition into it. */
  leadInSeconds: 0.3,
  /**
   * Following lags the video a little (the matcher tolerates 1 s behind), so a phase stays open this long — but never
   * past its chapter's end, where the next movement already starts.
   */
  lagSeconds: 1,
  /** ≈ 0.5 s of comparisons at the 10 Hz evaluation rate; fewer samples leave the window unobserved. */
  minSamples: 5,
  minUserConfidence: 0.5,
})

export interface TechniqueUserPose {
  landmarks: ReadonlyArray<MetricPoint>
  confidence: number
  /** Camera image width / height. */
  aspect: number
}

interface WindowState extends PhaseWindow {
  /** Last video second that still counts for this window. */
  closesAt: number
  values: number[]
}

interface Entry {
  criterion: EvaluationCriterion
  chapterId: string
  windows: WindowState[]
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Follow-along technique evaluation (Scoring v2). The standard video is the clock: for every measured criterion of
 * the chapters in scope, its phase windows are found once in the video's own pose track; while the user follows,
 * each comparison tick adds the user's metric to whichever windows are open at the current video time. A window's
 * samples become one observation (e.g. “第 3 次托举顶点，双肘 137°”) scored against the criterion target.
 * Kept apart from the similarity matcher on purpose: similarity says how close the pose is to the video,
 * technique says whether specific requirements were met.
 */
export class RoutineTechniqueEvaluator {
  private readonly entries: Entry[] = []

  constructor(program: RoutineProgram, scope: RoutineScope, track: ReferenceTrack) {
    const criteria = routineMeasuredCriteria(program.id)
    for (const chapter of scopeChapters(program, scope)) {
      for (const criterion of criteria) {
        if (criterion.exercise !== chapter.id && criterion.exercise !== '*') continue
        if (criterion.measurement.kind !== 'pose-window') continue
        const windows = detectPhaseWindows(track, chapter.startSeconds, chapter.endSeconds, criterion.measurement.window)
        if (!windows.length) continue
        const windowStates = windows.map((window) => ({ ...window, closesAt: Math.min(window.end + TECHNIQUE_CONFIG.lagSeconds, chapter.endSeconds), values: [] }))
        this.entries.push({ criterion, chapterId: chapter.id, windows: windowStates })
      }
    }
  }

  /** Number of (criterion, chapter) pairs with at least one phase window. */
  get size(): number {
    return this.entries.length
  }

  observe(videoSeconds: number, pose: TechniqueUserPose): void {
    if (!Number.isFinite(videoSeconds) || !(pose.confidence >= TECHNIQUE_CONFIG.minUserConfidence) || !(pose.aspect > 0)) return
    for (const entry of this.entries) {
      const measurement = entry.criterion.measurement
      if (measurement.kind !== 'pose-window') continue
      let value: number | null | undefined
      for (const window of entry.windows) {
        if (videoSeconds < window.start + TECHNIQUE_CONFIG.leadInSeconds || videoSeconds > window.closesAt) continue
        if (value === undefined) value = computePoseMetric(measurement.metric, { landmarks: pose.landmarks, aspect: pose.aspect })
        if (value !== null) window.values.push(value)
      }
    }
  }

  snapshot(): RoutineTechniqueRecord {
    return {
      version: SCORING_VERSION,
      criteria: this.entries.map((entry) => ({
        criterionId: entry.criterion.id,
        chapterId: entry.chapterId,
        windows: entry.windows.map((window): TechniqueWindowObservation => {
          const measurement = entry.criterion.measurement
          const enough = window.values.length >= TECHNIQUE_CONFIG.minSamples
          const value = enough && measurement.kind === 'pose-window' ? aggregateSamples(window.values, measurement.aggregation) : null
          const score = value !== null && entry.criterion.target ? Math.round(targetScore(value, entry.criterion.target)) : null
          return { start: round(window.start, 1), end: round(window.end, 1), samples: window.values.length, value: value === null ? null : round(value, 3), score }
        }),
      })),
    }
  }
}
