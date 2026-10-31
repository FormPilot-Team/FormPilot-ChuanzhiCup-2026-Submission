import { describe, expect, it, vi } from 'vitest'
import { createCoachSessionReader } from '../src/features/coachAgent/sessionReader'
import { createCoachToolDispatcher } from '../src/features/coachAgent/dispatcher'
import { createCoachOrchestrator } from '../src/features/coachAgent/orchestrator'
import { createMockCoachProvider } from '../src/features/coachAgent/mockProvider'
import { SESSION_STORAGE_KEY } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { ROUTINE_SESSION_STORAGE_KEY } from '../src/features/routines/session/RoutineSessionRepository'
import { RoutineProgressRecorder } from '../src/features/routines/session/RoutineProgressRecorder'
import { FOLLOW_ALONG_CONFIG } from '../src/features/routines/followAlong/matcher'
import { findRoutineProgram } from '../src/features/routines/programs'
import type { RoutineSessionRecord } from '../src/features/routines/session/types'
import { at, makeSession } from './analysis-fixtures'

// Entirely synthetic, in-memory, explicitly tagged records. No camera, media,
// browser storage, networking or real user history is required by this entry.
function fixture() {
  const warmup = [
    makeSession({ id: 'synthetic-squat-before', source: 'synthetic', startedAt: at(1),
      exercises: { squat: { raw: () => ({ maxHipDrop: 0.1, maxTorsoLean: 30 }) } } }),
    makeSession({ id: 'synthetic-squat-current', source: 'synthetic', startedAt: at(2),
      exercises: { squat: { raw: () => ({ maxHipDrop: 0.15, maxTorsoLean: 25 }) } } }),
  ]
  const program = findRoutineProgram('baduanjin')!
  const chapter = program.chapters.find(item => item.kind === 'form')!
  const scope = { kind: 'form' as const, chapterId: chapter.id }
  const recorder = new RoutineProgressRecorder(program, scope)
  for (let second = Math.floor(chapter.startSeconds); second < chapter.endSeconds; second += 1) {
    recorder.markPlayback(second, second)
  }
  for (let sample = 0; sample < 20; sample += 1) recorder.recordComparison(chapter.startSeconds + 0.5, {
    status: 'in_sync', similarity: 0.8, timingOffsetMs: 0,
    matchedAt: chapter.startSeconds + 0.5, videoTime: chapter.startSeconds + 0.5,
    regionScores: { arms: 0.8, torso: 0.8, legs: 0.8 }, mirrored: false,
  })
  const routine: RoutineSessionRecord = {
    schemaVersion: 1, kind: 'routine', id: 'synthetic-baduanjin',
    programId: program.id, programVersion: program.version, scope,
    source: 'synthetic', mode: 'normal',
    matcher: { version: FOLLOW_ALONG_CONFIG.version, available: true },
    startedAt: at(3), endedAt: at(3) + 600_000, activeMs: 60_000,
    outcome: 'completed', chapters: recorder.snapshot(),
  }
  const raw = new Map([
    [SESSION_STORAGE_KEY, JSON.stringify(warmup)],
    [ROUTINE_SESSION_STORAGE_KEY, JSON.stringify([routine])],
  ])
  const before = [...raw.entries()]
  const storage = { getItem: vi.fn((key: string) => raw.get(key) ?? null),
    setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() }
  const reader = createCoachSessionReader({ storage, now: () => at(30) })
  const dispatcher = createCoachToolDispatcher({ reader, now: () => at(30), maxCalls: 4,
    authorization: { principalId: 'synthetic-demo-user',
      tools: ['read_session', 'read_history', 'read_scoring_evidence'],
      sessions: { warmup: warmup.map(session => session.id), routine: [routine.id] }, maxHistory: 3 } })
  const provider = createMockCoachProvider({ warmupSessionId: warmup[1].id, routineSessionId: routine.id, historyLimit: 3 })
  const agent = createCoachOrchestrator({ dispatcher, provider })
  return { agent, reader, dispatcher, raw, before, storage }
}

describe('Phase 1C standalone MOCK / synthetic demonstration', () => {
  it.each([
    '为什么我这次深蹲评分不高？',
    '我最近几次深蹲有没有进步？',
    '我最近的八段锦跟练表现如何？',
  ])('%s', async question => {
    const demo = fixture()
    const answer = await demo.agent.run(question)
    expect(answer.text).toMatch(/MOCK/u)
    expect(answer.text).toMatch(/synthetic|合成/u)
    // Log the actual answer and trace so this single-file command is also a demo.
    console.log(JSON.stringify({ label: 'MOCK / synthetic; no real LLM or human training', question,
      status: answer.status, text: answer.text, calls: answer.calls, citations: answer.citations }))
    expect(demo.dispatcher.remainingCalls()).toBeLessThan(4)
    expect([...demo.raw.entries()]).toEqual(demo.before)
    expect(demo.storage.setItem).not.toHaveBeenCalled()
    expect(demo.storage.removeItem).not.toHaveBeenCalled()
    expect(demo.storage.clear).not.toHaveBeenCalled()
    if (question.includes('进步')) {
      expect(answer.text).toMatch(/无法|不能|不足|不可/u)
      expect(answer.text).not.toMatch(/已经进步|确有进步|明显进步/u)
    } else if (question.includes('八段锦')) {
      expect(answer.text).toMatch(/相似度/u)
      expect(answer.text).toMatch(/0\.8|80/u)
    } else {
      expect(answer.text).toMatch(/warmup-standard|标准分/u)
      expect(answer.text).toMatch(/criterion|指标|评分项|幅度|深度/u)
    }
  })

  it('keeps both history fixtures synthetic and lets the unchanged native gate refuse progress', () => {
    const demo = fixture()
    const history = demo.reader.readHistory({ kind: 'warmup' })
    expect(history.ok && history.data.sessions.every(session => session.summary.provenance.source === 'synthetic')).toBe(true)
    const comparison = demo.reader.compareHistory({ kind: 'warmup', sessionId: 'synthetic-squat-current',
      subject: { kind: 'exercise', id: 'squat' }, limit: 3 })
    expect(comparison).toMatchObject({ ok: true, data: { gate: 'NONE', reason: 'CURRENT_PROVENANCE_NOT_VERIFIED_LIVE_NORMAL' } })
  })
})
