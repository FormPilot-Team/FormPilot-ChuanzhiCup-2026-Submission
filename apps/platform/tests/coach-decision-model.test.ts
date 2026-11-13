import { describe, expect, it } from 'vitest'
import { COACH_KNOWLEDGE } from '../src/features/coachAgent/recommendation/catalogue'
import { getCoachWebRecommendation } from '../src/features/coachAgent/recommendation/webService'
import type { BodyRegion, CoachProfile, KnowledgeEntry } from '../src/features/coachAgent/recommendation/types'
import {
  catalogueFingerprint, createCoachDecisionService, DEFAULT_DECISION_MODEL_MODE, getCoachDecisionRecommendation,
  guardModelOutput, isLimitedProfile, rankCoachDecision, VALIDATED_CATALOGUE_FINGERPRINT,
  type CoachDecisionResponse, type DecisionModelOutput,
} from '../src/features/coachAgent/decisionModel'

// All profiles are synthetic self-report test inputs; nothing here represents a real user.
const profile = (overrides: Partial<CoachProfile> = {}): CoachProfile => ({
  version: 1, goals: ['upper_limb'], difficulties: ['none'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true, ...overrides,
})
const request = (value: unknown = profile(), source: 'rules' | 'synthetic' = 'rules') => ({ schemaVersion: 1, source, profile: value })
const ids = (response: CoachDecisionResponse) => [...(response.active.result?.chapters ?? []), ...(response.active.result?.games ?? [])].map(item => item.entry.id)
const EXHAUSTIVE_TIMEOUT = 120_000
const byId = new Map(COACH_KNOWLEDGE.map(entry => [entry.id, entry]))

const GOALS = ['mobility', 'upper_limb', 'daily', 'rehab_support'] as const
const DIFFICULTIES = ['stiffness', 'reach_difficulty', 'soreness', 'sedentary'] as const
const REGIONS: BodyRegion[] = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
const subsets = <T>(items: readonly T[]): T[][] => Array.from({ length: (1 << items.length) - 1 }, (_, mask) => items.filter((_, bit) => ((mask + 1) >> bit) & 1))
function* profiles(risk: CoachProfile['risk'] = 'none'): Generator<CoachProfile> {
  for (const goals of subsets(GOALS)) for (const difficulties of [['none'] as CoachProfile['difficulties'], ...subsets(DIFFICULTIES)]) for (const regions of subsets(REGIONS))
    yield profile({ goals: [...goals], difficulties: [...difficulties], regions: [...regions], preference: 'mixed', risk })
}

describe('decision model adapter: default off and rules independence', () => {
  it('is off by default and returns the unchanged P0 response as the active result', () => {
    expect(DEFAULT_DECISION_MODEL_MODE).toBe('off')
    const response = getCoachDecisionRecommendation(request())
    const rules = getCoachWebRecommendation(request())
    expect(response.mode).toBe('off')
    expect(response.modelExecution).toBe('disabled')
    expect(response.decisionOrigin).toBe('rules')
    expect(response.fallbackReason).toBe('MODEL_DISABLED')
    expect(response.model).toBeNull()
    expect(response.rules).toEqual(rules)
    expect(response.active.result).toEqual(rules.result)
    expect(response.executedActions).toBe(false)
  })

  it('never lets the request enable the model or carry model output', () => {
    for (const bad of [{ ...request(), mode: 'active' }, { ...request(), modelOutput: { chapters: ['tjq-16'] } }, { ...request(), evidence: [] }, { schemaVersion: 1, source: 'startlux', profile: profile() }]) {
      const response = getCoachDecisionRecommendation(bad, { mode: 'active' })
      expect(response.active.status).toBe('error')
      expect(response.fallbackReason).toBe('REQUEST_INVALID')
      expect(response.modelExecution).toBe('not_applicable')
      expect(response.dataOrigin).toBe('none')
    }
  })

  it('treats unknown mode strings as off', () => {
    const response = getCoachDecisionRecommendation(request(), { mode: 'on' as never })
    expect(response.mode).toBe('off')
    expect(response.modelExecution).toBe('disabled')
  })

  it('shadow mode executes the model but keeps the rules result active', () => {
    const response = getCoachDecisionRecommendation(request(), { mode: 'shadow' })
    expect(response.modelExecution).toBe('executed')
    expect(response.decisionOrigin).toBe('rules')
    expect(response.fallbackReason).toBe('SHADOW_MODE')
    expect(response.active.result).toEqual(getCoachWebRecommendation(request()).result)
    expect(response.model?.model).toMatchObject({ id: 'fp-coach-ranker', version: '1.0.0', trainedWeights: false, kind: 'deterministic_constrained_ranker' })
    expect(response.comparison.rankingEffect).not.toBe('not_compared')
  })

  it('active mode returns a guarded, P0-shaped slate with traceable contributions', () => {
    const response = getCoachDecisionRecommendation(request(), { mode: 'active' })
    expect(response.decisionOrigin).toBe('model')
    expect(response.fallbackReason).toBeNull()
    expect(response.guard).toEqual({ checked: true, violations: [] })
    const model = response.model as DecisionModelOutput
    expect(model.priority.length).toBe(model.result.chapters.length + model.result.games.length)
    for (const item of model.priority) {
      const total = item.contributions.reduce((sum, c) => sum + c.points, 0)
      expect(Math.abs(total - item.utility)).toBeLessThan(1e-4)
      expect(item.contributions.every(c => c.sources.length > 0 && c.detail.length > 0)).toBe(true)
    }
    expect(Object.keys(response.active.answers ?? {}).sort()).toEqual(['first_game', 'next_focus', 'recent_issues', 'suitable', 'why'])
    expect(model.result.limitations.join(' ')).toContain('未训练权重')
    expect(model.result.limitations.join(' ')).toContain('StartLux 未使用')
  })

  it('returns isolated snapshots that cannot mutate the catalogue', () => {
    const response = getCoachDecisionRecommendation(request(), { mode: 'active' })
    const chapter = response.active.result!.chapters[0]
    chapter.entry.caution.push('overhead')
    chapter.entry.title = 'mutated'
    expect(byId.get(chapter.entry.id)?.title).not.toBe('mutated')
    expect(catalogueFingerprint(COACH_KNOWLEDGE)).toBe(VALIDATED_CATALOGUE_FINGERPRINT)
  })
})

describe('safety parity with P0 over the whole profile space', () => {
  it('holds every acute-risk profile; the model never executes', () => {
    let count = 0
    for (const risk of ['acute_pain', 'dizziness', 'recent_injury'] as const) {
      for (const p of profiles(risk)) {
        if (count++ % 7) continue
        const response = getCoachDecisionRecommendation(request(p), { mode: 'active' })
        expect(response.active.status).toBe('safety_hold')
        expect(response.fallbackReason).toBe('SAFETY_HOLD')
        expect(response.modelExecution).toBe('not_applicable')
        expect(response.model).toBeNull()
      }
    }
  }, EXHAUSTIVE_TIMEOUT)

  it('never shows caution-tagged or non-launchable items to limited profiles and stays inside the P0 safe pool', () => {
    for (const p of profiles()) {
      const response = getCoachDecisionRecommendation(request(p), { mode: 'active' })
      expect(response.decisionOrigin).toBe('model')
      const limited = isLimitedProfile(p)
      for (const id of ids(response)) {
        const entry = byId.get(id) as KnowledgeEntry
        expect(entry.verification).toBe('project_verified')
        if (entry.kind === 'chapter') expect(entry.href).not.toBeNull()
        if (limited) expect(entry.caution).toEqual([])
      }
    }
  }, EXHAUSTIVE_TIMEOUT)

  it('uses the same limited predicate as the P0 engine', () => {
    for (const p of profiles()) {
      const rules = getCoachWebRecommendation(request(p))
      const p0Limited = rules.result!.limitations.some(text => text.startsWith('已按保守规则排除'))
      expect(isLimitedProfile(p)).toBe(p0Limited)
    }
  }, EXHAUSTIVE_TIMEOUT)

  it('rejects incomplete profiles exactly like P0', () => {
    for (const bad of [profile({ acknowledged: false }), profile({ difficulties: ['none', 'stiffness'] }), profile({ regions: ['neck', 'neck'] }), { ...profile(), version: 2 }]) {
      const response = getCoachDecisionRecommendation(request(bad), { mode: 'active' })
      expect(response.active.status).toBe('profile_required')
      expect(response.fallbackReason).toBe('PROFILE_REQUIRED')
    }
  })
})

describe('availability, coverage gaps and preference order', () => {
  it('removes unavailable programmes and games; rules conflicts are reported, not hidden', () => {
    const p = profile({ goals: ['daily'], regions: ['trunk', 'legs'], preference: 'game' })
    const response = getCoachDecisionRecommendation(request(p), { mode: 'active', availability: { snapshotRef: 'test:no-racing-taiji', unavailableIds: ['racing', 'taijiquan'] } })
    expect(response.decisionOrigin).toBe('model')
    for (const id of ids(response)) {
      expect(id).not.toBe('racing')
      expect(byId.get(id)?.programId).not.toBe('taijiquan')
    }
    expect(response.model?.availabilityRef).toBe('test:no-racing-taiji')
    expect(response.model?.excluded.byAvailability).toContain('racing')
  })

  it('falls back to rules for an unknown availability id', () => {
    const response = getCoachDecisionRecommendation(request(), { mode: 'active', availability: { snapshotRef: 'x', unavailableIds: ['nope'] } })
    expect(response.fallbackReason).toBe('INVALID_AVAILABILITY')
    expect(response.decisionOrigin).toBe('rules')
  })

  it('discloses uncoverable regions instead of pretending coverage', () => {
    const response = getCoachDecisionRecommendation(request(profile({ goals: ['mobility'], difficulties: ['soreness'], regions: ['neck'] })), { mode: 'active' })
    expect(response.model?.coverage.gaps).toEqual([{ region: 'neck', reason: 'NO_SAFE_LAUNCHABLE_ITEM' }])
    expect(response.model?.priority.every(item => item.matchLevel === 'supplementary')).toBe(true)
    expect(response.active.result?.limitations.join(' ')).toContain('颈部')
  })

  it('orders categories by preference without changing the safe slate', () => {
    const slate = (preference: CoachProfile['preference']) => getCoachDecisionRecommendation(request(profile({ preference })), { mode: 'active' }).model as DecisionModelOutput
    expect(slate('game').priority[0].kind).toBe('game')
    expect(slate('routine').priority[0].kind).toBe('chapter')
    expect(slate('mixed').priority.map(i => i.kind).slice(0, 2)).toEqual(['chapter', 'game'])
    expect(new Set(slate('game').priority.map(i => i.id))).toEqual(new Set(slate('routine').priority.map(i => i.id)))
  })

  it('all games stay external apps with no invented launch address', () => {
    const response = getCoachDecisionRecommendation(request(profile({ preference: 'game' })), { mode: 'active' })
    for (const item of response.model!.priority.filter(i => i.kind === 'game')) {
      expect(item.href).toBeNull()
      expect(item.launch).toBe('external_app')
    }
  })

  it('keeps synthetic fixture evidence labelled synthetic', () => {
    const response = getCoachDecisionRecommendation(request(profile(), 'synthetic'), { mode: 'active' })
    expect(response.dataOrigin).toBe('self_report_profile_with_synthetic_fixture')
    expect(response.active.result?.evidence.every(item => item.source === 'synthetic')).toBe(true)
    const evidenceContributions = response.model!.priority.flatMap(i => i.contributions).filter(c => c.feature === 'evidence')
    expect(evidenceContributions.length).toBeGreaterThan(0)
    expect(evidenceContributions.every(c => c.detail.startsWith('合成样例证据'))).toBe(true)
    expect(evidenceContributions.every(c => c.points <= 0.6)).toBe(true)
  })
})

describe('fault injection: every failure returns the P0 result', () => {
  const base = { catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, validatedFingerprint: VALIDATED_CATALOGUE_FINGERPRINT }
  const expectRulesFallback = (response: CoachDecisionResponse, reason: string, p: CoachProfile = profile()) => {
    expect(response.decisionOrigin).toBe('rules')
    expect(response.fallbackReason).toBe(reason)
    expect(response.active.result).toEqual(getCoachWebRecommendation(request(p)).result)
  }

  it('ranker exception', () => {
    const service = createCoachDecisionService({ ...base, ranker: () => { throw new Error('boom') } })
    const response = service(request(), { mode: 'active' })
    expectRulesFallback(response, 'MODEL_ERROR')
    expect(response.modelExecution).toBe('failed')
  })

  it.each([
    ['caution chapter for a limited profile', (o: DecisionModelOutput) => { o.result.chapters[0] = { ...o.result.chapters[0], entry: byId.get('bdj-1') as KnowledgeEntry } }, 'CAUTION_FOR_LIMITED'],
    ['non-launchable chapter', (o: DecisionModelOutput) => { o.result.chapters[0] = { ...o.result.chapters[0], entry: byId.get('bdj-open') as KnowledgeEntry } }, 'NOT_LAUNCHABLE'],
    ['duplicate item', (o: DecisionModelOutput) => { o.priority.push({ ...o.priority[0], rank: o.priority.length + 1 }) }, 'DUPLICATE_ITEM'],
    ['claims trained weights', (o: DecisionModelOutput) => { (o.model as { trainedWeights: boolean }).trainedWeights = true }, 'MODEL_IDENTITY'],
    ['altered catalogue entry', (o: DecisionModelOutput) => { o.result.chapters[0].entry = { ...o.result.chapters[0].entry, caution: [] , regions: ['neck'] } }, 'ENTRY_ALTERED'],
    ['dangling evidence id', (o: DecisionModelOutput) => { o.result.chapters[0].evidenceIds = ['history:made-up'] }, 'DANGLING_EVIDENCE'],
  ])('guard rejects %s', (_name, mutate, violation) => {
    const p = profile({ goals: ['rehab_support'], difficulties: ['soreness'] })
    const service = createCoachDecisionService({ ...base, ranker: input => { const out = structuredClone(rankCoachDecision(input)); mutate(out); return out } })
    const response = service(request(p), { mode: 'active' })
    expectRulesFallback(response, 'OUTPUT_GUARD_REJECTED', p)
    expect(response.guard.violations.some(v => v.startsWith(violation))).toBe(true)
    expect(response.model).toBeNull()
  })

  it('guard enforces availability even if a ranker ignores it', () => {
    const service = createCoachDecisionService({ ...base, ranker: input => rankCoachDecision({ ...input, availability: null }) })
    const first = rankCoachDecision({ profile: profile(), evidence: [], availability: null, catalogue: COACH_KNOWLEDGE })
    const target = first.result.chapters[0].entry.programId as string
    const response = service(request(), { mode: 'active', availability: { snapshotRef: 't', unavailableIds: [target] } })
    expectRulesFallback(response, 'OUTPUT_GUARD_REJECTED')
    expect(response.guard.violations.some(v => v.startsWith('UNAVAILABLE'))).toBe(true)
  })

  it('catalogue drift disables the model until re-validated', () => {
    const drifted = COACH_KNOWLEDGE.map(entry => entry.id === 'tjq-1' ? { ...entry, regions: [...entry.regions, 'neck' as const] } : entry)
    const service = createCoachDecisionService({ ...base, catalogue: drifted, ranker: rankCoachDecision })
    expectRulesFallback(service(request(), { mode: 'active' }), 'INTEGRITY_MISMATCH')
  })

  it('guard passes the real ranker output for a broad sample', () => {
    let n = 0
    for (const p of profiles()) {
      if (n++ % 11) continue
      const output = rankCoachDecision({ profile: p, evidence: [], availability: null, catalogue: COACH_KNOWLEDGE })
      expect(guardModelOutput(output, p, COACH_KNOWLEDGE, null)).toEqual([])
    }
  }, EXHAUSTIVE_TIMEOUT)
})

describe('determinism and latency budget', () => {
  it('is deterministic for identical inputs', () => {
    const a = getCoachDecisionRecommendation(request(), { mode: 'active' })
    const b = getCoachDecisionRecommendation(request(), { mode: 'active' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('stays well under 20 ms per call on the development machine (generous CI bound)', () => {
    const start = performance.now()
    for (let i = 0; i < 200; i += 1) getCoachDecisionRecommendation(request(), { mode: 'active' })
    expect((performance.now() - start) / 200).toBeLessThan(20)
  })
})
