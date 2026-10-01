import type { ReferenceTrack } from '../followAlong/referenceTrack'
import { scopeChapters } from '../scope'
import type { RoutineId, RoutineProgram, RoutineScope } from '../types'
import { isRoutineAnalysisRecord } from './analysisRecord'
import { BaduanjinAnalyzer } from './baduanjin/BaduanjinAnalyzer'
import { RoutineAnalysisEngine } from './RoutineAnalysisEngine'
import { TaijiquanAnalyzer } from './taijiquan/TaijiquanAnalyzer'
import type { AnalyzerEvaluation, AnalyzerReportMetrics, RoutineAnalyzer } from './types'

/** Any analyzer, seen through the shared contract (features stay opaque outside the analyzer). */
export type AnyRoutineAnalyzer = RoutineAnalyzer<unknown, AnalyzerEvaluation>

/** The engine running one routine's analyzer during a session. */
export type RoutineAnalysis = RoutineAnalysisEngine<unknown, AnalyzerEvaluation>

type AnalyzerFactory = (program: RoutineProgram, track?: ReferenceTrack) => AnyRoutineAnalyzer

const FACTORIES: Partial<Record<RoutineId, AnalyzerFactory>> = {
  baduanjin: (program, track) => new BaduanjinAnalyzer(program, track) as unknown as AnyRoutineAnalyzer,
  taijiquan: (program, track) => new TaijiquanAnalyzer(program, track) as unknown as AnyRoutineAnalyzer,
}

/**
 * The routine's analyzer. Without a track it can still format saved evaluations (report), but evaluates nothing
 * that needs the demonstrator's reference.
 */
export function createRoutineAnalyzer(program: RoutineProgram, track?: ReferenceTrack): AnyRoutineAnalyzer | undefined {
  return FACTORIES[program.id]?.(program, track)
}

/** The live analysis next to the follow-along matcher; undefined when the routine has no analyzer (nothing changes then). */
export function createRoutineAnalysis(program: RoutineProgram, scope: RoutineScope, track: ReferenceTrack): RoutineAnalysis | undefined {
  const analyzer = createRoutineAnalyzer(program, track)
  return analyzer ? new RoutineAnalysisEngine(analyzer, program, scope) : undefined
}

/**
 * Report of a saved analysis. Records without one (saved before the analyzers, or the pose data missing), from
 * another analyzer version, or malformed, give null: the report then shows no 专项分析 section.
 */
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
