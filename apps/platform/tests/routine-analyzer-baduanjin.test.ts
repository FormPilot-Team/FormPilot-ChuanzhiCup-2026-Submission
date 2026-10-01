import { describe, expect, it } from 'vitest'
import { BaduanjinAnalyzer, type BaduanjinEvaluation } from '../src/features/routines/analyzers/baduanjin/BaduanjinAnalyzer'
import { BADUANJIN_STEPS } from '../src/features/routines/analyzers/baduanjin/steps'
import { buildRoutineAnalysisReport } from '../src/features/routines/analyzers/registry'
import type { ReferencePoint } from '../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../src/features/routines/programs'
import type { RoutineScope } from '../src/features/routines/types'
import { mirrorLandmarks, replayRoutine, standardTrack, type ReplayOptions } from './helpers/routineReplay'

const program = getRoutineProgram('baduanjin')
const form = (chapterId: string): RoutineScope => ({ kind: 'form', chapterId })

function evaluationOf(chapterId: string, options: ReplayOptions = {}): BaduanjinEvaluation | null {
  const run = replayRoutine('baduanjin', { scope: form(chapterId), ...options })
  const item = run.record.analysis?.chapters.find((chapter) => chapter.chapterId === chapterId)
  return (item?.evaluation ?? null) as BaduanjinEvaluation | null
}

function metric(evaluation: BaduanjinEvaluation | null, id: string) {
  return evaluation?.metrics.find((item) => item.id === id)
}

/** Wrists and elbows pulled towards the shoulders: the arms move through `factor` of their reach. */
function shortArms(factor: number) {
  return (landmarks: ReadonlyArray<ReferencePoint>) => {
    const next = landmarks.map((point) => ({ ...point }))
    for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]] as const) {
      for (const index of [elbow, wrist]) {
        next[index] = { ...next[index], x: next[shoulder].x + factor * (next[index].x - next[shoulder].x), y: next[shoulder].y + factor * (next[index].y - next[shoulder].y) }
      }
    }
    return next
  }
}

describe('八段锦到位度: step table', () => {
  it('annotates every chapter of programs.ts and nothing else', () => {
    expect(Object.keys(BADUANJIN_STEPS).sort()).toEqual(program.chapters.map((chapter) => chapter.id).sort())
    for (const chapter of program.chapters) {
      expect(BADUANJIN_STEPS[chapter.id] === null, chapter.id).toBe(chapter.kind !== 'form')
    }
  })

  it('finds the demonstrator repetitions of each form in the standard video', () => {
    const analyzer = new BaduanjinAnalyzer(program, standardTrack('baduanjin'))
    const counts = program.chapters.filter((chapter) => chapter.kind === 'form').map((chapter) => analyzer.reference(chapter.id)?.repetitions.length)
    // 托天 6, 开弓 6 + the tail of the last one, 单举 6, 后瞧 6, 摇头摆尾 12 sways, 攀足 6, 攒拳 6 + the rising first frames, 颠足 7.
    expect(counts).toEqual([6, 7, 6, 6, 12, 6, 7, 7])
    expect(analyzer.reference('bdj-1')!.repetitions.every((repetition) => repetition.excursion > 1.5)).toBe(true)
  })
})

describe('八段锦到位度: evaluation', () => {
  it('gives the demonstrator full marks on each measured aspect of 两手托天理三焦', () => {
    const evaluation = evaluationOf('bdj-1')!
    expect(evaluation.score).toBe(100)
    expect(evaluation.observedRepetitions).toBe(6)
    expect(evaluation.completedRepetitions).toBe(6)
    expect(evaluation.metrics.map((item) => [item.id, item.score])).toEqual([['amplitude', 100], ['timing', 100], ['steadiness', 100], ['phases', 100]])
  })

  it('marks down a lift that only reaches part of the demonstrator height, quoting the measured share', () => {
    const evaluation = evaluationOf('bdj-1', { transform: shortArms(0.5) })!
    const amplitude = metric(evaluation, 'amplitude')!
    expect(evaluation.amplitudeRatio).toBeLessThan(0.8)
    expect(amplitude.score).toBeLessThan(80)
    expect(evaluation.score).toBeLessThan(90)
    const analyzer = new BaduanjinAnalyzer(program)
    const first = analyzer.buildFeedback(evaluation, program.chapters[1])[0]
    expect(first.tone).toBe('warning')
    expect(first.message).toMatch(/^两腕上托高出头部只达到示范的 \d+%，两掌继续上托/)
  })

  it('reports being late against the demonstrator rise, not the shape of the movement', () => {
    const evaluation = evaluationOf('bdj-3', { lagSeconds: 2.5 })!
    expect(evaluation.timingOffsetSeconds).toBeGreaterThan(2)
    expect(metric(evaluation, 'timing')!.score).toBeLessThan(50)
    expect(metric(evaluation, 'amplitude')!.score).toBe(100)
    const messages = new BaduanjinAnalyzer(program).buildFeedback(evaluation, program.chapters[3]).map((item) => item.message)
    expect(messages[0]).toMatch(/^动作平均比示范晚 2\.\d 秒到位/)
  })

  it('measures following as in a mirror like following as seen (the trajectories are side-free)', () => {
    for (const chapterId of ['bdj-2', 'bdj-3', 'bdj-5']) {
      const mirrored = evaluationOf(chapterId, { transform: mirrorLandmarks })!
      expect(mirrored.score, chapterId).toBeGreaterThanOrEqual(95)
    }
  })

  it('does not score a form whose wrists are not visible (no zero for missing landmarks)', () => {
    const hiddenWrists = (landmarks: ReadonlyArray<ReferencePoint>) => landmarks.map((point, index) => (index === 15 || index === 16 ? { ...point, visibility: 0.1 } : point))
    expect(evaluationOf('bdj-1', { transform: hiddenWrists })).toBeNull()
  })

  it('needs enough samples before evaluating anything', () => {
    const analyzer = new BaduanjinAnalyzer(program, standardTrack('baduanjin'))
    const chapter = program.chapters[1]
    const frames = standardTrack('baduanjin').frames.filter((frame) => frame.t >= 50 && frame.t < 51.5)
    const samples = frames.map((frame) => ({ at: frame.t * 1000, videoSeconds: frame.t, features: analyzer.extractFeatures({ landmarks: frame.landmarks, confidence: frame.confidence, aspect: 16 / 9 }, { chapter, videoSeconds: frame.t }) }))
    expect(samples.length).toBeLessThan(20)
    expect(analyzer.evaluate(samples, chapter)).toBeNull()
  })

  it('only detects the 攒拳 phases and says the amplitude was not evaluated', () => {
    const evaluation = evaluationOf('bdj-7', { transform: shortArms(0.6) })!
    expect(evaluation.amplitudeEvaluated).toBe(false)
    const amplitude = metric(evaluation, 'amplitude')!
    expect(amplitude).toMatchObject({ evaluated: false, score: null, weight: 0, display: '未评估幅度' })
    expect(evaluation.score).toBeGreaterThanOrEqual(90)
    const report = buildRoutineAnalysisReport(program, form('bdj-7'), { analyzerId: 'baduanjin', version: 'baduanjin-reach-v1', chapters: [{ chapterId: 'bdj-7', samples: 600, evaluation }] })!
    expect(report.extras.repetitions).toEqual([expect.objectContaining({ chapterId: 'bdj-7', amplitudeEvaluated: false })])
    expect(report.chapters[0].feedback.map((item) => item.message)).toContain('冲拳手从腰间抬至肩高（阶段检测）：只检测冲拳阶段，未评估幅度')
  })

  it('names the 颠足 amplitude heelRiseProxy, calls it an approximation and gives it a low weight', () => {
    const evaluation = evaluationOf('bdj-8')!
    const proxy = metric(evaluation, 'heelRiseProxy')!
    expect(proxy.display).toContain('近似')
    expect(proxy.note).toContain('近似估计')
    expect(proxy.note).not.toContain('精确')
    expect(proxy.weight).toBeLessThan(0.15)
    expect(metric(evaluation, 'amplitude')).toBeUndefined()
  })
})
