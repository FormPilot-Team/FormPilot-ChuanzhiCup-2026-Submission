import { describe, expect, it } from 'vitest'
import { wuqinxiFeatures } from '../src/features/routines/analyzers/wuqinxi/features'
import { WUQINXI_STEPS } from '../src/features/routines/analyzers/wuqinxi/steps'
import { rhythmLag, WuqinxiAnalyzer, type WuqinxiEvaluation } from '../src/features/routines/analyzers/wuqinxi/WuqinxiAnalyzer'
import type { ReferencePoint } from '../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../src/features/routines/programs'
import type { RoutineScope } from '../src/features/routines/types'
import { mirrorLandmarks, replayRoutine, standardTrack, type ReplayOptions } from './helpers/routineReplay'

const program = getRoutineProgram('wuqinxi')
const form = (chapterId: string): RoutineScope => ({ kind: 'form', chapterId })
const chapter = (id: string) => program.chapters.find((item) => item.id === id)!

function evaluationOf(chapterId: string, options: ReplayOptions = {}): WuqinxiEvaluation | null {
  const run = replayRoutine('wuqinxi', { scope: form(chapterId), ...options })
  return (run.record.analysis?.chapters.find((item) => item.chapterId === chapterId)?.evaluation ?? null) as WuqinxiEvaluation | null
}

const metric = (evaluation: WuqinxiEvaluation | null, id: string) => evaluation?.metrics.find((item) => item.id === id)

/** Wrists and elbows pulled towards the shoulders. */
function shortArms(factor: number) {
  return (landmarks: ReadonlyArray<ReferencePoint>) => {
    const next = landmarks.map((point) => ({ ...point }))
    for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]] as const) {
      for (const index of [elbow, wrist]) next[index] = { ...next[index], x: next[shoulder].x + factor * (next[index].x - next[shoulder].x), y: next[shoulder].y + factor * (next[index].y - next[shoulder].y) }
    }
    return next
  }
}

describe('五禽戏五戏特征: step table', () => {
  it('annotates every chapter of programs.ts and nothing else; 起势 and 收势 belong to no animal', () => {
    expect(Object.keys(WUQINXI_STEPS).sort()).toEqual(program.chapters.map((item) => item.id).sort())
    expect(WUQINXI_STEPS['wqx-open']).toBeNull()
    expect(WUQINXI_STEPS['wqx-close']).toBeNull()
    const forms = program.chapters.filter((item) => item.kind === 'form')
    expect(forms.map((item) => WUQINXI_STEPS[item.id]!.category)).toEqual(['tiger', 'tiger', 'deer', 'deer', 'bear', 'bear', 'ape', 'ape', 'bird', 'bird'])
    // The program's own 虎戏 / 鹿戏 … labels agree with the categories.
    const label = { tiger: '虎戏', deer: '鹿戏', bear: '熊戏', ape: '猿戏', bird: '鸟戏' } as const
    for (const item of forms) expect(item.label).toBe(label[WUQINXI_STEPS[item.id]!.category])
  })
})

describe('五禽戏五戏特征: evaluation', () => {
  it('gives the demonstrator full marks on each feature of 熊晃 (提髋 and 晃动)', () => {
    const evaluation = evaluationOf('wqx-6')!
    expect(evaluation.score).toBe(100)
    expect(evaluation.profile).toEqual([{ feature: 'hipHike', ratio: 1 }, { feature: 'hipSway', ratio: 1 }])
    expect(evaluation.lagSeconds).toBe(0)
  })

  it('marks a 虎举 with small arm movements on the tiger profile and quotes the share', () => {
    const evaluation = evaluationOf('wqx-1', { transform: shortArms(0.5) })!
    const reach = metric(evaluation, 'profile.reachUp')!
    expect(reach.value).toBeLessThan(0.8)
    expect(reach.score).toBeLessThan(80)
    const first = new WuqinxiAnalyzer(program).buildFeedback(evaluation, chapter('wqx-1'))[0]
    expect(first.message).toMatch(/^虎戏特征：两手上举高度幅度为示范的 \d+%，两掌上举如托重物/)
  })

  it('reads the movement rhythm against the video, independent of the movement size', () => {
    const late = evaluationOf('wqx-10', { lagSeconds: 2.5 })!
    expect(late.lagSeconds).toBeGreaterThanOrEqual(2.3)
    expect(late.lagSeconds).toBeLessThanOrEqual(2.7)
    expect(metric(late, 'rhythm')!.score).toBeLessThan(40)
    expect(metric(late, 'profile.wristHeight')!.score).toBe(100)
  })

  it('measures following as in a mirror like following as seen', () => {
    for (const id of ['wqx-3', 'wqx-6']) expect(evaluationOf(id, { transform: mirrorLandmarks })!.score, id).toBeGreaterThanOrEqual(95)
  })

  it('leaves a feature unmeasured when its landmarks are hidden, and scores the rest', () => {
    const hiddenEars = (landmarks: ReadonlyArray<ReferencePoint>) => landmarks.map((point, index) => (index === 7 || index === 8 ? { ...point, visibility: 0.1 } : point))
    const evaluation = evaluationOf('wqx-7', { transform: hiddenEars })!
    expect(metric(evaluation, 'profile.shrug')).toMatchObject({ value: null, score: null, weight: 0 })
    expect(metric(evaluation, 'profile.bodyRise')!.score).toBe(100)
    expect(evaluation.score).toBe(100)
    const together = wuqinxiFeatures({ landmarks: hiddenEars(standardTrack('wuqinxi').frames[5000].landmarks), confidence: 0.9, aspect: 16 / 9 }, {}, ['shrug'])
    expect(together?.profile).toEqual([null])
  })

  it('needs enough samples and enough time for a rhythm', () => {
    const analyzer = new WuqinxiAnalyzer(program, standardTrack('wuqinxi'))
    const frames = standardTrack('wuqinxi').frames.filter((frame) => frame.t >= 400 && frame.t < 401.5)
    const samples = frames.map((frame) => ({ at: frame.t * 1000, videoSeconds: frame.t, features: wuqinxiFeatures({ landmarks: frame.landmarks, confidence: frame.confidence, aspect: 16 / 9 }, {}, ['hipHike', 'hipSway']) }))
    expect(analyzer.evaluate(samples, chapter('wqx-6'))).toBeNull()
    expect(rhythmLag([{ videoSeconds: 400, value: 1 }, { videoSeconds: 405, value: 2 }], analyzer.reference('wqx-6')!.primary)).toBeNull()
  })

  it('groups the report by animal, without 起势 and 收势', () => {
    const run = replayRoutine('wuqinxi')
    const analyzer = new WuqinxiAnalyzer(program)
    const chapters = program.chapters.filter((item) => analyzer.covers(item)).map((item) => ({
      chapter: item,
      evaluation: (run.record.analysis!.chapters.find((entry) => entry.chapterId === item.id)?.evaluation ?? null) as WuqinxiEvaluation | null,
    }))
    expect(chapters).toHaveLength(10)
    const report = analyzer.buildReportMetrics(chapters)
    expect(report.score).toBe(100)
    expect((report.extras.categories as Array<{ label: string; profileRatio: number }>).map((item) => [item.label, item.profileRatio])).toEqual([
      ['虎戏', 1], ['鹿戏', 1], ['熊戏', 1], ['猿戏', 1], ['鸟戏', 1],
    ])
    expect(report.notes.join('')).toContain('代理指标')
  })
})
