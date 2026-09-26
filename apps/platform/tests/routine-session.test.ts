import { afterEach, describe, expect, it, vi } from 'vitest'
import { CourseController } from '../src/features/course/CourseController'
import type { FollowAlongMatch } from '../src/features/routines/followAlong/matcher'
import { ROUTINE_FEEDBACK_CONFIG, RoutineFeedbackPolicy } from '../src/features/routines/followAlong/feedbackPolicy'
import { getRoutineProgram } from '../src/features/routines/programs'
import { createRoutineCourse, deriveRoutineVoiceEvents, routineCourseProgress } from '../src/features/routines/routineCourse'
import { RoutineProgressRecorder } from '../src/features/routines/session/RoutineProgressRecorder'
import {
  LocalStorageRoutineSessionRepository, MemoryRoutineSessionRepository, parseStoredRoutineSessions, retainRoutineSessions,
  ROUTINE_SESSION_STORAGE_KEY,
} from '../src/features/routines/session/RoutineSessionRepository'
import { isRoutineSessionRecord } from '../src/features/routines/session/types'
import { routineRecord } from './helpers/routineFixtures'

function match(status: FollowAlongMatch['status'], overrides: Partial<FollowAlongMatch> = {}): FollowAlongMatch {
  return {
    status,
    similarity: 0.82,
    timingOffsetMs: 0,
    matchedAt: 0,
    videoTime: 0,
    regionScores: { arms: 0.8, torso: 0.9, legs: 0.7 },
    mirrored: false,
    ...overrides,
  }
}

describe('routine progress recorder', () => {
  const program = getRoutineProgram('baduanjin')

  it('counts each followed second once, across pauses, repeats and jumps', () => {
    const recorder = new RoutineProgressRecorder(program, { kind: 'full' })
    for (let time = 0; time < 10; time += 0.1) recorder.markPlayback(time, time + 0.1)
    for (let time = 0; time < 10; time += 0.1) recorder.markPlayback(time, time + 0.1)
    // A jump forward marks only where playback landed.
    recorder.markPlayback(10, 300)
    const [opening] = recorder.snapshot()
    expect(opening.coveredSeconds).toBe(11)
    expect(recorder.coveredSeconds()).toBe(12)
    const fourth = recorder.snapshot().find((item) => item.chapterId === 'bdj-4')
    expect(fourth?.coveredSeconds).toBe(1)
  })

  it('gives a boundary second to exactly one chapter and tolerates fast playback steps', () => {
    const recorder = new RoutineProgressRecorder(program, { kind: 'full' })
    recorder.markPlayback(134, 137.6, 8)
    const byId = new Map(recorder.snapshot().map((item) => [item.chapterId, item]))
    // 135.5 is the boundary: second 135 (midpoint 135.5) belongs to 第二式, not to 第一式.
    expect(byId.get('bdj-1')?.coveredSeconds).toBe(1)
    expect(byId.get('bdj-2')?.coveredSeconds).toBe(3)
    const totals = recorder.snapshot().reduce((sum, item) => sum + item.totalSeconds, 0)
    expect(totals).toBe(728)
  })

  it('only records the chapter of a single-form scope', () => {
    const recorder = new RoutineProgressRecorder(program, { kind: 'form', chapterId: 'bdj-3' })
    for (let time = 222; time < 240; time += 0.25) recorder.markPlayback(time, time + 0.25)
    recorder.recordComparison(230, match('in_sync'))
    recorder.recordComparison(100, match('in_sync'))
    const results = recorder.snapshot()
    expect(results.map((item) => item.chapterId)).toEqual(['bdj-3'])
    expect(results[0]).toMatchObject({ totalSeconds: 73, coveredSeconds: 19, samples: 1 })
  })

  it('aggregates comparisons per chapter and keeps unreliable ones apart', () => {
    const recorder = new RoutineProgressRecorder(program, { kind: 'full' })
    recorder.recordComparison(50, match('in_sync', { similarity: 0.9 }))
    recorder.recordComparison(50.1, match('behind', { similarity: 0.7, mirrored: true, regionScores: { arms: 0.6, torso: 0.8, legs: null } }))
    recorder.recordComparison(50.2, match('insufficient'))
    const result = recorder.snapshot().find((item) => item.chapterId === 'bdj-1')
    expect(result).toMatchObject({
      samples: 2,
      insufficientSamples: 1,
      statusCounts: { in_sync: 1, ahead: 0, behind: 1, mismatch: 0 },
      mirroredSamples: 1,
      regionSamples: { arms: 2, torso: 2, legs: 1 },
    })
    expect(result?.similaritySum).toBeCloseTo(1.6)
    expect(result?.regionSums.legs).toBeCloseTo(0.7)
  })
})

describe('routine feedback policy', () => {
  const cue = '十指交叉上托'

  it('shows the teaching cue while following, and praise when closely in sync', () => {
    const policy = new RoutineFeedbackPolicy()
    expect(policy.update(undefined, 0, cue).feedback.code).toBe('READING')
    expect(policy.update(match('in_sync', { similarity: 0.7 }), 100, cue).feedback).toEqual({ code: 'CUE', tone: 'info', message: cue })
    expect(policy.update(match('in_sync', { similarity: 0.85 }), 200, cue).feedback.code).toBe('FOLLOWING_WELL')
  })

  it('confirms a problem only after it persists, speaks it once, then praises the recovery', () => {
    const policy = new RoutineFeedbackPolicy()
    const behind = match('behind', { similarity: 0.7 })
    expect(policy.update(behind, 0, cue).feedback.code).toBe('CUE')
    expect(policy.update(behind, ROUTINE_FEEDBACK_CONFIG.rhythmSustainMs - 1, cue).feedback.code).toBe('CUE')
    const confirmed = policy.update(behind, ROUTINE_FEEDBACK_CONFIG.rhythmSustainMs, cue)
    expect(confirmed.feedback).toMatchObject({ code: 'BEHIND', tone: 'warning' })
    expect(confirmed.speak?.text).toBe(confirmed.feedback.message)
    expect(policy.update(behind, ROUTINE_FEEDBACK_CONFIG.rhythmSustainMs + 500, cue).speak).toBeUndefined()
    const sync = match('in_sync', { similarity: 0.7 })
    const start = ROUTINE_FEEDBACK_CONFIG.rhythmSustainMs + 1000
    expect(policy.update(sync, start, cue).feedback.code).toBe('BEHIND')
    expect(policy.update(sync, start + ROUTINE_FEEDBACK_CONFIG.recoverySustainMs, cue).feedback.code).toBe('RECOVERED')
    expect(policy.update(sync, start + ROUTINE_FEEDBACK_CONFIG.recoverySustainMs + ROUTINE_FEEDBACK_CONFIG.recoveryVisibleMs + 1, cue).feedback.code).toBe('CUE')
  })

  it('names the weakest body region and rate limits spoken corrections', () => {
    const policy = new RoutineFeedbackPolicy()
    const armsOff = match('mismatch', { similarity: 0.4, regionScores: { arms: 0.2, torso: 0.8, legs: 0.45 } })
    policy.update(armsOff, 0, cue)
    const first = policy.update(armsOff, ROUTINE_FEEDBACK_CONFIG.mismatchSustainMs, cue)
    expect(first.feedback.code).toBe('MISMATCH_ARMS')
    expect(first.speak).toBeDefined()
    // Recover, then fail again inside the cooldown: shown, not spoken.
    const sync = match('in_sync', { similarity: 0.7 })
    policy.update(sync, 4000, cue)
    policy.update(sync, 6000, cue)
    const legsOff = match('mismatch', { similarity: 0.5, regionScores: { arms: 0.8, torso: 0.8, legs: 0.2 } })
    policy.update(legsOff, 7000, cue)
    const again = policy.update(legsOff, 7000 + ROUTINE_FEEDBACK_CONFIG.mismatchSustainMs, cue)
    expect(again.feedback.code).toBe('MISMATCH_LEGS')
    expect(again.speak).toBeUndefined()
    const generic = new RoutineFeedbackPolicy()
    const unclear = match('mismatch', { similarity: 0.4, regionScores: { arms: 0.6, torso: 0.6, legs: null } })
    generic.update(unclear, 0, cue)
    expect(generic.update(unclear, ROUTINE_FEEDBACK_CONFIG.mismatchSustainMs, cue).feedback.code).toBe('MISMATCH')
  })

  it('starts over when the pose becomes unreadable', () => {
    const policy = new RoutineFeedbackPolicy()
    const ahead = match('ahead', { similarity: 0.7 })
    policy.update(ahead, 0, cue)
    policy.update(match('insufficient'), 2000, cue)
    expect(policy.update(ahead, ROUTINE_FEEDBACK_CONFIG.rhythmSustainMs, cue).feedback.code).toBe('CUE')
  })
})

describe('routine course and voice', () => {
  const program = getRoutineProgram('taijiquan')

  it('runs the scope as one course step whose progress is the video position', () => {
    const course = createRoutineCourse(program, { kind: 'form', chapterId: 'tjq-10' })
    expect(course.steps).toEqual([{ scope: { kind: 'form', chapterId: 'tjq-10' }, startSeconds: 178, endSeconds: 200.5 }])
    expect(routineCourseProgress(course.steps[0], 190)).toEqual({ progress: 12, target: 22.2 })
    expect(routineCourseProgress(course.steps[0], 100).progress).toBe(0)
    const controller = new CourseController(course)
    expect(controller.getStep().startSeconds).toBe(178)
    controller.update(0, { ready: true, progress: 0, target: 22.2 })
    controller.update(3000, { ready: true, progress: 0, target: 22.2 })
    expect(controller.getSnapshot().state).toBe('ACTIVE')
    controller.update(4000, { ready: false, progress: 22.2, target: 22.2 })
    expect(controller.getSnapshot().state).toBe('TRANSITION')
    controller.update(5600, { ready: false, progress: 22.2, target: 22.2 })
    expect(controller.getSnapshot().state).toBe('COURSE_COMPLETE')
    expect(createRoutineCourse(program, { kind: 'full' }, true).countdownSeconds).toBeLessThan(1)
  })

  it('announces preparation, countdown, start and completion, but not chapter changes or resumes', () => {
    const snapshot = (state: 'PREPARING' | 'COUNTDOWN' | 'ACTIVE' | 'PAUSED' | 'COURSE_COMPLETE', countdown = 0) =>
      ({ state, stepIndex: 0, countdown, elapsedMs: 0, transitionRemainingMs: 0 })
    const scope = { kind: 'full' } as const
    const kinds = (events: ReturnType<typeof deriveRoutineVoiceEvents>) => events.map((event) => event.kind)
    const opening = deriveRoutineVoiceEvents(undefined, snapshot('PREPARING', 3), program, scope, 0)
    expect(kinds(opening)).toEqual(['preparation'])
    expect(opening[0].text).toContain('太极拳整套跟练')
    expect(deriveRoutineVoiceEvents(snapshot('PREPARING'), snapshot('COUNTDOWN', 3), program, scope, 0)[0].text).toBe('三')
    expect(kinds(deriveRoutineVoiceEvents(snapshot('COUNTDOWN', 1), snapshot('ACTIVE'), program, scope, 0))).toEqual(['start'])
    expect(deriveRoutineVoiceEvents(snapshot('PAUSED'), snapshot('ACTIVE'), program, scope, 0)).toEqual([])
    expect(deriveRoutineVoiceEvents(snapshot('ACTIVE'), snapshot('ACTIVE'), program, scope, 0)).toEqual([])
    expect(kinds(deriveRoutineVoiceEvents(snapshot('ACTIVE'), snapshot('COURSE_COMPLETE'), program, scope, 0))).toEqual(['course_complete'])
    const single = deriveRoutineVoiceEvents(undefined, snapshot('PREPARING', 3), program, { kind: 'form', chapterId: 'tjq-2' }, 0)
    expect(single[0].text).toContain('第二式 · 左右野马分鬃')
  })
})

describe('routine session storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts only complete schema-1 routine records', () => {
    const record = routineRecord()
    expect(isRoutineSessionRecord(record)).toBe(true)
    expect(isRoutineSessionRecord({ ...record, schemaVersion: 2 })).toBe(false)
    expect(isRoutineSessionRecord({ ...record, kind: 'smart' })).toBe(false)
    expect(isRoutineSessionRecord({ ...record, scope: { kind: 'form' } })).toBe(false)
    expect(isRoutineSessionRecord({ ...record, chapters: [{ chapterId: 'x' }] })).toBe(false)
    expect(parseStoredRoutineSessions([record, null, 'x', { ...record, outcome: 'maybe' }])).toEqual([record])
    expect(parseStoredRoutineSessions('nope')).toEqual([])
  })

  it('keeps the newest records and drops test records first', () => {
    const records = Array.from({ length: 5 }, (_value, index) => routineRecord({ id: `r${index}`, startedAt: 1000 + index, source: index === 3 ? 'synthetic' : 'live' }))
    // Two must go: the synthetic record first, then the oldest real one.
    expect(retainRoutineSessions(records, 3).map((item) => item.id)).toEqual(['r1', 'r2', 'r4'])
    expect(retainRoutineSessions(records, 10)).toHaveLength(5)
  })

  it('saves, updates and lists through localStorage, surviving corrupt storage', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    })
    const repository = new LocalStorageRoutineSessionRepository()
    const record = routineRecord({ outcome: 'in_progress' })
    expect(repository.save(record)).toBe(true)
    expect(repository.save({ ...record, outcome: 'completed' })).toBe(true)
    expect(repository.list()).toHaveLength(1)
    expect(repository.get(record.id)?.outcome).toBe('completed')
    store.set(ROUTINE_SESSION_STORAGE_KEY, '{not json')
    expect(repository.list()).toEqual([])
    expect(repository.get(record.id)).toBeUndefined()
  })

  it('offers an in-memory repository for tests and previews', () => {
    const memory = new MemoryRoutineSessionRepository()
    memory.save(routineRecord({ id: 'a' }))
    memory.save(routineRecord({ id: 'a', outcome: 'incomplete' }))
    expect(memory.list()).toHaveLength(1)
    expect(memory.get('a')?.outcome).toBe('incomplete')
  })
})
