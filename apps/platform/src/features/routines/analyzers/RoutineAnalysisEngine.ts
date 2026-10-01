import type { FollowAlongMatch } from '../followAlong/matcher'
import { chapterAt, scopeChapters } from '../scope'
import type { RoutineChapter, RoutineProgram, RoutineScope } from '../types'
import type { RoutineAnalysisRecord } from './analysisRecord'
import { TimeWindow } from './timeWindow'
import type { AnalyzerEvaluation, AnalyzerFeedbackItem, AnalyzerPose, AnalyzerSample, MetricResult, RoutineAnalyzer } from './types'

export const ANALYSIS_ENGINE_CONFIG = Object.freeze({
  /** 每章保留的样本数：最长一章约 126 s × 10 Hz ≈ 1260；重复跟练同一章时保留最新的 */
  maxSamplesPerChapter: 1500,
  /** 实时窗口容量（10 Hz 下 30 s），实际长度由各分析器的 liveWindowMs 决定 */
  liveCapacity: 300,
})

export interface RoutineAnalysisLive {
  analyzerId: string
  title: string
  chapterId: string
  score: number | null
  metrics: MetricResult[]
  /** 当前最该提示的一句（最差项在前）；读取中为 null */
  feedback: AnalyzerFeedbackItem | null
}

interface ChapterSeries<F, E> {
  chapter: RoutineChapter
  samples: Array<AnalyzerSample<F>>
  /** 累计加入的样本数（丢弃旧样本也继续计数），用来判断缓存的评价是否过期 */
  added: number
  evaluated?: { added: number; evaluation: E | null }
}

/** 在跟练比对旁运行一个分析器：按视频时间切分章节，实时评价短窗口，存档评价整章；不触碰比对、记录与反馈 */
export class RoutineAnalysisEngine<F, E extends AnalyzerEvaluation> {
  private readonly series = new Map<string, ChapterSeries<F, E>>()
  private readonly window: TimeWindow<AnalyzerSample<F>>
  private liveChapterId?: string
  /** 窗口内还没有完整动作时（如两次托举之间）沿用的上一次实时结果 */
  private lastLive?: RoutineAnalysisLive

  constructor(readonly analyzer: RoutineAnalyzer<F, E>, private readonly program: RoutineProgram, scope: RoutineScope) {
    for (const chapter of scopeChapters(program, scope)) {
      if (analyzer.covers(chapter)) this.series.set(chapter.id, { chapter, samples: [], added: 0 })
    }
    this.window = new TimeWindow(analyzer.liveWindowMs, ANALYSIS_ENGINE_CONFIG.liveCapacity)
  }

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

  /** 存档用的整章评价；没有样本的章节不写 */
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
