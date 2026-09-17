import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStaleActiveSession, LocalStorageTrainingSessionRepository, parseStoredSessions } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { MemoryTrainingSessionRepository } from '../src/features/training/MemoryTrainingSessionRepository'
import { TrainingSession } from '../src/features/training/TrainingSession'
import type { TrainingSessionState } from '../src/features/training/types'

const validSession = (): TrainingSessionState => ({
  schemaVersion: 2,
  id: 'session-1',
  source: 'live',
  startedAt: 1,
  status: 'completed',
  exerciseOrder: ['lateral_raise', 'step_jack'],
  activeExerciseId: 'lateral_raise',
  exercises: [],
})

describe('session repository hardening', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('ignores invalid JSON payloads and schema mismatches', () => {
    expect(parseStoredSessions(null)).toEqual([])
    expect(parseStoredSessions('not-an-array')).toEqual([])
    expect(parseStoredSessions([{ schemaVersion: 1, id: 'old' }])).toEqual([])
    expect(parseStoredSessions([{ schemaVersion: 2 }])).toEqual([])
    expect(parseStoredSessions([validSession()])).toEqual([validSession()])
  })

  it('fills missing capture source on stored v2 sessions', () => {
    const legacy = { ...validSession() }
    delete (legacy as { source?: string }).source
    expect(parseStoredSessions([legacy])[0]?.source).toBe('live')
  })

  it('keeps domain sessions independent of localStorage', () => {
    const memory = new MemoryTrainingSessionRepository()
    const session = new TrainingSession(100, memory, undefined, 'demo')
    session.start()
    expect(session.snapshot().source).toBe('demo')
    expect(memory.list()).toHaveLength(1)
  })

  it('removes only zero-progress stale active sessions and preserves completed or intentional incomplete reports', () => {
    let raw: string | null = null
    vi.stubGlobal('localStorage', {
      getItem: () => raw,
      setItem: (_key: string, value: string) => { raw = value },
    })
    const repository = new LocalStorageTrainingSessionRepository()
    const complete = { ...validSession(), id: 'complete', courseStatus: 'completed' as const }
    const incomplete = { ...validSession(), id: 'incomplete', courseStatus: 'incomplete' as const }
    repository.save(complete)
    repository.save(incomplete)

    for (let index = 0; index < 25; index += 1) {
      repository.save({
        ...validSession(),
        id: `empty-active-${index}`,
        status: 'active',
        courseStatus: 'in_progress',
        activeExerciseId: 'lateral_raise',
        exercises: [{
          exerciseId: 'lateral_raise', startedAt: index, repetitions: [], metricAverages: {}, overallScore: 0,
          topErrors: [], feedbackEvents: [], evaluationMode: 'scored', targetType: 'reps', targetValue: 10,
        }],
      })
    }

    expect(repository.list().map((session) => session.id)).toEqual(['complete', 'incomplete', 'empty-active-24'])
    expect(repository.get('complete')).toBeDefined()
    expect(repository.get('incomplete')?.courseStatus).toBe('incomplete')
    expect(isStaleActiveSession(repository.get('empty-active-24')!)).toBe(true)
  })
})
