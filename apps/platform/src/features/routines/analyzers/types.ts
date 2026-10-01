import type { FollowAlongMatch, PosePointLike } from '../followAlong/matcher'
import type { RoutineChapter, RoutineId } from '../types'

// 功法专项分析器的公共接口。分析基于姿态关键点的二维近似，只在跟练引擎之外追加证据，不改变相似度、动作规范、反馈与语音。
// evaluate 是纯函数：实时用短窗口，存档用整章序列

/** 与跟练比对输入同形的一帧用户姿态 */
export interface AnalyzerPose {
  landmarks: ReadonlyArray<PosePointLike>
  confidence: number
  /** 摄像头画面宽 / 高 */
  aspect: number
}

export interface AnalyzerContext {
  chapter: RoutineChapter
  videoSeconds: number
  /** 同一次比对的跟练结果；示范者自身的帧没有 */
  match?: FollowAlongMatch
}

export interface AnalyzerSample<F> {
  /** 帧的墙钟时间，ms：速度、抖动、保持时长用它 */
  at: number
  /** 标准视频时间，s：章节归属与示范参考用它 */
  videoSeconds: number
  features: F | null
}

/** 章节的一个评分项；无法测量或只记录时 score 为 null */
export interface MetricResult {
  id: string
  label: string
  value: number | null
  unit: string
  /** 给用户看的数值，如“示范的 82%” */
  display: string
  target: string
  score: number | null
  /** 剔除不计分项后按比例重分配的权重 */
  weight: number
  /** false 表示只展示不计分（如攒拳幅度、二维近似不可靠的重心方向） */
  evaluated: boolean
  note?: string
}

export interface AnalyzerEvaluation {
  /** 计分项的加权平均 0–100；全部无法测量时为 null */
  score: number | null
  metrics: MetricResult[]
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
  /** 引用实测数值的句子，最差的在前 */
  feedback: AnalyzerFeedbackItem[]
}

export interface AnalyzerReportMetrics {
  analyzerId: RoutineId
  version: string
  title: string
  /** 已评分章节的平均；没有可评分章节时为 null */
  score: number | null
  chapters: AnalyzerChapterReport[]
  /** 方法与局限说明（二维近似、代理指标、暂定阈值） */
  notes: string[]
  /** 各分析器自己的汇总，只含普通 JSON 值 */
  extras: Record<string, unknown>
}

export interface RoutineAnalyzer<F, E extends AnalyzerEvaluation = AnalyzerEvaluation> {
  readonly id: RoutineId
  readonly version: string
  readonly title: string
  /** 实时窗口长度，ms */
  readonly liveWindowMs: number
  /** 本分析器评价的章节（如五禽戏不评起势、收势） */
  covers(chapter: RoutineChapter): boolean
  extractFeatures(pose: AnalyzerPose, context: AnalyzerContext): F | null
  evaluate(samples: ReadonlyArray<AnalyzerSample<F>>, chapter: RoutineChapter): E | null
  buildFeedback(evaluation: E, chapter: RoutineChapter): AnalyzerFeedbackItem[]
  buildReportMetrics(chapters: ReadonlyArray<{ chapter: RoutineChapter; evaluation: E | null }>): AnalyzerReportMetrics
}
