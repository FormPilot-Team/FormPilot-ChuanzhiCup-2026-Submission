import { describe, expect, it } from 'vitest'
import { COACH_KNOWLEDGE } from '../src/features/coachAgent/recommendation/catalogue'
import type { BodyRegion, CoachProfile, KnowledgeEntry } from '../src/features/coachAgent/recommendation/types'
import {
  BUNDLED_WEIGHTS, buildFeatures, FEATURE_GROUPS, FEATURE_NAMES, FEATURE_SET_VERSION, featureLabel,
  guardCdmOutput, inferCdm, loadWeights, stateFromScenario, type CdmWeights, type DecisionState,
} from '../src/features/coachAgent/decisionModel/cdm'
import { COACH_DECISION_CONTRACT, createCoachDecisionEngine } from '../src/features/coachAgent/decisionModel/engine'
import { isLimitedProfile } from '../src/features/coachAgent/decisionModel/ranker'

// Test fixture weights: deterministic pseudo-random coefficients. NOT a trained model.
function fixtureWeights(overrides: Partial<CdmWeights> = {}, bias: Partial<Record<string, number>> = {}, kind = 'human'): CdmWeights {
  let seed = 7
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
  return {
    schemaVersion: 1, id: 'fp-cdm-m2', version: '0.0.0-test', status: 'TRAINED', family: 'pairwise_lr', hyperparameter: 0.1, featureSet: FEATURE_SET_VERSION,
    featureNames: [...FEATURE_NAMES], mean: FEATURE_NAMES.map(() => 0), scale: FEATURE_NAMES.map(() => 1),
    coef: FEATURE_NAMES.map(name => bias[name] ?? r()), pairTemperature: 1, platt: { a: 1, b: 0 }, abstainSuitabilityBelow: 0,
    trainedOn: { matrixSha256: 'test', labels: { kind }, devFamilies: [] }, ...overrides,
  }
}
const profile = (o: Partial<CoachProfile> = {}): CoachProfile => ({ version: 1, goals: ['upper_limb'], difficulties: ['none'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true, ...o })
const input = (p: unknown = profile()) => ({ contract: COACH_DECISION_CONTRACT, profile: p, now: Date.UTC(2026, 10, 8) })
/** Research (unbound) engine: SHADOW exposes the ranking; ACTIVE is refused for unbound weights. */
const shadow = (w: CdmWeights, p: unknown = profile()) => createCoachDecisionEngine({ weights: w, binding: 'unbound' }).recommend(input(p), { mode: 'shadow' })
const byId = new Map(COACH_KNOWLEDGE.map(e => [e.id, e]))
const REGIONS: BodyRegion[] = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
const subsets = <T>(items: readonly T[]): T[][] => Array.from({ length: (1 << items.length) - 1 }, (_, m) => items.filter((_, b) => ((m + 1) >> b) & 1))
function* sampleProfiles(): Generator<CoachProfile> {
  let i = 0
  for (const goals of subsets(['mobility', 'upper_limb', 'daily', 'rehab_support'] as const)) for (const difficulties of [['none'] as CoachProfile['difficulties'], ...subsets(['stiffness', 'reach_difficulty', 'soreness', 'sedentary'] as const)])
    for (const regions of subsets(REGIONS)) for (const preference of ['routine', 'game', 'mixed'] as const) if (i++ % 23 === 0) yield profile({ goals: [...goals], difficulties: [...difficulties], regions: [...regions], preference })
}

describe('fp-cdm weight loading (label tiers)', () => {
  it('bundled weights are the frozen M2 v1.0 trained on AI labels, loaded as the experimental tier', () => {
    expect(BUNDLED_WEIGHTS.ok).toBe(true)
    if (!BUNDLED_WEIGHTS.ok) return
    expect(BUNDLED_WEIGHTS.tier).toBe('ai_experimental')
    expect(BUNDLED_WEIGHTS.weights.version).toBe('1.0.0')
    expect(BUNDLED_WEIGHTS.weights.trainedOn.labels.kind).toBe('ai_single_annotator')
    expect(BUNDLED_WEIGHTS.weights.featureRange?.min.length).toBe(BUNDLED_WEIGHTS.weights.featureNames.length)
  })
  it('names every refusal and never accepts pipeline controls or fixtures', () => {
    expect(loadWeights(undefined)).toEqual({ ok: false, reason: 'MODEL_MISSING' })
    expect(loadWeights(null)).toEqual({ ok: false, reason: 'MODEL_MISSING' })
    expect(loadWeights({ schemaVersion: 1, id: 'fp-cdm-m2', version: '1.0.0', status: 'AWAITING_LABELS' })).toEqual({ ok: false, reason: 'MODEL_NOT_TRAINED' })
    expect(loadWeights({ ...fixtureWeights(), id: 'other' })).toEqual({ ok: false, reason: 'WEIGHTS_INVALID' })
    expect(loadWeights([1, 2])).toEqual({ ok: false, reason: 'WEIGHTS_INVALID' })
    expect(loadWeights({ ...fixtureWeights(), featureSet: 'fp-cdm-features/v2' })).toEqual({ ok: false, reason: 'MODEL_VERSION_MISMATCH' })
    expect(loadWeights({ ...fixtureWeights(), schemaVersion: 2 })).toEqual({ ok: false, reason: 'MODEL_VERSION_MISMATCH' })
    expect(loadWeights({ ...fixtureWeights(), featureNames: [...FEATURE_NAMES.slice(1), 'no_such_feature'] })).toEqual({ ok: false, reason: 'MODEL_VERSION_MISMATCH' })
    expect(loadWeights({ ...fixtureWeights(), coef: [Number.NaN, ...fixtureWeights().coef.slice(1)] })).toEqual({ ok: false, reason: 'WEIGHTS_INVALID' })
    expect(loadWeights(fixtureWeights({ featureRange: { min: [Number.NaN], max: [1] } }))).toEqual({ ok: false, reason: 'WEIGHTS_INVALID' })
    for (const kind of ['test_fixture', 'planted_random_linear_signal', 'null_random_labels', 'rules', 'persona'])
      expect(loadWeights(fixtureWeights({}, {}, kind))).toEqual({ ok: false, reason: 'LABELS_NOT_ACCEPTED' })
    expect(loadWeights(fixtureWeights({}, {}, 'human'))).toMatchObject({ ok: true, tier: 'human' })
    expect(loadWeights(fixtureWeights({}, {}, 'ai_single_annotator'))).toMatchObject({ ok: true, tier: 'ai_experimental' })
  })
})

describe('fp-cdm feature builder', () => {
  it('has unique names, three groups and finite values for every safe candidate', () => {
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length)
    expect(new Set(Object.values(FEATURE_GROUPS))).toEqual(new Set(['P', 'H', 'R']))
    const nonP = FEATURE_NAMES.map((name, i) => [name, i] as const).filter(([name]) => FEATURE_GROUPS[name] !== 'P').map(([, i]) => i)
    let vectors = 0, wrongLength = 0, leakedHistory = 0
    for (const p of sampleProfiles()) {
      const state: DecisionState = { profile: p, history: { status: 'missing' }, report: { status: 'missing' } }
      for (const e of COACH_KNOWLEDGE.filter(x => x.kind !== 'routine')) {
        const x = buildFeatures(state, e, COACH_KNOWLEDGE) // throws on any non-finite value
        vectors += 1
        if (x.length !== FEATURE_NAMES.length) wrongLength += 1
        if (nonP.some(i => x[i] !== 0)) leakedHistory += 1
      }
    }
    expect({ wrongLength, leakedHistory }).toEqual({ wrongLength: 0, leakedHistory: 0 })
    expect(vectors).toBeGreaterThan(10_000)
  }, 60_000)
  it('history and report features react only to what the state contains', () => {
    const p = profile()
    const state = stateFromScenario(p, { sessionsLast28d: 3, routines: [{ chapterId: 'yjj-2', programId: 'yijinjing', sessions: 3, completedSessions: 3, lastDaysAgo: 2, meanScore: 80, trend: 'up' }], games: [] },
      { daysAgo: 2, findings: [{ focus: 'stability', subjectId: 'yjj-2', score: 60, trend: 'worse' }] })
    const x = buildFeatures(state, byId.get('yjj-2') as KnowledgeEntry, COACH_KNOWLEDGE)
    const at = (n: string) => x[FEATURE_NAMES.indexOf(n)]
    expect(at('h_practised_this_log')).toBeCloseTo(Math.log1p(3))
    expect(at('h_score_this')).toBeCloseTo(0.8)
    expect(at('r_same_subject')).toBe(1)
    expect(at('r_worse_focus_match')).toBe(1)
    const y = buildFeatures(state, byId.get('yjj-3') as KnowledgeEntry, COACH_KNOWLEDGE)
    expect(y[FEATURE_NAMES.indexOf('h_next_in_programme')]).toBe(1)
  })
  it('every feature has a readable label', () => {
    for (const name of FEATURE_NAMES) expect(featureLabel(name)).not.toBe(name)
  })
})

describe('fp-cdm inference and guard with fixture weights', () => {
  it('ranks safe candidates only, with calibrated scores, for a sample of the profile space', () => {
    const w = fixtureWeights()
    for (const p of sampleProfiles()) {
      const r = shadow(w, p)
      expect(r.execution).toBe('executed')
      expect(r.ranking.every(c => c.suitability >= 0 && c.suitability <= 1)).toBe(true)
      expect(r.confidence).toBeGreaterThanOrEqual(0.5)
      for (const item of r.ranking) {
        const e = byId.get(item.id)!
        if (isLimitedProfile(p)) expect(e.caution).toEqual([])
        if (e.kind === 'chapter') expect(e.href).not.toBeNull()
      }
    }
  }, 120_000)
  it('a model that maximally prefers risky content still cannot reach limited users (safe pool is independent)', () => {
    const adversarial = fixtureWeights({}, { c_caution_count: 50, c_caution_overhead: 50, c_caution_balance: 50 })
    const r = shadow(adversarial, profile({ goals: ['rehab_support'], difficulties: ['soreness'] }))
    expect(r.ranking.length).toBeGreaterThan(0)
    expect(r.ranking.every(x => (byId.get(x.id)?.caution.length ?? 1) === 0)).toBe(true)
  })
  it('range-based OOD: abstains only when the top candidate leaves the training range, and names the features', () => {
    const allZero = { min: FEATURE_NAMES.map(() => 0), max: FEATURE_NAMES.map(() => 0) }
    const ood = shadow(fixtureWeights({ featureRange: allZero }))
    expect(ood.abstainReason).toBe('OUT_OF_DISTRIBUTION')
    expect(ood.outOfDistributionFeatures.length).toBeGreaterThan(0)
    expect(ood.fallbackReason).toBe('MODEL_ABSTAINED')
    const wide = { min: FEATURE_NAMES.map(() => -5), max: FEATURE_NAMES.map(() => 5) }
    expect(shadow(fixtureWeights({ featureRange: wide }), profile({ regions: ['neck', 'shoulders'] })).fallbackReason).toBe('SHADOW_MODE')
  })
  it('guard rejects tampered outputs', () => {
    const p = profile({ goals: ['rehab_support'] })
    const state: DecisionState = { profile: p, history: { status: 'missing' }, report: { status: 'missing' } }
    const out = inferCdm(fixtureWeights(), state, COACH_KNOWLEDGE, null, [])
    const risky = structuredClone(out); risky.candidates.unshift({ ...risky.candidates[0], id: 'bdj-1', score: 999 })
    expect(guardCdmOutput(risky, p, COACH_KNOWLEDGE, null).some(v => v.startsWith('CAUTION_FOR_LIMITED'))).toBe(true)
    const claimed = structuredClone(out); (claimed.model as { trainedWeights: boolean }).trainedWeights = false
    expect(guardCdmOutput(claimed, p, COACH_KNOWLEDGE, null)).toContain('MODEL_IDENTITY')
    const altered = structuredClone(out); altered.result!.chapters[0].entry = { ...altered.result!.chapters[0].entry, regions: ['neck'] }
    expect(guardCdmOutput(altered, p, COACH_KNOWLEDGE, null).some(v => v.startsWith('ENTRY_ALTERED'))).toBe(true)
  })
  it('reasons are readable sentences, and the label tier is stated honestly', () => {
    const p = profile()
    const state: DecisionState = { profile: p, history: { status: 'missing' }, report: { status: 'missing' } }
    const ai = inferCdm(fixtureWeights({}, {}, 'ai_single_annotator'), state, COACH_KNOWLEDGE, null, [])
    expect(ai.result?.limitations.join('')).toContain('AI 标注者')
    expect(ai.result?.limitations.join('')).not.toContain('两名独立人工')
    for (const c of ai.candidates) for (const reason of c.reasons) expect(reason).not.toMatch(/[a-z]_[a-z]/)
    const human = inferCdm(fixtureWeights(), state, COACH_KNOWLEDGE, null, [])
    expect(human.result?.limitations.join('')).toContain('两名独立人工')
  })
})
