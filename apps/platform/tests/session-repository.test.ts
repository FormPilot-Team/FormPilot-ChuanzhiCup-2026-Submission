import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStaleActiveSession, LocalStorageTrainingSessionRepository, parseStoredSessions } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { MemoryTrainingSessionRepository } from '../src/features/training/MemoryTrainingSessionRepository'
import { TrainingSession } from '../src/features/training/TrainingSession'
import type { TrainingSessionState } from '../src/features/training/types'
import { resolveTrainingMode } from '../src/features/training/trainingMode'

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

  it('reads legacy v2 sessions without rulesVersion or mode and does not migrate them', () => {
    const [legacy] = parseStoredSessions([validSession()])
    expect(legacy).toBeDefined()
    expect(legacy).not.toHaveProperty('rulesVersion')
    expect(legacy).not.toHaveProperty('mode')
  })

  it('keeps fast mode available in development but disables it in production', () => {
    expect(resolveTrainingMode(true, true)).toBe('fast')
    expect(resolveTrainingMode(true, false)).toBe('normal')
    expect(resolveTrainingMode(false, true)).toBe('normal')
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

  it('round-trips rules, mode, comparability fields, TOP elbow evidence, and metric validity', () => {
    let raw: string | null = null
    vi.stubGlobal('localStorage', {
      getItem: () => raw,
      setItem: (_key: string, value: string) => { raw = value },
    })
    const repository = new LocalStorageTrainingSessionRepository()
    const session = new TrainingSession(100, repository, ['overhead_raise'], 'live', 'fast')
    session.start()
    session.record({
      exerciseId: 'overhead_raise',
      phase: 'COMPLETE',
      confidence: 0.4,
      metrics: { elbow: { value: 127, score: 0, valid: false } },
      currentScore: 0,
      errors: [],
    }, {
      phase: 'COMPLETE',
      repCount: 1,
      completedRep: {
        exerciseId: 'overhead_raise', repIndex: 1, startedAt: 100, completedAt: 3000, durationMs: 2900,
        peakShoulderL: 160, peakShoulderR: 161, minElbowL: 80, minElbowR: 82,
        topElbowL: 127, topElbowR: 151, maxSymmetryDiff: 3, maxTorsoLean: 2,
        amplitudeScore: 100, elbowScore: 0, synchronizationScore: 100, stabilityScore: 100,
        tempoScore: 100, overallScore: 75, errors: ['ELBOW_TOO_BENT_L'],
      },
    })
    const finished = session.finish(4000, 'completed')
    const reloaded = new LocalStorageTrainingSessionRepository().get(finished.id)
    expect(reloaded).toMatchObject({
      schemaVersion: 2,
      source: 'live',
      mode: 'fast',
      rulesVersion: { spec: 'exercise-rules-v1.0', threshold: 'engineering-v1' },
      courseId: finished.courseId,
      courseVersion: finished.courseVersion,
      status: 'completed',
      courseStatus: 'completed',
      startedAt: 100,
      endedAt: 4000,
    })
    const persistedRep = reloaded?.exercises[0]?.repetitions[0]
    expect(persistedRep?.rep).toMatchObject({ topElbowL: 127, topElbowR: 151 })
    expect(persistedRep?.metrics.elbow).toEqual({ value: 127, score: 0, valid: false })
  })
})
