import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoachProfile, KnowledgeEntry } from '../src/features/coachAgent/recommendation/types'

// Only the catalogue is controlled here. Ranking, risk checks and the Web service remain real.
const testCatalogue = vi.hoisted(() => ({ entries: [] as KnowledgeEntry[] }))
vi.mock('../src/features/coachAgent/recommendation/catalogue', () => ({
  get COACH_KNOWLEDGE() { return testCatalogue.entries },
}))

import { getCoachWebRecommendation } from '../src/features/coachAgent/recommendation/webService'

const profile = (): CoachProfile => ({
  version: 1, goals: ['daily'], difficulties: ['none'], regions: ['arms'],
  preference: 'mixed', risk: 'none', acknowledged: true,
})
const entry = (kind: KnowledgeEntry['kind']): KnowledgeEntry => ({
  id: `test-only:${kind}`, kind, title: `合成测试目录 ${kind}`,
  regions: ['arms'], focuses: ['general'], movement: '合成测试动作描述', caution: [],
  verification: 'project_verified', sources: ['fixture:web-empty-contract'], href: null,
  ...(kind === 'game' ? {} : { programId: 'baduanjin', chapterId: kind === 'chapter' ? 'bdj-1' : undefined }),
  ...(kind === 'chapter' ? { href: '/routines/baduanjin/train?form=bdj-1' } : {}),
})

beforeEach(() => { testCatalogue.entries = [] })

describe('Web recommendation empty and partial category contracts', () => {
  it('returns a distinct empty response when no eligible catalogue entries exist', () => {
    const response = getCoachWebRecommendation({ schemaVersion: 1, source: 'rules', profile: profile() })
    expect(response.status).toBe('empty')
    if (response.status === 'error') throw new Error('Expected a valid empty response')
    expect(response.result.status).toBe('ready')
    expect(response.result.message).toContain('没有可用')
    expect(response.result.routines).toEqual([])
    expect(response.result.chapters).toEqual([])
    expect(response.result.games).toEqual([])
    expect(response.availability).toEqual({ routines: 'empty', chapters: 'empty', games: 'empty' })
    expect(response.answers.suitable).toContain('当前没有安全可用的功法候选')
    expect(response.answers.first_game).toContain('当前没有通过风险筛选的游戏')
    expect(response.answers.recent_issues).toContain('证据不足')
    expect(response.error).toBeNull()
  })

  it('does not fill an empty result with pending or conservatively excluded candidates', () => {
    testCatalogue.entries = [
      { ...entry('game'), verification: 'pending' },
      { ...entry('chapter'), caution: ['overhead'] },
      entry('routine'),
    ]
    const response = getCoachWebRecommendation({
      schemaVersion: 1, source: 'rules', profile: { ...profile(), difficulties: ['soreness'] },
    })
    expect(response.status).toBe('empty')
    if (response.status === 'error') throw new Error('Expected a valid empty response')
    expect([...response.result.routines, ...response.result.chapters, ...response.result.games]).toEqual([])
    expect(response.availability).toEqual({ routines: 'empty', chapters: 'empty', games: 'empty' })
  })

  it('returns ready with explicit empty routine and chapter categories when only a game is available', () => {
    testCatalogue.entries = [entry('game')]
    const response = getCoachWebRecommendation({ schemaVersion: 1, source: 'rules', profile: profile() })
    expect(response.status).toBe('ready')
    if (response.status === 'error') throw new Error('Expected recommendations')
    expect(response.availability).toEqual({ routines: 'empty', chapters: 'empty', games: 'available' })
    expect(response.result.games.map(item => item.entry.id)).toEqual(['test-only:game'])
    expect(response.answers.suitable).toContain('当前没有安全可用的功法候选')
    expect(response.answers.first_game).toContain('合成测试目录 game')
    expect(response.result.games[0].entry.href).toBeNull()
  })

  it('returns ready with an empty game category when a programme and chapter are available', () => {
    testCatalogue.entries = [entry('routine'), entry('chapter')]
    const response = getCoachWebRecommendation({ schemaVersion: 1, source: 'rules', profile: profile() })
    expect(response.status).toBe('ready')
    if (response.status === 'error') throw new Error('Expected recommendations')
    expect(response.availability).toEqual({ routines: 'available', chapters: 'available', games: 'empty' })
    expect(response.result.routines[0].entry.href).toBeNull()
    expect(response.result.chapters[0].entry.href).toBe('/routines/baduanjin/train?form=bdj-1')
    expect(response.answers.first_game).toContain('当前没有通过风险筛选的游戏')
    expect(response.answers.why).toContain('fixture:web-empty-contract')
  })

  it.each(['acute_pain', 'dizziness', 'recent_injury'] as const)(
    'keeps %s a safety hold rather than treating it as an empty catalogue', risk => {
      const response = getCoachWebRecommendation({
        schemaVersion: 1, source: 'synthetic', profile: { ...profile(), risk },
      })
      expect(response.status).toBe('safety_hold')
      if (response.status === 'error') throw new Error('Expected a safety response')
      expect(response.result.status).toBe('safety_hold')
      expect(response.result.evidence).toEqual([])
      expect(Object.values(response.answers).every(answer => answer === response.result.message)).toBe(true)
    },
  )

  it('keeps an incomplete profile distinct from a valid profile with an empty catalogue', () => {
    const response = getCoachWebRecommendation({ schemaVersion: 1, source: 'rules', profile: null })
    expect(response.status).toBe('profile_required')
    if (response.status === 'error') throw new Error('Expected a profile validation response')
    expect(response.result.status).toBe('profile_required')
    expect(response.answers.suitable).toContain('请完整填写')
    expect(response.evidenceStatus).toBe('missing')
  })
})
