import { vi } from 'vitest'
import { createCoachSessionReader } from '../src/features/coachAgent/sessionReader'
import { createCoachToolDispatcher } from '../src/features/coachAgent/dispatcher'
import { SESSION_STORAGE_KEY } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { ROUTINE_SESSION_STORAGE_KEY } from '../src/features/routines/session/RoutineSessionRepository'
import { RoutineProgressRecorder } from '../src/features/routines/session/RoutineProgressRecorder'
import { FOLLOW_ALONG_CONFIG } from '../src/features/routines/followAlong/matcher'
import { findRoutineProgram } from '../src/features/routines/programs'
import type { RoutineSessionRecord } from '../src/features/routines/session/types'
import type { DispatcherTool } from '../src/features/coachAgent/dispatchTypes'
import { at, makeSession } from './analysis-fixtures'

/** Isolated synthetic records. They are never attached to the HTTP server or model. */
export function remoteDemoFixture(options: { tools?: DispatcherTool[]; warmupIds?: string[] } = {}) {
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
      tools: options.tools ?? ['read_session', 'read_history', 'read_scoring_evidence'],
      sessions: { warmup: options.warmupIds ?? warmup.map(session => session.id), routine: [routine.id] },
      maxHistory: 3 } })
  return { reader, dispatcher, raw, before, storage,
    warmupSessionId: warmup[1].id, routineSessionId: routine.id }
}
