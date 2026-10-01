import { describe, expect, it } from 'vitest'
import { isRoutineAnalysisRecord } from '../src/features/routines/analyzers/analysisRecord'
import { buildRoutineAnalysisReport, createRoutineAnalysis, createRoutineAnalyzer } from '../src/features/routines/analyzers/registry'
import { RoutineAnalysisEngine } from '../src/features/routines/analyzers/RoutineAnalysisEngine'
import { combineMetrics, continuousRuns, hysteresisCrossings, longestTrueRun, percentile, rampScore } from '../src/features/routines/analyzers/signal'
import { TimeWindow } from '../src/features/routines/analyzers/timeWindow'
import type { AnalyzerEvaluation, AnalyzerSample, RoutineAnalyzer } from '../src/features/routines/analyzers/types'
import { getRoutineProgram } from '../src/features/routines/programs'
import { buildRoutineReport } from '../src/features/routines/report/routineReport'
import { isRoutineSessionRecord } from '../src/features/routines/session/types'
import type { RoutineChapter } from '../src/features/routines/types'
import { routineRecord, standingPose } from './helpers/routineFixtures'
import { standardTrack } from './helpers/routineReplay'

describe('TimeWindow', () => {
  it('keeps only the items of the last durationMs', () => {
    const window = new TimeWindow<number>(1000, 8)
    for (let at = 0; at <= 3000; at += 250) window.push(at, at)
    expect(window.toArray()).toEqual([2000, 2250, 2500, 2750, 3000])
    expect(window.latestAt).toBe(3000)
  })

  it('overwrites the oldest item when full and starts over when time goes backwards', () => {
    const window = new TimeWindow<number>(10_000, 3)
    for (const at of [1, 2, 3, 4]) window.push(at, at)
    expect(window.toArray()).toEqual([2, 3, 4])
    window.push(0, 0)
    expect(window.toArray()).toEqual([0])
  })
})

describe('analyzer signal helpers', () => {
  it('scores on a ramp in either direction and redistributes weights of unscored metrics', () => {
    expect(rampScore(0.7, 0.5, 0.9)).toBe(50)
    expect(rampScore(0.03, 0.05, 0.02)).toBe(67)
    expect(rampScore(Number.NaN, 0, 1)).toBe(0)
    const { score, metrics } = combineMetrics([
      { id: 'a', label: 'a', value: 1, unit: '', display: '', target: '', score: 80, nominalWeight: 0.4, evaluated: true },
      { id: 'b', label: 'b', value: null, unit: '', display: '', target: '', score: null, nominalWeight: 0.2, evaluated: true },
      { id: 'c', label: 'c', value: 1, unit: '', display: '', target: '', score: 0, nominalWeight: 0.4, evaluated: false },
      { id: 'd', label: 'd', value: 1, unit: '', display: '', target: '', score: 40, nominalWeight: 0.4, evaluated: true },
    ])
    expect(score).toBe(60)
    expect(metrics.map((metric) => metric.weight)).toEqual([0.5, 0, 0, 0.5])
  })

  it('breaks sequences at gaps and seeks, and measures runs and crossings', () => {
    const samples: Array<AnalyzerSample<number>> = [0, 100, 200, 900, 1000, 1100].map((at) => ({ at, videoSeconds: at / 1000, features: at }))
    samples.push({ at: 1200, videoSeconds: 0.2, features: 1 })
    expect(continuousRuns(samples, 400).map((run) => run.length)).toEqual([3, 3, 1])
    expect(longestTrueRun([true, true, false, true, true, true], [0, 100, 200, 300, 400, 500])).toEqual({ durationMs: 200, from: 3, to: 5 })
    expect(hysteresisCrossings([0.1, 0.5, 0.9, 0.5, 0.1, 0.9], 0.35, 0.65)).toBe(3)
    expect(percentile([3, 1, 2], 0.5)).toBe(2)
  })
})

/** A minimal analyzer: its feature is the pose confidence, its score the mean confidence × 100. */
function confidenceAnalyzer(covered: (chapter: RoutineChapter) => boolean): RoutineAnalyzer<number, AnalyzerEvaluation> {
  return {
    id: 'baduanjin',
    version: 'test',
    title: 'test',
    liveWindowMs: 1000,
    covers: covered,
    extractFeatures: (pose) => (pose.confidence > 0 ? pose.confidence : null),
    evaluate: (samples) => {
      const values = samples.flatMap((sample) => (sample.features === null ? [] : [sample.features]))
      if (!values.length) return null
      const score = Math.round((100 * values.reduce((sum, value) => sum + value, 0)) / values.length)
      return { score, usableSamples: values.length, metrics: [] }
    },
    buildFeedback: (evaluation) => [{ metricId: 'mean', tone: 'info', message: `平均 ${evaluation.score}` }],
    buildReportMetrics: () => ({ analyzerId: 'baduanjin', version: 'test', title: 'test', score: null, chapters: [], notes: [], extras: {} }),
  }
}

describe('RoutineAnalysisEngine', () => {
  const program = getRoutineProgram('baduanjin')
  const pose = (confidence: number) => ({ landmarks: standingPose(), confidence, aspect: 16 / 9 })

  it('cuts the sequence by chapter on the video clock and skips chapters the analyzer does not cover', () => {
    const engine = new RoutineAnalysisEngine(confidenceAnalyzer((chapter) => chapter.kind === 'form'), program, { kind: 'full' })
    engine.observe(10, 1000, pose(0.9))
    engine.observe(50, 1100, pose(0.8))
    engine.observe(50.1, 1200, pose(0.6))
    engine.observe(140, 1300, pose(0.5))
    const snapshot = engine.snapshot()
    expect(snapshot.chapters.map((item) => [item.chapterId, item.samples, item.evaluation?.score])).toEqual([['bdj-1', 2, 70], ['bdj-2', 1, 50]])
    expect(isRoutineAnalysisRecord(snapshot)).toBe(true)
  })

  it('keeps the live window to the current chapter and the analyzer window length', () => {
    const engine = new RoutineAnalysisEngine(confidenceAnalyzer(() => true), program, { kind: 'full' })
    for (let index = 0; index < 30; index += 1) engine.observe(50 + index * 0.1, 1000 + index * 100, pose(index < 15 ? 0.2 : 1))
    expect(engine.live()).toMatchObject({ chapterId: 'bdj-1', score: 100, feedback: { message: '平均 100' } })
    engine.observe(140, 4100, pose(0.4))
    expect(engine.live()).toMatchObject({ chapterId: 'bdj-2', score: 40 })
  })

  it('keeps the last scored live view while the window has nothing to score, until the chapter changes', () => {
    let scoring = true
    const analyzer = confidenceAnalyzer(() => true)
    const switchable = { ...analyzer, evaluate: (samples: ReadonlyArray<AnalyzerSample<number>>, chapter: RoutineChapter) => (scoring ? analyzer.evaluate(samples, chapter) : { score: null, usableSamples: 0, metrics: [] }) }
    const engine = new RoutineAnalysisEngine(switchable, program, { kind: 'full' })
    engine.observe(50, 1000, pose(0.7))
    expect(engine.live()).toMatchObject({ chapterId: 'bdj-1', score: 70 })
    scoring = false
    engine.observe(50.1, 1100, pose(0.9))
    expect(engine.live()).toMatchObject({ chapterId: 'bdj-1', score: 70 })
    engine.observe(140, 1200, pose(0.9))
    expect(engine.live()).toMatchObject({ chapterId: 'bdj-2', score: null })
  })

  it('only follows the chapters of a single-form scope', () => {
    const engine = new RoutineAnalysisEngine(confidenceAnalyzer(() => true), program, { kind: 'form', chapterId: 'bdj-3' })
    engine.observe(50, 1000, pose(0.9))
    engine.observe(230, 1100, pose(0.9))
    expect(engine.snapshot().chapters.map((item) => item.chapterId)).toEqual(['bdj-3'])
  })

  it('re-evaluates a chapter only after new samples arrive', () => {
    let evaluations = 0
    const analyzer = confidenceAnalyzer(() => true)
    const counting = { ...analyzer, evaluate: (samples: ReadonlyArray<AnalyzerSample<number>>, chapter: RoutineChapter) => { evaluations += 1; return analyzer.evaluate(samples, chapter) } }
    const engine = new RoutineAnalysisEngine(counting, program, { kind: 'full' })
    engine.observe(50, 1000, pose(0.9))
    engine.snapshot()
    engine.snapshot()
    expect(evaluations).toBe(1)
    engine.observe(50.1, 1100, pose(0.9))
    engine.snapshot()
    expect(evaluations).toBe(2)
  })
})

describe('analysis in the session record and the report', () => {
  it('registers analyzers by routine and leaves routines without one unchanged', () => {
    expect(createRoutineAnalyzer(getRoutineProgram('baduanjin'))?.title).toBe('八段锦到位度')
    const analysis = createRoutineAnalysis(getRoutineProgram('baduanjin'), { kind: 'full' }, standardTrack('baduanjin'))
    expect(analysis?.analyzer.id).toBe('baduanjin')
  })

  it('accepts records without analysis and ignores a malformed one instead of rejecting the session', () => {
    const base = routineRecord()
    expect(isRoutineSessionRecord(base)).toBe(true)
    expect(buildRoutineReport(base)?.analysis).toBeNull()
    const malformed = { ...base, analysis: { analyzerId: 'baduanjin', version: 'baduanjin-reach-v1', chapters: [{ chapterId: 'bdj-1' }] } }
    expect(isRoutineSessionRecord(malformed)).toBe(true)
    expect(buildRoutineReport(malformed as never)?.analysis).toBeNull()
    expect(isRoutineSessionRecord({ ...base, analysis: 'x' })).toBe(false)
  })

  it('ignores an analysis saved by another analyzer version', () => {
    const program = getRoutineProgram('baduanjin')
    expect(buildRoutineAnalysisReport(program, { kind: 'full' }, { analyzerId: 'baduanjin', version: 'old', chapters: [] })).toBeNull()
    expect(buildRoutineAnalysisReport(program, { kind: 'full' }, { analyzerId: 'baduanjin', version: createRoutineAnalyzer(program)!.version, chapters: [] })).not.toBeNull()
  })
})
