import type { FollowAlongMatch, PosePointLike } from '../followAlong/matcher'
import type { RoutineChapter, RoutineId } from '../types'

/**
 * Routine analyzers: one per routine, each measuring what that routine is about (八段锦到位度, 太极拳连续性,
 * 五禽戏五戏特征, 易筋经稳定性) on top of the shared follow-along engine. An analyzer only adds evidence; the
 * follow-along similarity, Scoring v2 technique checks, feedback policy and voice prompts are not changed by it.
 *
 * The contract keeps the analysis testable without a camera or React:
 * - `extractFeatures` turns one pose into a small feature record (or null when the pose is not usable);
 * - `evaluate` is a pure function of a feature sequence and the chapter, used both live (a short sliding window)
 *   and for the record (the chapter's whole sequence);
 * - `buildFeedback` / `buildReportMetrics` only format evaluations, in Chinese, with the measured numbers.
 */

/** One user pose as the follow-along tick sees it (same shape as the matcher's input). */
export interface AnalyzerPose {
  landmarks: ReadonlyArray<PosePointLike>
  confidence: number
  /** Camera image width / height. */
  aspect: number
}

export interface AnalyzerContext {
  chapter: RoutineChapter
  videoSeconds: number
  /** The follow-along comparison of the same tick (absent for the standard video's own frames). */
  match?: FollowAlongMatch
}

export interface AnalyzerSample<F> {
  /** Wall-clock time of the frame, ms: speeds, jitter and hold durations use it. */
  at: number
  /** Standard video time, s: chapter membership and the demonstrator's reference use it. */
  videoSeconds: number
  features: F | null
}

/** One scored aspect of a chapter. `score` is null when it could not be measured or is recorded only. */
export interface MetricResult {
  id: string
  label: string
  value: number | null
  unit: string
  /** The measured value as shown to the user, e.g. “示范幅度的 82%”. */
  display: string
  /** What full marks require, e.g. “≥ 示范的 90%”. */
  target: string
  score: number | null
  /** Weight inside the chapter score after redistributing metrics that are not scored. */
  weight: number
  /** False when the metric is shown for information only (e.g. 攒拳幅度, 二维近似不可靠的重心方向). */
  evaluated: boolean
  note?: string
}

/** What every analyzer evaluation carries; analyzers add their own summary fields. */
export interface AnalyzerEvaluation {
  /** Weighted mean of the evaluated metrics, 0–100; null when nothing could be measured. */
  score: number | null
  metrics: MetricResult[]
  /** Samples with usable features in the evaluated sequence. */
  usableSamples: number
}

export type AnalyzerFeedbackTone = 'info' | 'success' | 'warning'

export interface AnalyzerFeedbackItem {
  metricId: string
  tone: AnalyzerFeedbackTone
  message: string
}

export interface AnalyzerChapterReport {
  chapterId: string
  score: number | null
  metrics: MetricResult[]
  /** Sentences quoting the measured values, worst first. */
  feedback: AnalyzerFeedbackItem[]
}

export interface AnalyzerReportMetrics {
  analyzerId: RoutineId
  version: string
  /** e.g. 八段锦到位度. */
  title: string
  /** Mean of the scored chapters, 0–100; null when no chapter could be scored. */
  score: number | null
  chapters: AnalyzerChapterReport[]
  /** How the measurement works and what it cannot see (二维近似, 代理指标, 暂定阈值). */
  notes: string[]
  /** Analyzer-specific summaries (e.g. 五禽戏 per animal); plain JSON values only. */
  extras: Record<string, unknown>
}

export interface RoutineAnalyzer<F, E extends AnalyzerEvaluation = AnalyzerEvaluation> {
  readonly id: RoutineId
  readonly version: string
  readonly title: string
  /** Sliding window of the live view, ms. */
  readonly liveWindowMs: number
  /** Chapters this analyzer evaluates (others are skipped, e.g. 五禽戏起势/收势). */
  covers(chapter: RoutineChapter): boolean
  extractFeatures(pose: AnalyzerPose, context: AnalyzerContext): F | null
  evaluate(samples: ReadonlyArray<AnalyzerSample<F>>, chapter: RoutineChapter): E | null
  buildFeedback(evaluation: E, chapter: RoutineChapter): AnalyzerFeedbackItem[]
  buildReportMetrics(chapters: ReadonlyArray<{ chapter: RoutineChapter; evaluation: E | null }>): AnalyzerReportMetrics
}
