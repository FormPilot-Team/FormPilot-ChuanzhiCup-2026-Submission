import type { ReferenceTrack } from '../followAlong/referenceTrack'
import { scopeChapters } from '../scope'
import type { RoutineId, RoutineProgram, RoutineScope } from '../types'
import { isRoutineAnalysisRecord } from './analysisRecord'
import { BaduanjinAnalyzer } from './baduanjin/BaduanjinAnalyzer'
import { RoutineAnalysisEngine } from './RoutineAnalysisEngine'
import { TaijiquanAnalyzer } from './taijiquan/TaijiquanAnalyzer'
import { WuqinxiAnalyzer } from './wuqinxi/WuqinxiAnalyzer'
import { YijinjingAnalyzer } from './yijinjing/YijinjingAnalyzer'
import type { AnalyzerEvaluation, AnalyzerReportMetrics, RoutineAnalyzer } from './types'

export type AnyRoutineAnalyzer = RoutineAnalyzer<unknown, AnalyzerEvaluation>

export type RoutineAnalysis = RoutineAnalysisEngine<unknown, AnalyzerEvaluation>

type AnalyzerFactory = (program: RoutineProgram, track?: ReferenceTrack) => AnyRoutineAnalyzer

const FACTORIES: Partial<Record<RoutineId, AnalyzerFactory>> = {
  baduanjin: (program, track) => new BaduanjinAnalyzer(program, track) as unknown as AnyRoutineAnalyzer,
  taijiquan: (program, track) => new TaijiquanAnalyzer(program, track) as unknown as AnyRoutineAnalyzer,
  wuqinxi: (program, track) => new WuqinxiAnalyzer(program, track) as unknown as AnyRoutineAnalyzer,
  yijinjing: (program, track) => new YijinjingAnalyzer(program, track) as unknown as AnyRoutineAnalyzer,
}

/** 没有轨迹时只能格式化已存的评价（报告），不能做需要示范参考的评价 */
export function createRoutineAnalyzer(program: RoutineProgram, track?: ReferenceTrack): AnyRoutineAnalyzer | undefined {
  return FACTORIES[program.id]?.(program, track)
}

export function routineAnalyzerTitle(program: RoutineProgram): string | undefined {
  return createRoutineAnalyzer(program)?.title
}

/** 功法没有分析器时返回 undefined，跟练流程不受影响 */
export function createRoutineAnalysis(program: RoutineProgram, scope: RoutineScope, track: ReferenceTrack): RoutineAnalysis | undefined {
  const analyzer = createRoutineAnalyzer(program, track)
  return analyzer ? new RoutineAnalysisEngine(analyzer, program, scope) : undefined
}

/** 记录缺失、分析器版本不同或格式不对时返回 null，报告不显示专项分析 */
export function buildRoutineAnalysisReport(program: RoutineProgram, scope: RoutineScope, analysis: unknown): AnalyzerReportMetrics | null {
  const analyzer = createRoutineAnalyzer(program)
  if (!analyzer || !isRoutineAnalysisRecord(analysis)) return null
  if (analysis.analyzerId !== analyzer.id || analysis.version !== analyzer.version) return null
  const saved = new Map(analysis.chapters.map((item) => [item.chapterId, item.evaluation]))
  const chapters = scopeChapters(program, scope)
    .filter((chapter) => analyzer.covers(chapter))
    .map((chapter) => ({ chapter, evaluation: saved.get(chapter.id) ?? null }))
  return analyzer.buildReportMetrics(chapters)
}
