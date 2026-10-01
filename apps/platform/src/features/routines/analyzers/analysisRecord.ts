import type { AnalyzerEvaluation, MetricResult } from './types'

/** 一章的分析结果：对整章特征序列的评价 */
export interface AnalysisChapterRecord {
  chapterId: string
  /** 本章采集的样本数（含不可用的） */
  samples: number
  evaluation: AnalyzerEvaluation | null
}

/** 存在会话记录的 analysis 中，只存汇总数值不存姿态序列，整套只有几 KB */
export interface RoutineAnalysisRecord {
  analyzerId: string
  version: string
  chapters: AnalysisChapterRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const finiteOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))

function isMetric(value: unknown): value is MetricResult {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && finiteOrNull(value.value)
    && typeof value.unit === 'string'
    && typeof value.display === 'string'
    && typeof value.target === 'string'
    && finiteOrNull(value.score)
    && typeof value.weight === 'number' && Number.isFinite(value.weight)
    && typeof value.evaluated === 'boolean'
    && (value.note === undefined || typeof value.note === 'string')
}

export function isAnalyzerEvaluation(value: unknown): value is AnalyzerEvaluation {
  return isRecord(value)
    && finiteOrNull(value.score)
    && typeof value.usableSamples === 'number' && Number.isFinite(value.usableSamples)
    && Array.isArray(value.metrics) && value.metrics.every(isMetric)
}

/** 报告使用的深层校验；格式不对时报告忽略分析结果，而不是丢弃整条记录 */
export function isRoutineAnalysisRecord(value: unknown): value is RoutineAnalysisRecord {
  return isRecord(value)
    && typeof value.analyzerId === 'string'
    && typeof value.version === 'string'
    && Array.isArray(value.chapters)
    && value.chapters.every((item) => isRecord(item)
      && typeof item.chapterId === 'string'
      && typeof item.samples === 'number' && Number.isFinite(item.samples)
      && (item.evaluation === null || isAnalyzerEvaluation(item.evaluation)))
}
