import { describe, expect, it } from 'vitest'
import { YIJINJING_ANALYZER_CONFIG } from '../src/features/routines/analyzers/yijinjing/config'
import { yijinjingFeatures } from '../src/features/routines/analyzers/yijinjing/features'
import { YIJINJING_STEPS } from '../src/features/routines/analyzers/yijinjing/steps'
import { modeRule, YijinjingAnalyzer, type YijinjingEvaluation } from '../src/features/routines/analyzers/yijinjing/YijinjingAnalyzer'
import type { ReferencePoint } from '../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../src/features/routines/programs'
import type { RoutineScope } from '../src/features/routines/types'
import { mirrorLandmarks, noisyLandmarks, replayRoutine, standardTrack, type ReplayOptions } from './helpers/routineReplay'

const program = getRoutineProgram('yijinjing')
const form = (chapterId: string): RoutineScope => ({ kind: 'form', chapterId })
const chapter = (id: string) => program.chapters.find((item) => item.id === id)!
const analyzer = new YijinjingAnalyzer(program, standardTrack('yijinjing'))

function evaluationOf(chapterId: string, options: ReplayOptions = {}): YijinjingEvaluation | null {
  const run = replayRoutine('yijinjing', { scope: form(chapterId), ...options })
  return (run.record.analysis?.chapters.find((item) => item.chapterId === chapterId)?.evaluation ?? null) as YijinjingEvaluation | null
}

const metric = (evaluation: YijinjingEvaluation | null, id: string) => evaluation?.metrics.find((item) => item.id === id)

describe('易筋经稳定性: step table', () => {
  it('annotates every 势 of programs.ts and nothing else', () => {
    expect(Object.keys(YIJINJING_STEPS).sort()).toEqual(program.chapters.map((item) => item.id).sort())
  })

  it('sets hold / transition by the rule: 预备势 and 收势 hold, others hold after a demonstrator still stretch ≥ 1500 ms', () => {
    expect(YIJINJING_ANALYZER_CONFIG.stillness.holdMinMs).toBe(1500)
    for (const item of program.chapters) {
      expect(modeRule(item, analyzer.reference(item.id)!.still), `${item.id} ${item.name}`).toBe(YIJINJING_STEPS[item.id].mode)
    }
    expect(program.chapters.filter((item) => YIJINJING_STEPS[item.id].mode === 'transition').map((item) => item.name)).toEqual(['倒拽九牛尾势'])
    const seconds = program.chapters.map((item) => analyzer.reference(item.id)!.still.durationMs / 1000)
    expect(seconds).toEqual([14.8, 5.8, 6.5, 9.5, 2.2, 1.2, 11.9, 3.1, 3.4, 5.8, 5.3, 13.7, 1.5, 8.6])
  })

  it('takes the target pose from the middle of the demonstrator longest still stretch, holds only', () => {
    const reference = analyzer.reference('yjj-7')!
    expect(reference.target).not.toBeNull()
    expect(Math.abs((reference.targetAt as number) - (reference.still.from + reference.still.to) / 2)).toBeLessThanOrEqual(0.05)
    expect(analyzer.reference('yjj-5')!.target).toBeNull()
  })
})

describe('易筋经稳定性: evaluation', () => {
  it('gives the demonstrator full marks and their own hold time on a hold', () => {
    const evaluation = evaluationOf('yjj-2')!
    expect(evaluation.score).toBe(100)
    expect(evaluation.holdSeconds).toBe(evaluation.demonstratorHoldSeconds)
    expect(evaluation.metrics.map((item) => [item.id, item.weight])).toEqual([['pose', 0.4], ['hold', 0.25], ['stability', 0.35]])
  })

  it('judges a transition on 姿态 0.40 and 稳定性 0.35 only, renormalised', () => {
    const evaluation = evaluationOf('yjj-5')!
    expect(evaluation.mode).toBe('transition')
    expect(evaluation.metrics.map((item) => [item.id, item.weight])).toEqual([['pose', 0.533], ['stability', 0.467]])
    expect(metric(evaluation, 'stability')!.label).toBe('稳定性（动作中的抖动）')
    expect(evaluation.sway).toBeNull()
  })

  it('compares sided 势 as seen only, symmetric 势 also as in a mirror', () => {
    expect(YIJINJING_STEPS['yjj-7'].sided).toBe(true)
    expect(YIJINJING_STEPS['yjj-2'].sided).toBe(false)
    const sided = evaluationOf('yjj-7', { transform: mirrorLandmarks })!
    const symmetric = evaluationOf('yjj-2', { transform: mirrorLandmarks })!
    expect(sided.pose).toBeLessThan(0.75)
    expect(metric(sided, 'pose')!.score).toBeLessThan(70)
    expect(symmetric.score).toBe(100)
  })

  it('reads shaking as instability and as no hold', () => {
    const evaluation = evaluationOf('yjj-3', { transform: noisyLandmarks(0.012, 5) })!
    expect(evaluation.jitter).toBeGreaterThan(0.03)
    expect(metric(evaluation, 'stability')!.score).toBeLessThan(60)
    expect(evaluation.holdRatio).toBeLessThan(0.3)
    const messages = analyzer.buildFeedback(evaluation, chapter('yjj-3')).map((item) => item.message)
    expect(messages[0]).toMatch(/^静止保持 \d\.\d 秒（示范 9\.5 秒），到位后多停一会儿/)
    expect(messages.some((message) => message.startsWith('抖动 0.0'))).toBe(true)
  })

  it('shortens the hold of a user who arrives in the pose late', () => {
    const evaluation = evaluationOf('yjj-6', { lagSeconds: 4 })!
    expect(evaluation.holdRatio).toBeLessThan(0.9)
    expect(metric(evaluation, 'hold')!.score).toBeLessThan(100)
    const onTime = evaluationOf('yjj-6', { lagSeconds: 1 })!
    expect(metric(onTime, 'hold')!.score).toBe(100)
  })

  it('evaluates nothing without shoulders and hips, or with too few samples', () => {
    const noTorso = (landmarks: ReadonlyArray<ReferencePoint>) => landmarks.map((point, index) => ([11, 12, 23, 24].includes(index) ? { ...point, visibility: 0.1 } : point))
    expect(evaluationOf('yjj-1', { transform: noTorso })).toBeNull()
    const frames = standardTrack('yijinjing').frames.filter((frame) => frame.t >= 35 && frame.t < 36.5)
    const samples = frames.map((frame) => ({ at: frame.t * 1000, videoSeconds: frame.t, features: yijinjingFeatures({ landmarks: frame.landmarks, confidence: frame.confidence, aspect: 16 / 9 }, {}) }))
    expect(analyzer.evaluate(samples, chapter('yjj-1'))).toBeNull()
  })

  it('reports hold times per 势', () => {
    const report = analyzer.buildReportMetrics([{ chapter: chapter('yjj-2'), evaluation: evaluationOf('yjj-2') }, { chapter: chapter('yjj-5'), evaluation: evaluationOf('yjj-5') }])
    expect(report.extras.holds).toEqual([
      { chapterId: 'yjj-2', mode: 'hold', holdSeconds: 6.5, demonstratorHoldSeconds: 6.5 },
      { chapterId: 'yjj-5', mode: 'transition', holdSeconds: null, demonstratorHoldSeconds: null },
    ])
  })
})
