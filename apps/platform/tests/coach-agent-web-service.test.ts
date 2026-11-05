import { describe, expect, it, vi } from 'vitest'
import { COACH_KNOWLEDGE } from '../src/features/coachAgent/recommendation/catalogue'
import { getCoachWebRecommendation } from '../src/features/coachAgent/recommendation/webService'
import type { CoachWebDataResponse, CoachWebResponse } from '../src/features/coachAgent/recommendation/webContracts'
import type { CoachProfile } from '../src/features/coachAgent/recommendation/types'

// All inputs are self-reported test profiles or the module's explicitly synthetic fixture.
const profile = (): CoachProfile => ({
  version: 1, goals: ['upper_limb'], difficulties: ['none'], regions: ['shoulders', 'arms'],
  preference: 'mixed', risk: 'none', acknowledged: true,
})
const request = (source: 'rules' | 'synthetic' = 'rules', value: unknown = profile()) => ({ schemaVersion: 1, source, profile: value })
function data(response: CoachWebResponse): CoachWebDataResponse {
  expect(response.status).not.toBe('error')
  if (response.status === 'error') throw new Error(response.error.code)
  return response
}

describe('offline Web recommendation data flow', () => {
  it('serves a cold-start profile with three candidate classes and explicit missing report evidence', () => {
    const response = data(getCoachWebRecommendation(request()))
    expect(response.status).toBe('ready')
    expect(response.availability).toEqual({ routines: 'available', chapters: 'available', games: 'available' })
    expect(response.evidenceStatus).toBe('missing')
    expect(response.reportStatus).toBe('missing')
    expect(response.result.evidence).toEqual([])
    expect(response.answers.recent_issues).toContain('证据不足')
    expect(response.result.limitations.join(' ')).toContain('未读取')
    expect(response.source).toMatchObject({ mode: 'rules', synthetic: false, historyStatus: 'not_connected', decisionStatus: 'not_connected', recommendationMode: 'profile_rules' })
    const candidates = [...response.result.routines, ...response.result.chapters, ...response.result.games]
    expect(candidates.every(item => item.basis === 'profile_rules' && item.evidenceIds.length === 0)).toBe(true)
    expect(response.result.routines.every(item => item.entry.href === null)).toBe(true)
    expect(response.result.games.every(item => item.entry.href === null)).toBe(true)
    expect(response.result.chapters.every(item => item.entry.href?.includes('?form='))).toBe(true)
    expect(response.answers.first_game).toContain('未配置启动地址')
  })

  it('exposes the five fixed answers with sources and evidence references that resolve within the returned snapshot', () => {
    const response = data(getCoachWebRecommendation(request('synthetic')))
    expect(Object.keys(response.answers).sort()).toEqual(['first_game', 'next_focus', 'recent_issues', 'suitable', 'why'])
    for (const answer of Object.values(response.answers)) expect(answer.length).toBeGreaterThan(20)
    const evidenceIds = new Set(response.result.evidence.map(item => item.id))
    expect(evidenceIds.size).toBeGreaterThan(0)
    const catalogueIds = new Set(COACH_KNOWLEDGE.map(item => item.id))
    for (const recommendation of [...response.result.routines, ...response.result.chapters, ...response.result.games]) {
      expect(catalogueIds.has(recommendation.entry.id)).toBe(true)
      expect(recommendation.entry.sources.length).toBeGreaterThan(0)
      expect(recommendation.reasons.length).toBeGreaterThan(0)
      expect(recommendation.evidenceIds.every(id => evidenceIds.has(id))).toBe(true)
    }
    expect(response.answers.why).toContain(response.result.chapters[0].entry.sources[0])
    for (const evidence of response.result.evidence) {
      expect(evidence.references.length).toBeGreaterThan(0)
      expect(evidence.references.every(reference => reference.startsWith('fixture:'))).toBe(true)
    }
  })

  it('labels all demo evidence as synthetic and keeps actual history/model connections absent', () => {
    const response = data(getCoachWebRecommendation(request('synthetic')))
    expect(response.source.synthetic).toBe(true)
    expect(response.source.label).toContain('合成演示')
    expect(response.source.label).toContain('不代表')
    expect(response.source.decisionStatus).toBe('not_connected')
    expect(response.source.historyStatus).toBe('not_connected')
    expect(response.evidenceStatus).toBe('synthetic')
    expect(response.reportStatus).toBe('synthetic')
    expect(response.result.evidence.every(item => item.source === 'synthetic' && item.id.startsWith('synthetic:'))).toBe(true)
    expect(response.answers.recent_issues).toContain('合成报告样例（不代表你的表现）')
    expect(response.result.limitations.join(' ')).toContain('StartLux 决策模型尚未接入')
    expect(response.result.limitations.join(' ')).toContain('未读取任何真实')
  })

  it('drops every demo fact when switching to profile rules and regenerates answers for the new profile', () => {
    const demo = data(getCoachWebRecommendation(request('synthetic')))
    const daily = { ...profile(), goals: ['daily'] as CoachProfile['goals'] }
    const rules = data(getCoachWebRecommendation(request('rules', daily)))
    expect(demo.reportStatus).toBe('synthetic')
    expect(rules.result.evidence).toEqual([])
    expect(rules.reportStatus).toBe('missing')
    expect(rules.answers.recent_issues).toContain('证据不足')
    expect(rules.answers.recent_issues).not.toContain('合成报告样例')
    expect(rules.result.chapters[0].entry.id).not.toBe(demo.result.chapters[0].entry.id)
    expect(rules.result.chapters[0].reasons.join(' ')).toContain('日常锻炼')
    expect(demo.result.evidence.length).toBeGreaterThan(0)
  })

  it.each(['acute_pain', 'dizziness', 'recent_injury'] as const)('enforces %s over demo suggestions and clears all evidence and candidates', risk => {
    getCoachWebRecommendation(request('synthetic'))
    const response = data(getCoachWebRecommendation(request('synthetic', { ...profile(), risk })))
    expect(response.status).toBe('safety_hold')
    expect(response.result.status).toBe('safety_hold')
    expect([...response.result.routines, ...response.result.chapters, ...response.result.games, ...response.result.evidence]).toEqual([])
    expect(response.availability).toEqual({ routines: 'empty', chapters: 'empty', games: 'empty' })
    expect(response.reportStatus).toBe('missing')
    expect(response.evidenceStatus).toBe('missing')
    expect(Object.values(response.answers).every(answer => answer === response.result.message)).toBe(true)
    expect(response.answers.suitable).toContain('专业人员')
  })

  it.each(['soreness', 'reach_difficulty'] as const)('retains conservative filtering for self-reported %s', difficulty => {
    const response = data(getCoachWebRecommendation(request('synthetic', { ...profile(), difficulties: [difficulty] })))
    expect(response.status).toBe('ready')
    expect(response.result.chapters.length).toBeGreaterThan(0)
    expect(response.result.games.length).toBeGreaterThan(0)
    expect([...response.result.chapters, ...response.result.games].every(item => item.entry.caution.length === 0)).toBe(true)
    expect(response.result.limitations.join(' ')).toContain('保守规则')
  })

  it('keeps rehab-support intent conservative and explicitly requires professional confirmation', () => {
    const response = data(getCoachWebRecommendation(request('rules', { ...profile(), goals: ['rehab_support'] })))
    expect(response.status).toBe('ready')
    expect([...response.result.chapters, ...response.result.games].every(item => item.entry.caution.length === 0)).toBe(true)
    expect(response.result.limitations.join(' ')).toContain('请先由医生或康复专业人员确认')
  })
})

describe('Web request trust boundary', () => {
  it.each([
    ['null', null], ['array', []], ['string', 'rules'], ['missing profile', { schemaVersion: 1, source: 'rules' }],
    ['wrong version', { ...request(), schemaVersion: 2 }], ['implicit source', { schemaVersion: 1, profile: profile() }],
    ['live source', { ...request(), source: 'live' }], ['local source', { ...request(), source: 'local' }],
    ['unknown source', { ...request(), source: 'other' }], ['question text', { ...request(), question: '自由问题' }],
    ['model output', { ...request(), decisionStatus: 'startlux' }], ['account claim', { ...request(), principalId: 'claimed-user' }],
    ['storage handle', { ...request(), storage: { getItem: () => null } }], ['caller result', { ...request(), result: { status: 'ready' } }],
  ])('rejects %s with no old result or answers', (_label, value) => {
    getCoachWebRecommendation(request('synthetic'))
    const response = getCoachWebRecommendation(value)
    expect(response).toMatchObject({ schemaVersion: 1, status: 'error', source: null, result: null, answers: null, error: { code: 'INVALID_REQUEST' } })
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
  })

  it.each(['evidence', 'context', 'history', 'authorization'] as const)('rejects caller-controlled %s rather than promoting it to a trusted fact', field => {
    const forged = { evidence: [{ id: 'claimed-live', source: 'live', category: 'report', title: 'invented finding', detail: 'not observed', references: ['claimed:record'], focuses: ['reach'], occurredAt: 1 }] }
    const response = getCoachWebRecommendation({ ...request(), [field]: forged })
    expect(response.status).toBe('error')
    expect(response.result).toBeNull()
    expect(response.answers).toBeNull()
  })

  it('requires schemaVersion and source to be own request fields', () => {
    const inherited = Object.assign(Object.create({ schemaVersion: 1, source: 'rules' }), { profile: profile(), evidence: [], context: {} })
    expect(getCoachWebRecommendation(inherited).status).toBe('error')
  })

  it.each([
    ['absent', undefined], ['null', null], ['array', []], ['empty', {}],
    ['unacknowledged', { ...profile(), acknowledged: false }], ['version', { ...profile(), version: 2 }],
    ['no goals', { ...profile(), goals: [] }], ['duplicate goals', { ...profile(), goals: ['daily', 'daily'] }],
    ['conflicting none', { ...profile(), difficulties: ['none', 'soreness'] }],
    ['unknown region', { ...profile(), regions: ['unknown'] }], ['unknown risk', { ...profile(), risk: 'unknown' }],
    ['unknown preference', { ...profile(), preference: 'unknown' }],
  ])('returns profile_required for %s profile without throwing or reusing demo facts', (_label, value) => {
    getCoachWebRecommendation(request('synthetic'))
    const response = data(getCoachWebRecommendation({ schemaVersion: 1, source: 'synthetic', profile: value }))
    expect(response.status).toBe('profile_required')
    expect(response.result.evidence).toEqual([])
    expect([...response.result.routines, ...response.result.chapters, ...response.result.games]).toEqual([])
    expect(Object.values(response.answers).every(answer => answer === response.result.message)).toBe(true)
  })
})

describe('Web snapshot isolation and offline execution', () => {
  it.each(['rules', 'synthetic'] as const)('roundtrips %s output through JSON without losing fields', source => {
    const response = getCoachWebRecommendation(request(source))
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
  })

  it('isolates returned nested entries, sources, evidence and answers from the catalogue and later callers', () => {
    const catalogueBefore = structuredClone(COACH_KNOWLEDGE)
    const baseline = data(getCoachWebRecommendation(request('synthetic')))
    const changed = data(getCoachWebRecommendation(request('synthetic')))
    for (const item of [...changed.result.routines, ...changed.result.chapters, ...changed.result.games]) {
      item.entry.title = 'caller modification'
      item.entry.sources.splice(0)
      item.entry.regions.splice(0)
      item.entry.focuses.splice(0)
      item.entry.caution.push('overhead')
      item.entry.href = '/caller-injected'
      item.reasons.splice(0)
      item.evidenceIds.splice(0)
    }
    changed.result.evidence[0].references.splice(0)
    changed.result.evidence[0].detail = 'caller modification'
    changed.result.focus.splice(0)
    changed.answers.why = 'caller modification'
    expect(COACH_KNOWLEDGE).toEqual(catalogueBefore)
    expect(getCoachWebRecommendation(request('synthetic'))).toEqual(baseline)
  })

  it('accepts frozen input without mutating or retaining the self-reported profile', () => {
    const input = { schemaVersion: 1, source: 'rules', profile: profile() }
    Object.freeze(input.profile.goals)
    Object.freeze(input.profile.difficulties)
    Object.freeze(input.profile.regions)
    Object.freeze(input.profile)
    Object.freeze(input)
    const before = JSON.stringify(input)
    expect(getCoachWebRecommendation(input).status).toBe('ready')
    expect(JSON.stringify(input)).toBe(before)
  })

  it('does not access browser storage, network or model transports in either source mode', () => {
    const forbidden = vi.fn(() => { throw new Error('Unexpected external dependency') })
    const storage = { getItem: forbidden, setItem: forbidden, removeItem: forbidden }
    vi.stubGlobal('fetch', forbidden)
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)
    vi.stubGlobal('WebSocket', forbidden)
    vi.stubGlobal('XMLHttpRequest', forbidden)
    vi.stubGlobal('window', { get localStorage() { forbidden(); return storage } })
    try {
      for (const source of ['rules', 'synthetic'] as const) expect(getCoachWebRecommendation(request(source)).status).toBe('ready')
      expect(forbidden).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
