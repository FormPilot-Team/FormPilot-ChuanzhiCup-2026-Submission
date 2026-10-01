import { describe, expect, it } from 'vitest'
import { taijiquanFeatures } from '../src/features/routines/analyzers/taijiquan/features'
import { scoreShiftRule, TaijiquanAnalyzer, type TaijiquanEvaluation } from '../src/features/routines/analyzers/taijiquan/TaijiquanAnalyzer'
import { TAIJIQUAN_STEPS } from '../src/features/routines/analyzers/taijiquan/steps'
import type { ReferencePoint } from '../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../src/features/routines/programs'
import type { RoutineScope } from '../src/features/routines/types'
import { standingPose } from './helpers/routineFixtures'
import { mirrorLandmarks, noisyLandmarks, replayRoutine, standardTrack, type ReplayOptions } from './helpers/routineReplay'

const program = getRoutineProgram('taijiquan')
const form = (chapterId: string): RoutineScope => ({ kind: 'form', chapterId })
const chapter = (id: string) => program.chapters.find((item) => item.id === id)!

function evaluationOf(chapterId: string, options: ReplayOptions = {}): TaijiquanEvaluation | null {
  const run = replayRoutine('taijiquan', { scope: form(chapterId), ...options })
  return (run.record.analysis?.chapters.find((item) => item.chapterId === chapterId)?.evaluation ?? null) as TaijiquanEvaluation | null
}

const metric = (evaluation: TaijiquanEvaluation | null, id: string) => evaluation?.metrics.find((item) => item.id === id)

describe('太极拳连续性: step table', () => {
  it('annotates every form of programs.ts and nothing else', () => {
    expect(Object.keys(TAIJIQUAN_STEPS).sort()).toEqual(program.chapters.map((item) => item.id).sort())
  })

  it('sets scoreShift by the demonstrator rule for every form (≥ 70 % agreement in the 定势窗口)', () => {
    const analyzer = new TaijiquanAnalyzer(program, standardTrack('taijiquan'))
    for (const item of program.chapters) {
      const step = TAIJIQUAN_STEPS[item.id]
      expect(scoreShiftRule(analyzer.reference(item.id)!, step), `${item.id} ${item.name}`).toBe(step.scoreShift)
    }
    expect(program.chapters.filter((item) => !TAIJIQUAN_STEPS[item.id].scoreShift).map((item) => item.name))
      .toEqual(['手挥琵琶', '单鞭', '单鞭', '双峰贯耳', '左下势独立', '十字手'])
  })

  it('keeps the described direction of 手挥琵琶 and 双峰贯耳 and records it without scoring, because the 2D approximation flips sideways', () => {
    for (const id of ['tjq-5', 'tjq-14']) {
      expect(TAIJIQUAN_STEPS[id]).toMatchObject({ weightShift: 'right', scoreShift: false })
      expect(TAIJIQUAN_STEPS[id].note).toContain('侧身时左右颠倒')
      const analyzer = new TaijiquanAnalyzer(program, standardTrack('taijiquan'))
      // The demonstrator really measures on the other side.
      expect(analyzer.reference(id)!.settleAgreement).toBe(0)
    }
    const evaluation = evaluationOf('tjq-5')!
    expect(metric(evaluation, 'weightShift')).toMatchObject({ evaluated: false, score: null, weight: 0 })
    expect(evaluation.score).toBe(100)
    const messages = new TaijiquanAnalyzer(program).buildFeedback(evaluation, chapter('tjq-5')).map((item) => item.message)
    expect(messages.at(-1)).toMatch(/^重心方向只记录不计分：/)
    expect(TAIJIQUAN_STEPS['tjq-9'].weightShift).toBe('left')
    expect(TAIJIQUAN_STEPS['tjq-20']).toMatchObject({ weightShift: 'left', scoreShift: true })
    expect(TAIJIQUAN_STEPS['tjq-23'].weightShift).toBe('balanced')
  })
})

describe('太极拳连续性: evaluation', () => {
  it('gives the demonstrator full marks, weight shift included where it is scored', () => {
    const evaluation = evaluationOf('tjq-3')!
    expect(evaluation.score).toBe(100)
    expect(metric(evaluation, 'weightShift')).toMatchObject({ evaluated: true, score: 100 })
  })

  it('finds stops while the demonstrator keeps moving', () => {
    // Every 5 s the user stands still for 2 s, then catches up.
    const stopAndGo = (video: number) => {
      const cycle = Math.floor(video / 5) * 5
      return video - cycle < 2 ? cycle : cycle + ((video - cycle - 2) * 5) / 3
    }
    const evaluation = evaluationOf('tjq-10', { sourceSeconds: stopAndGo })!
    expect(evaluation.pauseShare).toBeGreaterThan(0.15)
    expect(metric(evaluation, 'pauses')!.score).toBeLessThan(50)
    const messages = new TaijiquanAnalyzer(program).buildFeedback(evaluation, chapter('tjq-10')).map((item) => item.message)
    expect(messages[0]).toMatch(/^示范在动时停顿 \d+% 的时间，动作要连绵不断/)
  })

  it('reads tremor or tracking noise as jitter, not as continuity', () => {
    const evaluation = evaluationOf('tjq-10', { transform: noisyLandmarks(0.015, 3) })!
    expect(evaluation.jitter).toBeGreaterThan(0.03)
    expect(metric(evaluation, 'smoothness')!.score).toBeLessThan(40)
    expect(metric(evaluation, 'pauses')!.score).toBe(100)
  })

  it('flips the expected leg when the user follows as in a mirror', () => {
    const evaluation = evaluationOf('tjq-3', { transform: mirrorLandmarks })!
    expect(evaluation.weightShiftValue).toBeGreaterThanOrEqual(0.9)
    expect(metric(evaluation, 'weightShift')!.score).toBe(100)
  })

  it('says it cannot tell the supporting leg when the ankles are too close or hidden (null, never zero)', () => {
    const together = standingPose().map((point, index) => (index === 27 || index === 28 ? { ...point, x: 0.5 } : point))
    expect(taijiquanFeatures({ landmarks: together, confidence: 0.9, aspect: 16 / 9 }, {})?.supportRatio).toBeNull()
    const hidden = standingPose().map((point, index) => (index === 27 ? { ...point, visibility: 0.1 } : point))
    expect(taijiquanFeatures({ landmarks: hidden, confidence: 0.9, aspect: 16 / 9 }, {})?.supportRatio).toBeNull()
    const hiddenAnkles = (landmarks: ReadonlyArray<ReferencePoint>) => landmarks.map((point, index) => (index === 27 || index === 28 ? { ...point, visibility: 0.1 } : point))
    const evaluation = evaluationOf('tjq-3', { transform: hiddenAnkles })!
    expect(metric(evaluation, 'weightShift')).toMatchObject({ value: null, score: null, weight: 0 })
    expect(evaluation.score).not.toBeNull()
  })

  it('needs enough samples before evaluating', () => {
    const analyzer = new TaijiquanAnalyzer(program, standardTrack('taijiquan'))
    const frames = standardTrack('taijiquan').frames.filter((frame) => frame.t >= 20 && frame.t < 21.5)
    const samples = frames.map((frame) => ({ at: frame.t * 1000, videoSeconds: frame.t, features: taijiquanFeatures({ landmarks: frame.landmarks, confidence: frame.confidence, aspect: 16 / 9 }, {}) }))
    expect(analyzer.evaluate(samples, chapter('tjq-2'))).toBeNull()
  })

  it('reports the weight shift as a 2D hip-centre approximation', () => {
    const report = new TaijiquanAnalyzer(program).buildReportMetrics([{ chapter: chapter('tjq-3'), evaluation: evaluationOf('tjq-3') }])
    expect(report.notes.join('')).toContain('基于姿态关键点的二维髋中心近似')
    expect(report.chapters[0].metrics.find((item) => item.id === 'weightShift')!.label).toContain('二维髋中心近似')
  })
})
