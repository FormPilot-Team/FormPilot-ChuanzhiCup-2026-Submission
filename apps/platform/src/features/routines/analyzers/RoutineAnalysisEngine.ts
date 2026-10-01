import type { FollowAlongMatch } from '../followAlong/matcher'
import { chapterAt, scopeChapters } from '../scope'
import type { RoutineChapter, RoutineProgram, RoutineScope } from '../types'
import type { RoutineAnalysisRecord } from './analysisRecord'
import { TimeWindow } from './timeWindow'
import type { AnalyzerEvaluation, AnalyzerFeedbackItem, AnalyzerPose, AnalyzerSample, MetricResult, RoutineAnalyzer } from './types'

export const ANALYSIS_ENGINE_CONFIG = Object.freeze({
  /**
   * Feature samples kept per chapter: the longest chapter (≈ 126 s) at the 10 Hz comparison rate is ≈ 1260.
   * Repeating a chapter (jumps in the full routine) keeps the newest samples.
   */
  maxSamplesPerChapter: 1500,
  /** Live window capacity (samples, 30 s at 10 Hz); the analyzer's own `liveWindowMs` decides how much of it is used. */
  liveCapacity: 300,
})

export interface RoutineAnalysisLive {
  analyzerId: string
  title: string
  chapterId: string
  score: number | null
  metrics: MetricResult[]
  /** The most relevant sentence for right now (worst metric first), or null while still reading. */
  feedback: AnalyzerFeedbackItem | null
}

interface ChapterSeries<F, E> {
  chapter: RoutineChapter
  samples: Array<AnalyzerSample<F>>
  /** Samples ever added (keeps counting when the oldest are dropped), so the cached evaluation knows it is stale. */
  added: number
  evaluated?: { added: number; evaluation: E | null }
}

/**
 * Runs one routine analyzer next to the follow-along matcher: cuts the feature sequence by chapter (the standard
 * video is the clock), evaluates a short sliding window for the live view and each chapter's whole sequence for
 * the record. It never touches the matcher, recorder, technique evaluator or feedback policy.
 */
export class RoutineAnalysisEngine<F, E extends AnalyzerEvaluation> {
  private readonly series = new Map<string, ChapterSeries<F, E>>()
  private readonly window: TimeWindow<AnalyzerSample<F>>
  private liveChapterId?: string
  /** The last live view with an evaluation, kept while the window holds no complete movement of the same chapter. */
  private lastLive?: RoutineAnalysisLive

  constructor(readonly analyzer: RoutineAnalyzer<F, E>, private readonly program: RoutineProgram, scope: RoutineScope) {
    for (const chapter of scopeChapters(program, scope)) {
      if (analyzer.covers(chapter)) this.series.set(chapter.id, { chapter, samples: [], added: 0 })
    }
    this.window = new TimeWindow(analyzer.liveWindowMs, ANALYSIS_ENGINE_CONFIG.liveCapacity)
  }

  /** One comparison tick: `videoSeconds` of the standard video, `now` in ms, the user's pose and the tick's match. */
  observe(videoSeconds: number, now: number, pose: AnalyzerPose, match?: FollowAlongMatch): void {
    if (!Number.isFinite(videoSeconds) || !Number.isFinite(now)) return
    const chapter = chapterAt(this.program, videoSeconds)
    const series = this.series.get(chapter.id)
    if (!series) return
    const features = this.analyzer.extractFeatures(pose, { chapter, videoSeconds, match })
    const sample: AnalyzerSample<F> = { at: now, videoSeconds, features }
    series.samples.push(sample)
    series.added += 1
    if (series.samples.length > ANALYSIS_ENGINE_CONFIG.maxSamplesPerChapter) series.samples.shift()
    if (this.liveChapterId !== chapter.id) {
      this.window.clear()
      this.liveChapterId = chapter.id
      this.lastLive = undefined
    }
    this.window.push(now, sample)
  }

  /**
   * The live view of the current chapter, from the sliding window only. When the window holds no complete movement
   * yet (e.g. between two 托举), the last evaluated view of the same chapter is kept instead of going blank.
   */
  live(): RoutineAnalysisLive | null {
    const series = this.liveChapterId ? this.series.get(this.liveChapterId) : undefined
    if (!series) return null
    const evaluation = this.analyzer.evaluate(this.window.toArray(), series.chapter)
    if (evaluation?.score === null || evaluation?.score === undefined) {
      if (this.lastLive) return this.lastLive
    }
    const live: RoutineAnalysisLive = {
      analyzerId: this.analyzer.id,
      title: this.analyzer.title,
      chapterId: series.chapter.id,
      score: evaluation?.score ?? null,
      metrics: evaluation?.metrics ?? [],
      feedback: evaluation ? this.analyzer.buildFeedback(evaluation, series.chapter)[0] ?? null : null,
    }
    if (live.score !== null) this.lastLive = live
    return live
  }

  /** Whole-chapter evaluations for the session record; chapters without samples are left out. */
  snapshot(): RoutineAnalysisRecord {
    const chapters: RoutineAnalysisRecord['chapters'] = []
    for (const series of this.series.values()) {
      if (!series.samples.length) continue
      if (series.evaluated?.added !== series.added) {
        series.evaluated = { added: series.added, evaluation: this.analyzer.evaluate(series.samples, series.chapter) }
      }
      chapters.push({ chapterId: series.chapter.id, samples: series.samples.length, evaluation: structuredClone(series.evaluated.evaluation) })
    }
    return { analyzerId: this.analyzer.id, version: this.analyzer.version, chapters }
  }
}
