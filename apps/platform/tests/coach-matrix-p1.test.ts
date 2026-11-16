import { describe, expect, it } from 'vitest'
import { answerCoachQuestion, FOCUS_LABELS, recommendationFocus } from '../src/features/coachAgent/recommendation/engine'
import type { CoachProfile, CoachRecommendationResult } from '../src/features/coachAgent/recommendation/types'
import { COACH_DECISION_CONTRACT, createCoachDecisionEngine, recommendCoachDecision } from '../src/features/coachAgent/decisionModel/engine'

// Wang E02 / E04 / E06 / E13: a self-reported profile without training or report history.
const profile: CoachProfile = { version: 1, goals: ['daily'], difficulties: ['none'], regions: ['arms'], preference: 'mixed', risk: 'none', acknowledged: true }
const input = { contract: COACH_DECISION_CONTRACT, profile }
const active = { mode: 'active' as const, allowExperimentalModel: true }

describe('AI Coach matrix P1 regressions', () => {
  it('gives a concrete next-stage focus for the actual M2 cold-start recommendation', () => {
    const response = recommendCoachDecision(input, active)
    expect(response.decisionOrigin).toBe('model')
    const display = response.display!
    const first = display.result.chapters[0].entry
    expect(first.id).toBe('tjq-10')
    expect(display.answers.next_focus).toContain(first.title)
    expect(display.answers.next_focus).toContain(FOCUS_LABELS[first.focuses[0]])
    expect(display.answers.next_focus).not.toMatch(/下一阶段可关注：。|StartLux|规则兜底/)
    expect(recommendationFocus(display.result).length).toBeGreaterThan(0)
  })

  it('does not infer a missing game launcher from an independent game catalogue entry', () => {
    const response = recommendCoachDecision(input, active)
    const display = response.display!
    expect(display.result.games[0].entry).toMatchObject({ id: 'boating', href: null })
    expect(display.answers.first_game).toContain('林间划船')
    expect(display.answers.first_game).not.toMatch(/未配置启动地址|不能启动|已启动|服务已连接/)
  })

  it('keeps an actionable focus when unavailable weights force the existing rule fallback', () => {
    const response = createCoachDecisionEngine({ weights: undefined }).recommend(input, active)
    expect(response.fallbackReason).toBe('MODEL_MISSING')
    expect(response.decisionOrigin).toBe('rules')
    expect(response.display!.answers.next_focus).toContain(response.display!.result.chapters[0].entry.title)
    expect(response.display!.answers.next_focus).not.toMatch(/下一阶段可关注：。|StartLux/)
  })

  it('does not invent a phase or show an empty field when no focus or content exists', () => {
    const result: CoachRecommendationResult = { status: 'ready', message: '', routines: [], chapters: [], games: [], focus: [], evidence: [], limitations: [] }
    expect(answerCoachQuestion('next_focus', result)).toBe('当前缺少可执行的训练重点，请完善画像后重新生成推荐。')
    expect(answerCoachQuestion('first_game', result)).toContain('当前没有通过风险筛选的游戏')
    expect(recommendationFocus(result)).toEqual([])
  })

  it('keeps an existing recommendation focus instead of replacing it with chapter metadata', () => {
    const result = recommendCoachDecision(input, active).display!.result
    const focused = { ...result, focus: ['stability' as const] }
    expect(recommendationFocus(focused)).toEqual(['stability'])
    expect(answerCoachQuestion('next_focus', focused)).toContain('下一阶段可关注：姿势与支撑稳定。')
  })
})
