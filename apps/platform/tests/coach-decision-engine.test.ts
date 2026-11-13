import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COACH_KNOWLEDGE } from '../src/features/coachAgent/recommendation/catalogue'
import { getCoachWebRecommendation } from '../src/features/coachAgent/recommendation/webService'
import type { CoachProfile } from '../src/features/coachAgent/recommendation/types'
import type { RoutineSessionRecord } from '../src/features/routines/session/types'
import { ROUTINE_SESSION_STORAGE_KEY } from '../src/features/routines/session/RoutineSessionRepository'
import { BUNDLED_WEIGHTS, inferCdm, stateFromScenario, type CdmOutput } from '../src/features/coachAgent/decisionModel/cdm'
import { isLimitedProfile } from '../src/features/coachAgent/decisionModel/ranker'
import {
  COACH_DECISION_CONTRACT, createCoachDecisionEngine, describeCoachDecisionModel, FP_CDM_RELEASE, recommendCoachDecision, type CoachDecisionInput,
} from '../src/features/coachAgent/decisionModel/engine'
import { collectLocalDecisionInput, historyFromRoutineSessions } from '../src/features/coachAgent/decisionModel/engine/platform'
import { toShadowLogEntry } from '../src/features/coachAgent/decisionModel/engine/shadow'
import { checkShadowLogs } from '../scripts/decision-model/cdm/shadowCheck'
import { scenarioEvidence } from '../scripts/decision-model/cdm/evidence'
import type { SyntheticHistory, SyntheticReport } from '../scripts/decision-model/cdm/scenarioTypes'
import scenarioFile from '../scripts/decision-model/cdm/data/scenarios.v1.json'

const NOW = Date.UTC(2026, 10, 8, 12)
const DAY = 86_400_000
const profile = (o: Partial<CoachProfile> = {}): CoachProfile => ({ version: 1, goals: ['upper_limb'], difficulties: ['stiffness'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true, ...o })
const input = (o: Partial<CoachDecisionInput> = {}): CoachDecisionInput => ({ contract: COACH_DECISION_CONTRACT, profile: profile(), now: NOW, ...o })
const approved = { mode: 'active' as const, allowExperimentalModel: true }
const rulesOf = (p: unknown) => getCoachWebRecommendation({ schemaVersion: 1, source: 'rules', profile: p })
const byId = new Map(COACH_KNOWLEDGE.map(e => [e.id, e]))
const weights = () => { if (!BUNDLED_WEIGHTS.ok) throw new Error('bundled weights must load'); return structuredClone(BUNDLED_WEIGHTS.weights) }
const sha = (rel: string) => createHash('sha256').update(readFileSync(resolve(__dirname, '../../..', rel))).digest('hex')
const profiles: CoachProfile[] = [
  profile(), profile({ goals: ['mobility'], regions: ['neck', 'shoulders'], preference: 'routine' }), profile({ goals: ['daily'], difficulties: ['sedentary'], regions: ['legs', 'trunk'], preference: 'game' }),
  profile({ goals: ['rehab_support'], difficulties: ['soreness'], regions: ['shoulders'] }), profile({ goals: ['upper_limb', 'daily'], difficulties: ['reach_difficulty'], regions: ['arms'], preference: 'routine' }),
  profile({ goals: ['mobility', 'daily'], difficulties: ['none'], regions: ['trunk', 'legs', 'arms'] }),
]

describe('release binding', () => {
  it('bundled weights, M1 content table and catalogue match the frozen release manifest', () => {
    const card = describeCoachDecisionModel()
    expect(card.bundleStatus).toBe('ok')
    expect(card.defaultMode).toBe('off')
    expect(card.model).toMatchObject({ release: 'fp-cdm-release/1.0.0', id: 'fp-cdm-m2', version: '1.0.0', runtimeVersion: '1.2.0', tier: 'ai_experimental', binding: 'release_bound' })
    expect(card.model?.validation).toEqual({ offlineTechnical: 'passed', humanValidation: 'pending', productAcceptance: 'not_accepted' })
    expect(sha(FP_CDM_RELEASE.m2.weightsFile)).toBe(FP_CDM_RELEASE.m2.weightsSha256)
    expect(sha(FP_CDM_RELEASE.m1.contentTableFile)).toBe(FP_CDM_RELEASE.m1.contentTableSha256)
  })
  it('any change to the weights, the code version or the catalogue keeps the model from running', () => {
    const tampered = weights(); tampered.coef[0] += 1e-6
    expect(createCoachDecisionEngine({ weights: tampered }).recommend(input(), approved).fallbackReason).toBe('MODEL_VERSION_MISMATCH')
    expect(createCoachDecisionEngine({ weights: { ...weights(), version: '1.0.1' } }).recommend(input(), approved).fallbackReason).toBe('MODEL_VERSION_MISMATCH')
    expect(createCoachDecisionEngine({ weights: { ...weights(), featureSet: 'fp-cdm-features/v2' } }).recommend(input(), approved).fallbackReason).toBe('MODEL_VERSION_MISMATCH')
    const catalogue = COACH_KNOWLEDGE.map(e => (e.id === 'bdj-3' ? { ...e, regions: [...e.regions, 'legs' as const] } : e))
    expect(createCoachDecisionEngine({ catalogue }).recommend(input(), approved).fallbackReason).toBe('CATALOGUE_MISMATCH')
    expect(createCoachDecisionEngine({ weights: undefined }).recommend(input(), approved).fallbackReason).toBe('MODEL_MISSING')
    expect(createCoachDecisionEngine({ weights: { schemaVersion: 1, id: 'fp-cdm-m2', version: '1.0.0', status: 'AWAITING_LABELS' } }).recommend(input(), approved).fallbackReason).toBe('MODEL_NOT_TRAINED')
    for (const r of [createCoachDecisionEngine({ weights: tampered }).recommend(input(), approved), createCoachDecisionEngine({ catalogue }).recommend(input(), approved)]) {
      expect(r.decisionOrigin).toBe('rules'); expect(r.execution).toBe('not_run'); expect(r.display?.result).toEqual(rulesOf(profile()).result)
    }
  })
})

describe('modes', () => {
  it('OFF is the default and reproduces Agent Web P0 exactly (including risk and invalid profiles)', () => {
    for (const p of [...profiles, profile({ risk: 'dizziness' }), { version: 1, goals: [] }, null]) {
      const r = recommendCoachDecision(input({ profile: p as CoachProfile }))
      const rules = rulesOf(p)
      expect(r.mode).toBe('off'); expect(r.execution).toBe('disabled'); expect(r.fallbackReason).toBe('MODEL_DISABLED'); expect(r.ranking).toEqual([])
      expect(r.rules).toEqual(rules)
      expect(r.display).toEqual(rules.status === 'error' ? null : { result: rules.result, answers: rules.answers })
    }
  })
  it('SHADOW runs the trained model but always displays the rules result', () => {
    for (const p of profiles) {
      const r = recommendCoachDecision(input({ profile: p }), { mode: 'shadow' })
      expect(r.decisionOrigin).toBe('rules')
      expect(r.display?.result).toEqual(rulesOf(p).result)
      expect(r.execution).toBe('executed')
      expect(['SHADOW_MODE', 'MODEL_ABSTAINED']).toContain(r.fallbackReason)
      expect(r.ranking.length).toBeGreaterThan(0)
      expect(r.model?.tier).toBe('ai_experimental')
    }
  })
  it('ACTIVE refuses the experimental (AI-label) model unless the owner approves it explicitly', () => {
    const r = recommendCoachDecision(input(), { mode: 'active' })
    expect(r.fallbackReason).toBe('EXPERIMENTAL_MODEL_NOT_APPROVED'); expect(r.decisionOrigin).toBe('rules')
    expect(r.display?.result).toEqual(rulesOf(profile()).result)
    expect(r.ranking.length).toBeGreaterThan(0)
  })
  it('ACTIVE with approval displays the model slate, ordered by the trained model, inside the safety pool', () => {
    for (const p of profiles) {
      const r = recommendCoachDecision(input({ profile: p }), approved)
      if (r.fallbackReason === 'MODEL_ABSTAINED') { expect(r.display?.result).toEqual(rulesOf(p).result); continue }
      expect(r.fallbackReason).toBeNull(); expect(r.decisionOrigin).toBe('model'); expect(r.guard).toEqual({ checked: true, violations: [] })
      const shown = [...r.display!.result.chapters, ...r.display!.result.games].map(x => x.entry.id)
      expect(new Set(shown)).toEqual(new Set(r.ranking.filter(x => x.inSlate).map(x => x.id)))
      const chapterScores = r.display!.result.chapters.map(c => r.ranking.find(x => x.id === c.entry.id)!.score)
      expect(chapterScores).toEqual([...chapterScores].sort((a, b) => b - a))
      for (const id of shown) {
        const e = byId.get(id)!
        if (isLimitedProfile(p)) expect(e.caution).toEqual([])
        if (e.kind === 'chapter') expect(e.href).not.toBeNull()
      }
      expect(r.display!.result.limitations.join('')).toContain('AI 标注者')
      expect(r.ranking.every(x => x.explanation.every(e => e.label && e.label !== e.feature))).toBe(true)
    }
  })
  it('unknown mode strings fall back to OFF; responses are deterministic and isolated', () => {
    expect(recommendCoachDecision(input(), { mode: 'ACTIVE' as never }).mode).toBe('off')
    const a = recommendCoachDecision(input(), approved)
    a.ranking.length = 0; a.display!.result.chapters.length = 0
    expect(recommendCoachDecision(input(), approved)).toEqual(recommendCoachDecision(input(), approved))
    expect(recommendCoachDecision(input(), approved).ranking.length).toBeGreaterThan(0)
  })
})

describe('fault handling (every case falls back to rules without touching the guard)', () => {
  const expectRules = (r: ReturnType<typeof recommendCoachDecision>, reason: string) => {
    expect(r.fallbackReason).toBe(reason); expect(r.decisionOrigin).toBe('rules')
  }
  it('invalid envelope -> error response without display', () => {
    for (const bad of [null, 'x', [], { profile: profile() }, { contract: 'fp-coach-decision/v0', profile: profile() }, { contract: COACH_DECISION_CONTRACT, profile: profile(), fn: () => 1 }]) {
      const r = recommendCoachDecision(bad, approved)
      expect(r.status).toBe('error'); expect(r.display).toBeNull(); expect(r.error?.code).toBe('INVALID_REQUEST'); expect(r.decisionOrigin).toBe('rules')
    }
  })
  it('incomplete or wrong profile -> PROFILE_REQUIRED', () => {
    const r = recommendCoachDecision(input({ profile: { version: 1, goals: ['daily'] } as unknown as CoachProfile }), approved)
    expectRules(r, 'PROFILE_REQUIRED'); expect(r.status).toBe('profile_required')
    expectRules(recommendCoachDecision(input({ profile: profile({ acknowledged: false as never }) }), approved), 'PROFILE_REQUIRED')
  })
  it('invalid history / report / extra fields -> INPUT_INVALID with issue paths', () => {
    const cases: Array<[Partial<CoachDecisionInput> | Record<string, unknown>, string]> = [
      [{ trainingHistory: { origin: 'live_local_records', chapters: [{ chapterId: 'nope', sessions: 1 }] } }, '$.trainingHistory.chapters[0].chapterId'],
      [{ trainingHistory: { origin: 'live_local_records', chapters: [{ chapterId: 'bdj-1', sessions: 0 }] } }, '$.trainingHistory.chapters[0].sessions'],
      [{ trainingHistory: { origin: 'live_local_records', chapters: [{ chapterId: 'bdj-1', sessions: 2, completedSessions: 3 }] } }, '$.trainingHistory.chapters[0].completedSessions'],
      [{ trainingHistory: { origin: 'live_local_records', chapters: [{ chapterId: 'bdj-1', sessions: 1, lastPracticedAt: NOW + 5 * DAY }] } }, '$.trainingHistory.chapters[0].lastPracticedAt'],
      [{ trainingHistory: { origin: 'real', chapters: [] } as never }, '$.trainingHistory.origin'],
      [{ gameHistory: { origin: 'live_local_records', games: [{ gameId: 'bdj-1', plays: 1 }] } }, '$.gameHistory.games[0].gameId'],
      [{ latestReport: { origin: 'live_local_records', findings: [{ focus: 'general' as never, subjectId: 'bdj-1' }] } }, '$.latestReport.findings[0].focus'],
      [{ latestReport: { origin: 'live_local_records', findings: [{ focus: 'reach', subjectId: 'bdj-1', score: 140 }] } }, '$.latestReport.findings[0].score'],
      [{ userId: 'u1' } as never, '$.userId'],
      [{ now: -1 }, '$.now'],
    ]
    for (const [extra, path] of cases) {
      const r = recommendCoachDecision({ ...input(), ...extra }, approved)
      expectRules(r, 'INPUT_INVALID'); expect(r.inputIssues.map(i => i.path)).toContain(path); expect(r.display?.result).toEqual(rulesOf(profile()).result)
    }
  })
  it('sparse profile arrays (holes) -> INPUT_INVALID instead of an inference failure (found by the review fuzz)', () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = profile({ goals: ['upper_limb', , ] as unknown as CoachProfile['goals'] })
    for (const options of [approved, { mode: 'shadow' as const }]) {
      const r = recommendCoachDecision(input({ profile: sparse }), options)
      expectRules(r, 'INPUT_INVALID'); expect(r.inputIssues.map(i => i.path)).toContain('$.profile.goals[1]')
      expect(r.execution).toBe('not_run')
    }
  })
  it('risk users never reach the model in any mode', () => {
    for (const risk of ['acute_pain', 'dizziness', 'recent_injury'] as const) for (const mode of ['shadow', 'active'] as const) {
      const r = recommendCoachDecision(input({ profile: profile({ risk }) }), { mode, allowExperimentalModel: true })
      expectRules(r, 'SAFETY_HOLD'); expect(r.status).toBe('safety_hold'); expect(r.execution).toBe('not_run'); expect(r.ranking).toEqual([])
    }
  })
  it('unavailable content is never ranked or shown; unknown ids are rejected', () => {
    const r = recommendCoachDecision(input({ profile: profile({ preference: 'game' }), availability: { snapshotRef: 'demo', unavailableIds: ['archery', 'yijinjing'] } }), approved)
    expect(r.ranking.some(x => x.id === 'archery' || x.programId === 'yijinjing')).toBe(false)
    if (r.decisionOrigin === 'model') expect([...r.display!.result.chapters, ...r.display!.result.games].some(x => x.entry.id === 'archery' || x.entry.programId === 'yijinjing')).toBe(false)
    expectRules(recommendCoachDecision(input({ availability: { snapshotRef: 'demo', unavailableIds: ['nope'] } }), approved), 'INVALID_AVAILABILITY')
  })
  it('empty candidate set -> NO_CANDIDATES', () => {
    const all = COACH_KNOWLEDGE.filter(e => e.kind !== 'chapter').map(e => e.id)
    const r = recommendCoachDecision(input({ availability: { snapshotRef: 'none', unavailableIds: all } }), approved)
    expectRules(r, 'NO_CANDIDATES'); expect(r.ranking).toEqual([])
  })
  it('out-of-distribution input abstains and names the features', () => {
    // Found by scanning all 22,320 cold-start profiles: 197 abstain as OOD, all because the top candidate overlaps four
    // selected regions (x_region_overlap above the training range + 25%).
    const ood = profile({ goals: ['mobility'], difficulties: ['none'], regions: ['shoulders', 'neck', 'arms', 'legs'], preference: 'routine' })
    const r = recommendCoachDecision(input({ profile: ood }), approved)
    expectRules(r, 'MODEL_ABSTAINED'); expect(r.abstainReason).toBe('OUT_OF_DISTRIBUTION'); expect(r.outOfDistributionFeatures).toEqual(['x_region_overlap'])
    expect(r.display?.result).toEqual(rulesOf(ood).result)
  })
  it('low confidence abstains', () => {
    const r = createCoachDecisionEngine({ weights: { ...weights(), abstainSuitabilityBelow: 1.01 }, binding: 'unbound' }).recommend(input(), { mode: 'shadow' })
    expectRules(r, 'MODEL_ABSTAINED'); expect(r.abstainReason).toBe('LOW_SUITABILITY')
  })
  it('inference exceptions and guard rejections fall back; rejected rankings are not exposed', () => {
    const throwing = createCoachDecisionEngine({ infer: () => { throw new Error('boom') } }).recommend(input(), approved)
    expectRules(throwing, 'MODEL_ERROR'); expect(throwing.execution).toBe('failed'); expect(throwing.display?.result).toEqual(rulesOf(profile()).result)
    const limited = profile({ goals: ['rehab_support'], difficulties: ['soreness'] })
    const tamper = (...args: Parameters<typeof inferCdm>): CdmOutput => {
      const out = inferCdm(...args)
      out.candidates.unshift({ ...out.candidates[0], id: 'bdj-1', score: (out.candidates[0]?.score ?? 0) + 99 })
      return out
    }
    const rejected = createCoachDecisionEngine({ infer: tamper }).recommend(input({ profile: limited }), approved)
    expectRules(rejected, 'OUTPUT_GUARD_REJECTED'); expect(rejected.guard.violations.length).toBeGreaterThan(0); expect(rejected.ranking).toEqual([])
  })
  it('unbound research weights never become ACTIVE', () => {
    const r = createCoachDecisionEngine({ weights: weights(), binding: 'unbound' }).recommend(input(), approved)
    expectRules(r, 'UNBOUND_WEIGHTS'); expect(r.model?.binding).toBe('unbound_research_variant'); expect(r.ranking.length).toBeGreaterThan(0)
  })
})

describe('training / serving consistency', () => {
  it('the contract reproduces the training-time state and evidence for all 72 annotation scenarios', () => {
    if (!BUNDLED_WEIGHTS.ok) throw new Error('weights')
    const SCEN_NOW = Date.UTC(2026, 10, 7, 12)
    let compared = 0
    for (const s of (scenarioFile as { scenarios: Array<{ id: string; profile: CoachProfile; history: SyntheticHistory | null; report: SyntheticReport | null }> }).scenarios) {
      const req: CoachDecisionInput = {
        contract: COACH_DECISION_CONTRACT, profile: s.profile, now: SCEN_NOW,
        trainingHistory: s.history?.routines?.length ? { origin: 'synthetic_demo', chapters: s.history.routines.map(r => ({ chapterId: r.chapterId, sessions: r.sessions, completedSessions: r.completedSessions, meanScore: r.meanScore, trend: r.trend, lastPracticedAt: SCEN_NOW - r.lastDaysAgo * DAY })) } : null,
        gameHistory: s.history?.games?.length ? { origin: 'synthetic_demo', games: s.history.games.map(g => ({ gameId: g.gameId, plays: g.plays, completedPlays: g.completedPlays, lastPlayedAt: SCEN_NOW - g.lastDaysAgo * DAY })) } : null,
        latestReport: s.report ? { origin: 'synthetic_demo', createdAt: SCEN_NOW - s.report.daysAgo * DAY, findings: s.report.findings.map(f => ({ focus: f.focus, subjectId: f.subjectId, score: f.score, trend: f.trend })) } : null,
      }
      const viaContract = createCoachDecisionEngine({ binding: 'unbound' }).recommend(req, { mode: 'shadow' })
      expect(viaContract.inputIssues).toEqual([])
      const direct = inferCdm(BUNDLED_WEIGHTS.weights, stateFromScenario(s.profile, s.history, s.report), COACH_KNOWLEDGE, null, scenarioEvidence(s.history, s.report))
      expect(viaContract.ranking.map(x => [x.id, x.score])).toEqual(direct.candidates.map(c => [c.id, c.score]))
      compared += 1
    }
    expect(compared).toBe(72)
  }, 60_000)
})

describe('platform record mapping', () => {
  const chapter = (chapterId: string, covered: number, total: number, similarity: number, samples = 100) => ({ chapterId, totalSeconds: total, coveredSeconds: covered, samples, insufficientSamples: 0,
    similaritySum: similarity * samples, regionSums: { arms: 0, torso: 0, legs: 0 }, regionSamples: { arms: 0, torso: 0, legs: 0 }, statusCounts: { in_sync: 0, ahead: 0, behind: 0, mismatch: 0 }, mirroredSamples: 0 })
  const record = (id: string, startedAt: number, chapters: ReturnType<typeof chapter>[], o: Partial<RoutineSessionRecord> = {}): RoutineSessionRecord => ({
    schemaVersion: 1, kind: 'routine', id, programId: 'baduanjin', programVersion: '1', scope: { kind: 'full' }, source: 'live', mode: 'normal', matcher: { version: '1', available: true },
    startedAt, endedAt: startedAt + 600_000, activeMs: 600_000, outcome: 'completed', chapters, ...o })
  const records = [
    record('a', NOW - 9 * DAY, [chapter('bdj-1', 50, 60, 0.6), chapter('bdj-2', 20, 60, 0.5)]),
    record('b', NOW - 2 * DAY, [chapter('bdj-1', 60, 60, 0.72)]),
    record('c', NOW - 1 * DAY, [chapter('bdj-3', 60, 60, 0.9)], { source: 'synthetic' }),
    record('d', NOW - 1 * DAY, [chapter('bdj-4', 60, 60, 0.9)], { mode: 'fast' }),
    record('e', NOW - 1 * DAY, [chapter('bdj-5', 60, 60, 0.9)], { outcome: 'in_progress' }),
    record('f', NOW - 1 * DAY, [chapter('not-a-chapter', 60, 60, 0.9)]),
  ]
  it('aggregates live, normal-speed, finished sessions per catalogue chapter', () => {
    const h = historyFromRoutineSessions(records)!
    expect(h.origin).toBe('live_local_records')
    expect(h.chapters).toEqual([
      { chapterId: 'bdj-1', sessions: 2, completedSessions: 2, meanScore: 66, trend: 'up', lastPracticedAt: NOW - 2 * DAY + 600_000 },
      { chapterId: 'bdj-2', sessions: 1, completedSessions: 0, meanScore: 50, trend: null, lastPracticedAt: NOW - 9 * DAY + 600_000 },
    ])
    const r = recommendCoachDecision(input({ trainingHistory: h }), { mode: 'shadow' })
    expect(r.inputIssues).toEqual([]); expect(r.dataSources.trainingHistory).toBe('live_local_records')
  })
  it('collects local input only with consent and never writes storage', () => {
    const writes: string[] = []
    const storage = { getItem: (k: string) => (k === ROUTINE_SESSION_STORAGE_KEY ? JSON.stringify(records) : null), setItem: (k: string) => { writes.push(k) } }
    expect(collectLocalDecisionInput(profile(), { storage, now: NOW, consent: 'denied' })).toEqual({ contract: COACH_DECISION_CONTRACT, profile: profile(), now: NOW })
    const granted = collectLocalDecisionInput(profile(), { storage, now: NOW, consent: 'granted' })
    expect(granted.trainingHistory?.chapters.map(c => c.chapterId)).toEqual(['bdj-1', 'bdj-2'])
    expect(granted.gameHistory).toBeUndefined()
    expect(writes).toEqual([])
    expect(recommendCoachDecision(granted, { mode: 'shadow' }).inputIssues).toEqual([])
  })
})

describe('SHADOW acceptance log', () => {
  it('a log entry carries ids and outcomes only, and the checker passes clean SHADOW logs and fails a shown model ranking', () => {
    const full = input({ trainingHistory: { origin: 'live_local_records', chapters: [{ chapterId: 'bdj-1', sessions: 3, completedSessions: 3, meanScore: 70, trend: 'up', lastPracticedAt: NOW - 6 * DAY }] } })
    const entries = [input(), full, input({ profile: profile({ risk: 'dizziness' }) })].map(i => toShadowLogEntry(recommendCoachDecision(i, { mode: 'shadow' }), { at: NOW, elapsedMs: 1.5 }))
    const text = JSON.stringify(entries)
    for (const leaked of ['upper_limb', 'stiffness', 'shoulders', 'dizziness', 'meanScore', 'acknowledged']) expect(text).not.toContain(leaked)
    expect(entries[0].displayed).toEqual(entries[0].rules)
    expect(entries[0].modelSlate.chapters.length).toBeGreaterThan(0)
    expect(entries[2]).toMatchObject({ status: 'safety_hold', execution: 'not_run', displayed: { routines: [], chapters: [], games: [] } })
    const clean = checkShadowLogs([{ name: 'a', entries }])
    expect(Object.values(clean.hard).every(h => h.status === 'PASS')).toBe(true)
    expect(clean.verdict).toBe('INSUFFICIENT') // one device, three calls: coverage short, never PASS
    const shown = { ...entries[0], displayed: { ...entries[0].displayed, chapters: [...entries[0].modelSlate.chapters].reverse() } }
    expect(checkShadowLogs([{ name: 'b', entries: [shown] }]).hard.H3_display_is_rules.status).toBe('FAIL')
    const active = toShadowLogEntry(recommendCoachDecision(input(), approved), { at: NOW })
    const r = checkShadowLogs([{ name: 'c', entries: [active] }])
    expect([r.verdict, r.hard.H2_mode.status, r.hard.H3_display_is_rules.status, r.latency.status]).toEqual(['FAIL', 'FAIL', 'FAIL', 'NOT_MEASURED'])
  })
})
