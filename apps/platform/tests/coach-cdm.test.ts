import { describe, expect, it } from 'vitest'
import { COACH_KNOWLEDGE } from '../src/features/coachAgent/recommendation/catalogue'
import { getCoachWebRecommendation } from '../src/features/coachAgent/recommendation/webService'
import type { BodyRegion, CoachProfile, KnowledgeEntry } from '../src/features/coachAgent/recommendation/types'
import {
  BUNDLED_WEIGHTS, buildFeatures, createCdmService, FEATURE_GROUPS, FEATURE_NAMES, FEATURE_SET_VERSION, getCoachCdmRecommendation,
  guardCdmOutput, inferCdm, loadWeights, stateFromScenario, type CdmWeights, type DecisionState,
} from '../src/features/coachAgent/decisionModel/cdm'
import { isLimitedProfile } from '../src/features/coachAgent/decisionModel/ranker'

// Test fixture weights: deterministic pseudo-random coefficients. NOT a trained model; labels.kind marks it.
function fixtureWeights(overrides: Partial<CdmWeights> = {}, bias: Partial<Record<string, number>> = {}): CdmWeights {
  let seed = 7
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
  return {
    schemaVersion: 1, id: 'fp-cdm-m2', version: '0.0.0-test', status: 'TRAINED', family: 'pairwise_lr', hyperparameter: 0.1, featureSet: FEATURE_SET_VERSION,
    featureNames: [...FEATURE_NAMES], mean: FEATURE_NAMES.map(() => 0), scale: FEATURE_NAMES.map(() => 1),
    coef: FEATURE_NAMES.map(name => bias[name] ?? r()), pairTemperature: 1, platt: { a: 1, b: 0 }, abstainSuitabilityBelow: 0,
    trainedOn: { matrixSha256: 'test', labels: { kind: 'test_fixture' }, devFamilies: [] }, ...overrides,
  }
}
const profile = (o: Partial<CoachProfile> = {}): CoachProfile => ({ version: 1, goals: ['upper_limb'], difficulties: ['none'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true, ...o })
const request = (p: unknown = profile()) => ({ schemaVersion: 1, source: 'rules', profile: p })
const service = (w: CdmWeights) => createCdmService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, weights: { ok: true, weights: w }, now: () => Date.UTC(2026, 10, 8) })
const byId = new Map(COACH_KNOWLEDGE.map(e => [e.id, e]))
const REGIONS: BodyRegion[] = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
const subsets = <T>(items: readonly T[]): T[][] => Array.from({ length: (1 << items.length) - 1 }, (_, m) => items.filter((_, b) => ((m + 1) >> b) & 1))
function* sampleProfiles(): Generator<CoachProfile> {
  let i = 0
  for (const goals of subsets(['mobility', 'upper_limb', 'daily', 'rehab_support'] as const)) for (const difficulties of [['none'] as CoachProfile['difficulties'], ...subsets(['stiffness', 'reach_difficulty', 'soreness', 'sedentary'] as const)])
    for (const regions of subsets(REGIONS)) for (const preference of ['routine', 'game', 'mixed'] as const) if (i++ % 23 === 0) yield profile({ goals: [...goals], difficulties: [...difficulties], regions: [...regions], preference })
}

describe('fp-cdm bundled state and weight loading', () => {
  it('bundled weights are an explicit AWAITING_LABELS placeholder until human labels train the model', () => {
    expect(BUNDLED_WEIGHTS).toEqual({ ok: false, reason: 'MODEL_NOT_TRAINED' })
    const r = getCoachCdmRecommendation(request(), { mode: 'active' })
    expect(r.decisionOrigin).toBe('rules')
    expect(r.fallbackReason).toBe('MODEL_NOT_TRAINED')
    expect(r.active.result).toEqual(getCoachWebRecommendation(request()).result)
  })
  it('defaults to off', () => {
    const r = getCoachCdmRecommendation(request())
    expect(r.mode).toBe('off'); expect(r.modelExecution).toBe('disabled'); expect(r.fallbackReason).toBe('MODEL_DISABLED')
  })
  it('refuses fixture, planted or malformed weights; accepts only human-label artefacts of this feature set', () => {
    expect(loadWeights(fixtureWeights())).toEqual({ ok: false, reason: 'WEIGHTS_INVALID' })
    expect(loadWeights({ ...fixtureWeights(), trainedOn: { matrixSha256: 'x', labels: { kind: 'planted_random_linear_signal' }, devFamilies: [] } }).ok).toBe(false)
    // AI-label (single AI annotator) weights are an offline weak-supervision experiment, never a product model.
    expect(loadWeights({ ...fixtureWeights(), trainedOn: { matrixSha256: 'x', labels: { kind: 'ai_single_annotator' }, devFamilies: [] } }).ok).toBe(false)
    expect(loadWeights({ ...fixtureWeights(), featureSet: 'other' }).ok).toBe(false)
    expect(loadWeights({ ...fixtureWeights(), coef: [Number.NaN, ...fixtureWeights().coef.slice(1)] }).ok).toBe(false)
    const human = { ...fixtureWeights(), trainedOn: { matrixSha256: 'x', labels: { kind: 'human' }, devFamilies: [] } }
    expect(loadWeights(human).ok).toBe(true)
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
})

describe('fp-cdm adapter with fixture weights', () => {
  it('active mode ranks every safe candidate, returns calibrated scores and passes the independent guard', () => {
    const w = fixtureWeights()
    for (const p of sampleProfiles()) {
      const r = service(w)(request(p), { mode: 'active' })
      expect(r.decisionOrigin).toBe('model')
      const m = r.model!
      expect(m.model.trainedWeights).toBe(true)
      expect(m.candidates.every(c => c.suitability >= 0 && c.suitability <= 1)).toBe(true)
      expect(m.confidence).toBeGreaterThanOrEqual(0.5)
      for (const id of [...r.active.result!.chapters, ...r.active.result!.games].map(x => x.entry.id)) {
        const e = byId.get(id)!
        if (isLimitedProfile(p)) expect(e.caution).toEqual([])
        if (e.kind === 'chapter') expect(e.href).not.toBeNull()
      }
    }
  }, 120_000)
  it('a model that maximally prefers risky content still cannot show it to limited users (guard is independent)', () => {
    const adversarial = fixtureWeights({}, { c_caution_count: 50, c_caution_overhead: 50, c_caution_balance: 50 })
    const p = profile({ goals: ['rehab_support'], difficulties: ['soreness'] })
    const r = service(adversarial)(request(p), { mode: 'active' })
    expect([...r.active.result!.chapters, ...r.active.result!.games].every(x => x.entry.caution.length === 0)).toBe(true)
  })
  it('risk profiles never reach the model', () => {
    for (const risk of ['acute_pain', 'dizziness', 'recent_injury'] as const) {
      const r = service(fixtureWeights())(request(profile({ risk })), { mode: 'active' })
      expect(r.fallbackReason).toBe('SAFETY_HOLD'); expect(r.model).toBeNull(); expect(r.active.status).toBe('safety_hold')
    }
  })
  it('abstains on low suitability and on out-of-distribution input, falling back to rules', () => {
    const low = service(fixtureWeights({ abstainSuitabilityBelow: 1.01 }))(request(), { mode: 'active' })
    expect(low.fallbackReason).toBe('MODEL_ABSTAINED'); expect(low.model?.abstainReason).toBe('LOW_SUITABILITY'); expect(low.decisionOrigin).toBe('rules')
    const ood = service(fixtureWeights({ scale: FEATURE_NAMES.map(() => 1e-3) }))(request(), { mode: 'active' })
    expect(ood.model?.abstainReason).toBe('OUT_OF_DISTRIBUTION'); expect(ood.active.result).toEqual(getCoachWebRecommendation(request()).result)
  })
  it('range-based OOD (v1.1): abstains only when the top candidate leaves the training range, and names the features', () => {
    const allZero = { min: FEATURE_NAMES.map(() => 0), max: FEATURE_NAMES.map(() => 0) }
    const ood = service(fixtureWeights({ featureRange: allZero }))(request(), { mode: 'active' })
    expect(ood.model?.abstainReason).toBe('OUT_OF_DISTRIBUTION')
    expect(ood.model?.oodFeatures?.length).toBeGreaterThan(0)
    expect(ood.decisionOrigin).toBe('rules')
    // Rare-but-observed binary values (range 0..1) and bounded counts are in-distribution.
    const wide = { min: FEATURE_NAMES.map(() => -5), max: FEATURE_NAMES.map(() => 5) }
    const ok = service(fixtureWeights({ featureRange: wide }))(request(profile({ regions: ['neck', 'shoulders'] })), { mode: 'active' })
    expect(ok.decisionOrigin).toBe('model')
    expect(loadWeights({ ...fixtureWeights({ featureRange: { min: [Number.NaN], max: [1] } }), trainedOn: { matrixSha256: 'x', labels: { kind: 'human' }, devFamilies: [] } }).ok).toBe(false)
  })
  it('honours availability and rejects unknown ids or a mismatched host state', () => {
    const r = service(fixtureWeights())(request(profile({ preference: 'game' })), { mode: 'active', availability: { snapshotRef: 't', unavailableIds: ['archery', 'yijinjing'] } })
    expect(r.model!.candidates.some(c => c.id === 'archery' || c.programId === 'yijinjing')).toBe(false)
    expect(service(fixtureWeights())(request(), { mode: 'active', availability: { snapshotRef: 't', unavailableIds: ['nope'] } }).fallbackReason).toBe('INVALID_AVAILABILITY')
    const other: DecisionState = { profile: profile({ regions: ['legs'] }), history: { status: 'missing' }, report: { status: 'missing' } }
    expect(service(fixtureWeights())(request(), { mode: 'active', state: other }).fallbackReason).toBe('STATE_PROFILE_MISMATCH')
  })
  it('shadow mode keeps rules active; inference errors fall back', () => {
    const s = service(fixtureWeights())(request(), { mode: 'shadow' })
    expect(s.fallbackReason).toBe('SHADOW_MODE'); expect(s.model).not.toBeNull(); expect(s.active.result).toEqual(getCoachWebRecommendation(request()).result)
    const broken = service(fixtureWeights({ featureNames: ['no_such_feature'], mean: [0], scale: [1], coef: [1] }))(request(), { mode: 'active' })
    expect(['MODEL_ERROR', 'OUTPUT_GUARD_REJECTED', 'MODEL_ABSTAINED']).toContain(broken.fallbackReason)
    expect(broken.decisionOrigin).toBe('rules')
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
})
