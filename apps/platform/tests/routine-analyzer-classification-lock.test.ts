import { describe, expect, it } from 'vitest'
import { scoreShiftRule, TaijiquanAnalyzer } from '../src/features/routines/analyzers/taijiquan/TaijiquanAnalyzer'
import { TAIJIQUAN_STEPS } from '../src/features/routines/analyzers/taijiquan/steps'
import { YIJINJING_STEPS } from '../src/features/routines/analyzers/yijinjing/steps'
import { modeRule, YijinjingAnalyzer } from '../src/features/routines/analyzers/yijinjing/YijinjingAnalyzer'
import { getRoutineProgram } from '../src/features/routines/programs'
import { standardTrack } from './helpers/routineReplay'

/**
 * Regression lock of the rule-derived classifications (2026-10-01, docs/ANALYZER_AUDIT.md §6). The expected lists are
 * written out on purpose: if the standard pose data, the stillness / agreement measurement or a threshold changes,
 * this test fails even when the step tables and the rules still agree with each other, so the change is reviewed.
 */

const YIJINJING_EXPECTED: ReadonlyArray<readonly [string, 'hold' | 'transition', number]> = [
  ['yjj-open', 'hold', 14_800], // 预备势: hold by definition
  ['yjj-1', 'hold', 5_800],
  ['yjj-2', 'hold', 6_500],
  ['yjj-3', 'hold', 9_500],
  ['yjj-4', 'hold', 2_200],
  ['yjj-5', 'transition', 1_200], // 倒拽九牛尾势: the only transition
  ['yjj-6', 'hold', 11_900],
  ['yjj-7', 'hold', 3_100],
  ['yjj-8', 'hold', 3_400],
  ['yjj-9', 'hold', 5_800],
  ['yjj-10', 'hold', 5_300],
  ['yjj-11', 'hold', 13_700],
  // 掉尾势: the demonstrator's longest still stretch is exactly 1500 ms, ON the hold threshold (rule: ≥ 1500 ms).
  // One frame (100 ms) less in the pose data, or a threshold of 1501 ms, turns it into a transition.
  ['yjj-12', 'hold', 1_500],
  ['yjj-close', 'hold', 8_600], // 收势: hold by definition
]

const TAIJIQUAN_SCORE_SHIFT_FALSE = ['tjq-5', 'tjq-9', 'tjq-11', 'tjq-14', 'tjq-16', 'tjq-23'] as const

describe('rule-derived classifications stay as decided', () => {
  it('易筋经: hold / transition of the 14 sections, and the still stretches behind them', () => {
    const program = getRoutineProgram('yijinjing')
    const analyzer = new YijinjingAnalyzer(program, standardTrack('yijinjing'))
    expect(program.chapters.map((chapter) => chapter.id)).toEqual(YIJINJING_EXPECTED.map(([id]) => id))
    for (const [id, mode, stillMs] of YIJINJING_EXPECTED) {
      const chapter = program.chapters.find((item) => item.id === id)!
      const still = analyzer.reference(id)!.still
      expect(YIJINJING_STEPS[id].mode, `${id} step table`).toBe(mode)
      expect(modeRule(chapter, still), `${id} rule on the standard video`).toBe(mode)
      expect(still.durationMs, `${id} longest still stretch`).toBe(stillMs)
    }
  })

  it('太极拳: scoreShift is false for exactly 手挥琵琶, 单鞭 ×2, 双峰贯耳, 左下势独立 and 十字手', () => {
    const program = getRoutineProgram('taijiquan')
    const analyzer = new TaijiquanAnalyzer(program, standardTrack('taijiquan'))
    const expected = program.chapters.map((chapter) => [chapter.id, !(TAIJIQUAN_SCORE_SHIFT_FALSE as ReadonlyArray<string>).includes(chapter.id)])
    expect(program.chapters.map((chapter) => [chapter.id, TAIJIQUAN_STEPS[chapter.id].scoreShift])).toEqual(expected)
    expect(program.chapters.map((chapter) => [chapter.id, scoreShiftRule(analyzer.reference(chapter.id)!, TAIJIQUAN_STEPS[chapter.id])])).toEqual(expected)
    expect(TAIJIQUAN_SCORE_SHIFT_FALSE.map((id) => program.chapters.find((chapter) => chapter.id === id)!.name)).toEqual(['手挥琵琶', '单鞭', '单鞭', '双峰贯耳', '左下势独立', '十字手'])
  })
})
