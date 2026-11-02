import { describe, expect, it, vi } from 'vitest'
import { COACH_KNOWLEDGE } from '../src/features/coachAgent/recommendation/catalogue'
import { recommendCoach, answerCoachQuestion } from '../src/features/coachAgent/recommendation/engine'
import { readRecommendationContext } from '../src/features/coachAgent/recommendation/context'
import { createRecommendationDemo } from '../src/features/coachAgent/recommendation/fixtures'
import { adaptGuardedDecision, type GuardedDecisionDTO, type DecisionReadScope } from '../src/features/coachAgent/recommendation/decision'
import { createLabSyntheticFixture } from '../src/features/coachAgent/lab/fixtures'
import { SESSION_STORAGE_KEY } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { ROUTINE_SESSION_STORAGE_KEY } from '../src/features/routines/session/RoutineSessionRepository'
import { ROUTINE_PROGRAMS } from '../src/features/routines/programs'
import type { CoachEvidence, CoachProfile, RecommendationContext } from '../src/features/coachAgent/recommendation/types'
import { makeSession } from './analysis-fixtures'

const profile = (): CoachProfile => ({ version: 1, goals: ['mobility', 'upper_limb'], difficulties: ['stiffness'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true })
const empty = (): RecommendationContext => ({ evidence: [], limitations: [], decisionStatus: 'not_connected' })
function storedFixture(change: (records: Array<Record<string, unknown>>, key: string) => void = () => {}) {
  const fixture = createLabSyntheticFixture()
  const values = new Map<string, string>()
  for (const key of [SESSION_STORAGE_KEY, ROUTINE_SESSION_STORAGE_KEY]) {
    const records = JSON.parse(fixture.storage.getItem(key)!) as Array<Record<string, unknown>>
    change(records, key)
    values.set(key, JSON.stringify(records))
  }
  return { storage: { getItem: vi.fn((key: string) => values.get(key) ?? null) }, now: fixture.now() }
}

describe('competition recommendation catalogue and safe ranking', () => {
  it('resolves four programmes, every real chapter and four games without invented IDs', () => {
    expect(COACH_KNOWLEDGE.filter(item => item.kind === 'routine')).toHaveLength(4)
    expect(COACH_KNOWLEDGE.filter(item => item.kind === 'game')).toHaveLength(4)
    expect(new Set(COACH_KNOWLEDGE.map(item => item.id)).size).toBe(COACH_KNOWLEDGE.length)
    for (const program of ROUTINE_PROGRAMS) {
      const chapters = COACH_KNOWLEDGE.filter(item => item.kind === 'chapter' && item.programId === program.id)
      expect(chapters.map(item => item.chapterId).sort()).toEqual(program.chapters.map(item => item.id).sort())
      expect(chapters.every(item => item.sources.length && item.movement)).toBe(true)
    }
  })
  it('requires complete profile and rejects contradictory difficulty selection', () => {
    expect(recommendCoach({ ...profile(), acknowledged: false }, empty()).status).toBe('profile_required')
    expect(recommendCoach({ ...profile(), goals: [] }, empty()).status).toBe('profile_required')
    expect(recommendCoach({ ...profile(), difficulties: ['none', 'stiffness'] }, empty()).status).toBe('profile_required')
    expect(recommendCoach({ ...profile(), risk: 'unknown' as 'none' }, empty()).status).toBe('profile_required')
  })
  it.each(['acute_pain', 'dizziness', 'recent_injury'] as const)('halts recommendations for %s even when model fixtures suggest continuing', risk => {
    const result = recommendCoach({ ...profile(), risk }, createRecommendationDemo())
    expect(result.status).toBe('safety_hold')
    expect([...result.chapters, ...result.games, ...result.routines]).toEqual([])
    expect(answerCoachQuestion('suitable', result)).toContain('专业人员')
  })
  it('provides all three kinds, real form links, sources and profile reasons in a cold start', () => {
    const result = recommendCoach(profile(), empty())
    expect(result.status).toBe('ready')
    for (const list of [result.routines, result.chapters, result.games]) {
      expect(list.length).toBeGreaterThan(0)
      expect(list.every(item => item.basis === 'profile_rules' && item.entry.verification === 'project_verified' && item.reasons.some(reason => reason.includes('画像规则')))).toBe(true)
    }
    expect(result.chapters.every(item => item.entry.href?.includes('?form='))).toBe(true)
    expect(result.routines.every(item => item.entry.href === null && item.reasons.some(reason => reason.includes('不是整套训练处方')))).toBe(true)
    expect(answerCoachQuestion('recent_issues', result)).toContain('证据不足')
  })
  it('excludes every known load caution for limited reach or soreness and still offers three classes', () => {
    for (const difficulty of ['reach_difficulty', 'soreness'] as const) {
      const result = recommendCoach({ ...profile(), difficulties: [difficulty] }, empty())
      expect(result.chapters.length).toBeGreaterThan(0)
      expect(result.games.length).toBeGreaterThan(0)
      expect(result.routines.length).toBeGreaterThan(0)
      expect([...result.chapters, ...result.games].every(item => item.entry.caution.length === 0)).toBe(true)
    }
  })
  it('shows the programmes of the actual recommended chapters and explains those same chapters', () => {
    for (const context of [empty(), createRecommendationDemo()]) {
      const result = recommendCoach(profile(), context)
      const programmes = result.routines.map(item => item.entry.programId)
      expect([...new Set(result.chapters.map(item => item.entry.programId))]).toEqual(programmes)
      for (const routine of result.routines) {
        const chapters = result.chapters.filter(item => item.entry.programId === routine.entry.programId)
        expect(chapters.length).toBeGreaterThan(0)
        for (const chapter of chapters) expect(routine.reasons.join(' ')).toContain(chapter.entry.title)
      }
    }
  })
  it('does not label a decision suggestion as a saved training fact', () => {
    const evidence: CoachEvidence = { id: 'decision:guarded', category: 'decision', source: 'live', title: '本地规则建议', detail: '建议而非观察', focuses: ['coordination'], occurredAt: 1, references: ['policy:local'] }
    const result = recommendCoach(profile(), { ...empty(), decisionStatus: 'rules', evidence: [evidence] })
    expect([...result.routines, ...result.chapters, ...result.games].every(item => item.basis === 'profile_rules')).toBe(true)
  })
  it('does not let many lower priority records override profile or training priority', () => {
    const initial = recommendCoach(profile(), empty()).chapters[0].entry
    const target = COACH_KNOWLEDGE.find(item => item.kind === 'chapter' && item.href && item.id !== initial.id && item.focuses.includes('rhythm'))!
    const lower: CoachEvidence[] = Array.from({ length: 20 }, (_, index) => ({ id: `decision:${index}`, category: 'decision', source: 'synthetic', title: 'fixture', detail: 'fixture', focuses: [], contentId: target.id, occurredAt: index, references: ['fixture:test'] }))
    const trained: CoachEvidence = { ...lower[0], id: 'training:preferred', category: 'training', contentId: initial.id }
    const withEvidence = recommendCoach(profile(), { ...empty(), evidence: [...lower, trained] })
    expect(withEvidence.chapters[0].entry.id).toBe(initial.id)
  })
  it('answers all five question types and labels synthetic problems instead of inventing live facts', () => {
    const result = recommendCoach(profile(), createRecommendationDemo())
    for (const question of ['suitable', 'first_game', 'recent_issues', 'why', 'next_focus'] as const) expect(answerCoachQuestion(question, result).length).toBeGreaterThan(20)
    expect(answerCoachQuestion('recent_issues', result)).toContain('合成报告样例')
    expect(result.evidence.every(item => item.source === 'synthetic')).toBe(true)
    expect(result.limitations.some(text => text.includes('真人效果验证'))).toBe(true)
  })
  it('keeps report and decision coverage when training evidence exceeds the display bound', () => {
    const demo = createRecommendationDemo()
    const evidence = Array.from({ length: 40 }, (_, index) => ({ ...demo.evidence[0], id: `training:${index}`, occurredAt: index }))
    const result = recommendCoach(profile(), { ...demo, evidence: [...evidence, ...demo.evidence.slice(1)] })
    expect(result.evidence.filter(item => item.category === 'training')).toHaveLength(12)
    expect(result.evidence.some(item => item.category === 'report')).toBe(true)
    expect(result.evidence.some(item => item.category === 'decision')).toBe(true)
    expect(result.evidence.length).toBeLessThanOrEqual(21)
  })
  it('does not attach unrelated evidence to games when optional content IDs are absent', () => {
    const unrelated: CoachEvidence = { id: 'report:no-content-id', category: 'report', source: 'synthetic', title: 'fixture', detail: 'fixture', focuses: ['general'], occurredAt: 1, references: ['fixture:test'] }
    const result = recommendCoach(profile(), { ...empty(), evidence: [unrelated] })
    expect(result.games.every(item => item.evidenceIds.length === 0)).toBe(true)
  })
})

describe('consented local history projection', () => {
  it('reads only the two supported stores and never promotes synthetic records to real history', () => {
    const { storage, now } = storedFixture()
    const context = readRecommendationContext(storage, now)
    expect(new Set(storage.getItem.mock.calls.map(args => args[0]))).toEqual(new Set([SESSION_STORAGE_KEY, ROUTINE_SESSION_STORAGE_KEY]))
    expect(context.evidence).toEqual([])
    expect(context.decisionStatus).toBe('not_connected')
    expect(context.limitations.join(' ')).toContain('游戏历史未接入')
  })
  it('projects test records with live/normal metadata through the existing strict reader', () => {
    // Relabeling is confined to test memory to exercise the reader gate, not a claim about real captures.
    const { storage, now } = storedFixture(records => records.forEach(record => { record.source = 'live' }))
    const context = readRecommendationContext(storage, now)
    expect(context.evidence.some(item => item.category === 'training')).toBe(true)
    expect(context.evidence.every(item => item.source === 'live' && item.references.some(ref => ref.startsWith('evidence:')))).toBe(true)
    const result = recommendCoach(profile(), context)
    expect(result.evidence.every(item => !item.detail.includes('进步了'))).toBe(true)
    // The newest routine fixture has no technique findings: do not resurrect an older squat problem.
    expect(context.evidence.filter(item => item.category === 'report')).toEqual([])
    expect(answerCoachQuestion('recent_issues', result)).toContain('证据不足')
  })
  it('keeps corrupt storage distinct from empty storage and does not repair it', () => {
    const getItem = vi.fn(() => '{invalid')
    const context = readRecommendationContext({ getItem }, Date.now())
    expect(context.evidence).toEqual([])
    expect(context.limitations.join(' ')).toContain('CORRUPT')
  })
  it('does not present an older scored problem as recent when the latest record is guidance only', () => {
    const fixture = storedFixture(records => records.forEach(record => { record.source = 'live' }))
    const records = JSON.parse(fixture.storage.getItem(SESSION_STORAGE_KEY)!)
    const older = records[1]
    const latest = makeSession({ id: 'test-guidance-latest', source: 'live', startedAt: older.startedAt + 1_000_000, include: ['shoulder_rotation'], exerciseOrder: ['shoulder_rotation'] })
    const storage = { getItem: (key: string) => key === SESSION_STORAGE_KEY ? JSON.stringify([older, latest]) : null }
    const context = readRecommendationContext(storage, fixture.now)
    expect(context.evidence.some(item => item.category === 'training')).toBe(true)
    expect(context.evidence.filter(item => item.category === 'report')).toEqual([])
  })
  it('uses readable Chinese labels for saved warmup report findings', () => {
    const fixture = storedFixture(records => records.forEach(record => { record.source = 'live' }))
    const context = readRecommendationContext({ getItem: key => key === SESSION_STORAGE_KEY ? fixture.storage.getItem(key) : null }, fixture.now)
    const reports = context.evidence.filter(item => item.category === 'report')
    expect(reports.length).toBeGreaterThan(0)
    expect(reports.every(item => /[\u4e00-\u9fff]/.test(item.title))).toBe(true)
  })
  it('excludes unversioned and fast-mode records from fact claims', () => {
    const { storage, now } = storedFixture((records, key) => records.forEach(record => {
      record.source = 'live'
      if (key === SESSION_STORAGE_KEY) delete record.rulesVersion
      else record.mode = 'fast'
    }))
    expect(readRecommendationContext(storage, now).evidence).toEqual([])
  })
})

describe('guarded StartLux read boundary', () => {
  const scope = (): DecisionReadScope => ({ now: 100_000, lastAcceptedAt: null, inputRef: 'trusted-input-1', modelId: 'startlux-local', modelVersion: 'test-v1', expectedSource: 'startlux', input: {
    exerciseId: 'lateral_raise', phase: 'START', trainingState: 'ACTIVE', poseValid: true, poseReliability: .9, score: 70,
    errors: [{ code: 'ARM_TOO_LOW', severity: .3 }], consecutiveErrors: 4, feedbackResponse: 'not_corrected', elapsedSeconds: 200, completion: .5,
    history: { averageScore: 70, stableSeconds: 0, completedReps: 3 },
  } })
  const dto = (): GuardedDecisionDTO => ({ schemaVersion: 1, source: 'startlux', modelId: 'startlux-local', modelVersion: 'test-v1', inputRef: 'trusted-input-1', decisionRef: 'decision-1', createdAt: 99_000, guardedStrategy: 'SHOW_DECOMPOSITION', fallbackReason: 'none' })
  it('accepts only configured identity and bounded guarded suggestions, without claiming a diagnosis', () => {
    const result = adaptGuardedDecision(dto(), scope())
    expect(result.ok).toBe(true)
    if (result.ok) { expect(result.evidence.references).toContain('model:startlux-local@test-v1'); expect(result.evidence.detail).toContain('不是已检测的身体问题') }
  })
  it('rejects extra medical claims, wrong input/model identity, stale output and cooldown', () => {
    for (const candidate of [{ ...dto(), diagnosis: 'fake' }, { ...dto(), inputRef: 'other' }, { ...dto(), modelVersion: 'other' }, { ...dto(), createdAt: 1 }]) expect(adaptGuardedDecision(candidate, scope()).ok).toBe(false)
    expect(adaptGuardedDecision(dto(), { ...scope(), lastAcceptedAt: 95_000 })).toEqual({ ok: false, reason: 'COOLDOWN' })
    expect(adaptGuardedDecision({ ...dto(), source: 'synthetic' }, scope()).ok).toBe(false)
  })
  it('reapplies local guards when the upstream DTO falsely says a strategy was guarded', () => {
    expect(adaptGuardedDecision(dto(), { ...scope(), input: { ...scope().input, poseValid: false } })).toEqual({ ok: false, reason: 'SAFETY_GUARD_REJECTED' })
    expect(adaptGuardedDecision({ ...dto(), guardedStrategy: 'SUGGEST_PAUSE' }, scope()).ok).toBe(false)
    expect(adaptGuardedDecision({ ...dto(), fallbackReason: 'safety_guard' }, scope()).ok).toBe(false)
  })
})
