import { describe, expect, it, vi } from 'vitest'
import { createCoachSessionReader, type HistoryQuery } from '../src/features/coachAgent/sessionReader'
import type { ReaderResult } from '../src/features/coachAgent/readerTypes'
import { validateTrainingSessionSummary } from '../src/features/coachAgent/validation'
import { SESSION_STORAGE_KEY } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { ROUTINE_SESSION_STORAGE_KEY } from '../src/features/routines/session/RoutineSessionRepository'
import { analyzeTraining } from '../src/features/analysis/TrainingAnalysisEngine'
import { FOLLOW_ALONG_CONFIG } from '../src/features/routines/followAlong/matcher'
import { findRoutineProgram } from '../src/features/routines/programs'
import { buildRoutineReport } from '../src/features/routines/report/routineReport'
import { RoutineProgressRecorder } from '../src/features/routines/session/RoutineProgressRecorder'
import type { RoutineSessionRecord } from '../src/features/routines/session/types'
import { FULL_IMPROVEMENT, PARTIAL_SESSION, at, makeSession } from './analysis-fixtures'

// These are deterministic synthetic fixtures shaped like persisted runtime records.
// Their live labels exercise provenance gates; they are not human-training evidence.
const NOW = at(30)

function ok<T>(result: ReaderResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.data
}

function errorCode<T>(result: ReaderResult<T>): string {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected a reader error')
  return result.error.code
}

function readerFromRaw(raw: string | null, routineRaw: string | null = null) {
  const getItem = vi.fn((key: string) => key === SESSION_STORAGE_KEY ? raw : key === ROUTINE_SESSION_STORAGE_KEY ? routineRaw : null)
  const setItem = vi.fn()
  const removeItem = vi.fn()
  const clear = vi.fn()
  const storage = { getItem, setItem, removeItem, clear }
  const reader = createCoachSessionReader({ storage, now: () => NOW })
  return { reader, storage }
}

function withRecords(records: unknown[]) { return readerFromRaw(JSON.stringify(records)) }
function normal(id = 'session', day = 1) { return makeSession({ id, startedAt: at(day) }) }

function routine(id: string, day: number, coverage = 1): RoutineSessionRecord {
  const program = findRoutineProgram('baduanjin')!
  const chapter = program.chapters.find(item => item.kind === 'form')!
  const scope = { kind: 'form' as const, chapterId: chapter.id }
  const recorder = new RoutineProgressRecorder(program, scope)
  const coverageEnd = chapter.startSeconds + (chapter.endSeconds - chapter.startSeconds) * coverage
  for (let second = Math.floor(chapter.startSeconds); second < coverageEnd; second += 1) recorder.markPlayback(second, second)
  for (let sample = 0; sample < 20; sample += 1) recorder.recordComparison(chapter.startSeconds + 0.5, {
    status: 'in_sync', similarity: 0.8, timingOffsetMs: 0, matchedAt: chapter.startSeconds + 0.5,
    videoTime: chapter.startSeconds + 0.5, regionScores: { arms: 0.8, torso: 0.8, legs: 0.8 }, mirrored: false,
  })
  return { schemaVersion: 1, kind: 'routine', id, programId: program.id, programVersion: program.version, scope,
    source: 'live', mode: 'normal', matcher: { version: FOLLOW_ALONG_CONFIG.version, available: true },
    startedAt: at(day), endedAt: at(day) + 600_000, activeMs: 60_000, outcome: 'completed', chapters: recorder.snapshot() }
}

describe('Coach session reader storage outcomes', () => {
  it.each([null, '[]'])('reports a genuinely empty warmup store: %s', raw => {
    const { reader } = readerFromRaw(raw)
    expect(ok(reader.readHistory({ kind: 'warmup' }))).toEqual({ state: 'EMPTY', sessions: [] })
    expect(errorCode(reader.readSession('warmup', 'absent'))).toBe('NOT_FOUND')
  })

  it('reads the independent routine key without reading the warmup partition', () => {
    const { reader, storage } = readerFromRaw('{corrupt warmup', '[]')
    expect(ok(reader.readHistory({ kind: 'routine' })).state).toBe('EMPTY')
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(ROUTINE_SESSION_STORAGE_KEY)
  })

  it.each(['', '{broken', 'null', '{}', '42', '"[]"'])('does not present invalid persisted JSON as an empty history: %s', raw => {
    const { reader } = readerFromRaw(raw)
    expect(errorCode(reader.readHistory({ kind: 'warmup' }))).toBe('CORRUPT')
    expect(errorCode(reader.readSession('warmup', 'absent'))).toBe('CORRUPT')
  })

  it('fails closed for mixed valid and corrupt records, including a requested valid record', () => {
    const { reader } = withRecords([normal(), { schemaVersion: 2, id: 'broken' }])
    expect(errorCode(reader.readHistory({ kind: 'warmup' }))).toBe('CORRUPT')
    expect(errorCode(reader.readSession('warmup', 'session'))).toBe('CORRUPT')
  })

  it('distinguishes an unsupported schema from an absent session', () => {
    const record = { ...normal(), schemaVersion: 99 }
    const { reader } = withRecords([record])
    expect(errorCode(reader.readSession('warmup', 'session'))).toBe('UNSUPPORTED_VERSION')
    expect(errorCode(reader.readHistory({ kind: 'warmup' }))).toBe('UNSUPPORTED_VERSION')
  })

  it('distinguishes storage access failure from an empty library', () => {
    const reader = createCoachSessionReader({ storage: { getItem() { throw new Error('disk unavailable') } }, now: () => NOW })
    expect(errorCode(reader.readHistory({ kind: 'warmup' }))).toBe('UNAVAILABLE')
  })

  it('reports explicit permission denial without leaking exception content', () => {
    const storageError = new Error('private file path and user identity')
    storageError.name = 'SecurityError'
    const reader = createCoachSessionReader({ storage: { getItem() { throw storageError } }, now: () => NOW })
    const result = reader.readSession('warmup', 'session')
    expect(errorCode(result)).toBe('PERMISSION_DENIED')
    expect(JSON.stringify(result)).not.toContain(storageError.message)
  })

  it.each([NaN, Infinity, -1, 1.5])('rejects an invalid injected snapshot clock: %s', now => {
    const reader = createCoachSessionReader({ storage: { getItem: () => '[]' }, now: () => now })
    expect(errorCode(reader.readHistory({ kind: 'warmup' }))).toBe('UNAVAILABLE')
  })

  it('rejects duplicate session IDs rather than silently selecting one', () => {
    const { reader } = withRecords([normal('duplicate', 1), normal('duplicate', 2)])
    expect(errorCode(reader.readSession('warmup', 'duplicate'))).toBe('CORRUPT')
  })

  it('does not filter a malformed record out of a subject-specific query', () => {
    const { reader } = withRecords([normal(), null])
    expect(errorCode(reader.readHistory({ kind: 'warmup', subject: { kind: 'exercise', id: 'squat' } }))).toBe('CORRUPT')
  })

  it('reports a missing ID in a populated valid store as NOT_FOUND', () => {
    expect(errorCode(withRecords([normal()]).reader.readSession('warmup', 'different'))).toBe('NOT_FOUND')
  })

  it('validates full storage even when a history limit would hide a malformed record', () => {
    const { reader } = withRecords([{ schemaVersion: 2 }, normal('latest', 5)])
    expect(errorCode(reader.readHistory({ kind: 'warmup', limit: 1 }))).toBe('CORRUPT')
  })
})

describe('Coach reader query and provenance boundaries', () => {
  it.each(['', ' ', ' padded', 'bad\nname', 'x'.repeat(129)])('rejects invalid session IDs: %j', sessionId => {
    const { reader, storage } = readerFromRaw(null)
    expect(errorCode(reader.readSession('warmup', sessionId))).toBe('INVALID_INPUT')
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it.each([0, -1, 65, 1.5, NaN])('rejects an invalid history limit: %s', limit => {
    const { reader } = readerFromRaw(null)
    expect(errorCode(reader.readHistory({ kind: 'warmup', limit }))).toBe('INVALID_INPUT')
  })

  it('rejects a routine subject in a warmup query', () => {
    const { reader } = readerFromRaw(null)
    expect(errorCode(reader.readHistory({ kind: 'warmup', subject: { kind: 'routine', id: 'baduanjin' } }))).toBe('INVALID_INPUT')
  })

  it('rejects an unknown session partition', () => {
    const { reader } = readerFromRaw(null)
    expect(errorCode(reader.readHistory({ kind: 'other' } as unknown as HistoryQuery))).toBe('INVALID_INPUT')
  })

  it('preserves missing legacy source and mode as unknown', () => {
    const { source: omittedSource, mode: omittedMode, ...legacy } = normal()
    expect(omittedSource).toBe('live')
    expect(omittedMode).toBe('normal')
    const snapshot = ok(withRecords([legacy]).reader.readSession('warmup', legacy.id))
    expect(snapshot.summary.provenance).toMatchObject({ source: 'unknown', mode: 'unknown', producer: 'repository' })
    expect(validateTrainingSessionSummary(snapshot.summary).ok).toBe(true)
  })

  it.each(['demo', 'synthetic'] as const)('preserves %s history without claiming verified live progress', source => {
    const current = normal('current', 2)
    const candidate = makeSession({ id: 'test-history', startedAt: at(1), source })
    const { reader } = withRecords([candidate, current])
    const history = ok(reader.readHistory({ kind: 'warmup' }))
    expect(history.sessions.find(s => s.summary.sessionId === candidate.id)?.summary.provenance.source).toBe(source)
    const comparison = ok(reader.compareHistory({ kind: 'warmup', sessionId: current.id }))
    expect(comparison.gate).toBe('NONE')
    expect(comparison.previous).toEqual([])
    expect(comparison.excluded).toContainEqual(expect.objectContaining({ sessionId: candidate.id }))
  })

  it('never lets an unknown source candidate through the legacy default-live comparison path', () => {
    const { source: sourceLabel, ...unknown } = normal('legacy', 1)
    expect(sourceLabel).toBe('live')
    const current = normal('current', 2)
    const result = ok(withRecords([unknown, current]).reader.compareHistory({ kind: 'warmup', sessionId: current.id }))
    expect(result.gate).toBe('NONE')
    expect(result.previous).toEqual([])
    expect(result.excluded).toContainEqual(expect.objectContaining({ sessionId: 'legacy' }))
  })

  it('blocks a synthetic current record from using live history as human progress', () => {
    const current = makeSession({ id: 'simulated', startedAt: at(2), source: 'synthetic' })
    const result = ok(withRecords([normal('before'), current]).reader.compareHistory({ kind: 'warmup', sessionId: current.id }))
    expect(result).toMatchObject({ gate: 'NONE', reason: 'CURRENT_PROVENANCE_NOT_VERIFIED_LIVE_NORMAL', previous: [] })
  })

  it('does not query another partition when a session ID is absent', () => {
    const { reader, storage } = readerFromRaw('[]', JSON.stringify([normal('elsewhere')]))
    expect(errorCode(reader.readSession('warmup', 'elsewhere'))).toBe('NOT_FOUND')
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(SESSION_STORAGE_KEY)
  })
})

describe('Coach reader usable snapshots and history comparison', () => {
  it('reads a compatible persisted record with its original identity and storage version', () => {
    const record = normal()
    const result = ok(withRecords([record]).reader.readSession('warmup', record.id))
    expect(result.summary).toMatchObject({ sessionId: record.id, kind: 'warmup', recordRef: { id: record.id, version: '2' },
      startedAt: { domain: 'epoch-ms', value: record.startedAt }, endedAt: { domain: 'epoch-ms', value: record.endedAt } })
    expect(result.storage).toEqual({ key: SESSION_STORAGE_KEY, index: 0, schemaVersion: 2 })
    expect(validateTrainingSessionSummary(result.summary).ok).toBe(true)
  })

  it('returns newest records first with deterministic same-time ID ordering and a limit', () => {
    const records = [normal('older', 1), normal('same-a', 2), normal('same-z', 2)]
    const result = ok(withRecords(records).reader.readHistory({ kind: 'warmup', limit: 2 }))
    expect(result.state).toBe('PRESENT')
    expect(result.sessions.map(s => s.summary.sessionId)).toEqual(['same-z', 'same-a'])
  })

  it('projects a squat query to squat evidence while preserving resolvable explanation references', () => {
    const { reader } = withRecords([normal()])
    const history = ok(reader.readHistory({ kind: 'warmup', subject: { kind: 'exercise', id: 'squat' } }))
    expect(history.sessions).toHaveLength(1)
    const snapshot = history.sessions[0]
    expect(snapshot.summary.evidence.length).toBeGreaterThan(0)
    expect(snapshot.summary.evidence.every(e => e.subject.kind === 'exercise' && e.subject.id === 'squat')).toBe(true)
    expect(snapshot.details.map(d => d.evidenceId).sort()).toEqual(snapshot.summary.evidence.map(e => e.id).sort())
  })

  it('does not treat the planned squat step as historical squat training when only guidance was recorded', () => {
    const record = makeSession({ id: 'only-guidance', startedAt: at(2), include: ['shoulder_rotation'] })
    // The full course remains planned, but the user never reached squat.
    expect(record.exerciseOrder).toContain('squat')
    const { reader } = withRecords([normal('before', 1), record])
    const ownHistory = ok(withRecords([record]).reader.readHistory({ kind: 'warmup', subject: { kind: 'exercise', id: 'squat' } }))
    expect(ownHistory).toEqual({ state: 'EMPTY', sessions: [] })
    const comparison = ok(reader.compareHistory({ kind: 'warmup', sessionId: record.id, subject: { kind: 'exercise', id: 'squat' } }))
    expect(comparison).toMatchObject({ gate: 'NONE', reason: 'SUBJECT_NOT_IN_SESSION', previous: [] })
  })

  it('reuses the original FULL comparison gate and returns the corresponding stored evidence', () => {
    const { current, history } = FULL_IMPROVEMENT
    const result = ok(withRecords([...history, current]).reader.compareHistory({ kind: 'warmup', sessionId: current.id,
      subject: { kind: 'exercise', id: 'squat' } }))
    const native = analyzeTraining(current, history).comparison
    expect(result.gate).toBe('FULL')
    expect(result.gates[0]).toEqual(native)
    expect(result.previous.map(s => s.summary.sessionId)).toEqual([history[0].id])
    const priorScores = result.previous[0].summary.evidence
    expect(priorScores.length).toBeGreaterThan(0)
    expect(priorScores.every(e => e.subject.id === 'squat')).toBe(true)
  })

  it('keeps the original PARTIAL gate and its reason instead of promoting it to FULL', () => {
    const { current, history } = PARTIAL_SESSION
    const result = ok(withRecords([...history, current]).reader.compareHistory({ kind: 'warmup', sessionId: current.id }))
    const native = analyzeTraining(current, history).comparison
    expect(result.gate).toBe('PARTIAL')
    expect(result.reason).toBe(native.reason)
    expect(result.gates[0]).toEqual(native)
    expect(result.previous.map(s => s.summary.sessionId)).toEqual([history[0].id])
  })

  it('keeps the minimum common-exercise gate even for a single-exercise request', () => {
    const current = PARTIAL_SESSION.oneCommon
    const history = PARTIAL_SESSION.history
    const result = ok(withRecords([...history, current]).reader.compareHistory({ kind: 'warmup', sessionId: current.id,
      subject: { kind: 'exercise', id: 'overhead_raise' } }))
    expect(result).toMatchObject({ gate: 'NONE', reason: 'INSUFFICIENT_COMMON_EXERCISES', previous: [] })
  })

  it('does not include an exercise that was not comparable under a PARTIAL gate', () => {
    const { current, history } = PARTIAL_SESSION
    const result = ok(withRecords([...history, current]).reader.compareHistory({ kind: 'warmup', sessionId: current.id,
      subject: { kind: 'exercise', id: 'squat' } }))
    // Only three of the planned six squats were recorded, so squat is not a common completed exercise.
    expect(result.gate).toBe('NONE')
    expect(result.previous).toEqual([])
    expect(result.excluded).toContainEqual({ sessionId: history[0].id, reasons: ['REQUESTED_EXERCISE_NOT_COMPARABLE'] })
  })

  it('does not invent comparable history for the first session', () => {
    const record = normal()
    const result = ok(withRecords([record]).reader.compareHistory({ kind: 'warmup', sessionId: record.id }))
    expect(result.gate).toBe('NONE')
    expect(result.reason).toBeTruthy()
    expect(result.previous).toEqual([])
  })

  it('retains multiple eligible earlier records while enforcing the caller limit', () => {
    const records = [normal('first', 1), normal('second', 2), normal('third', 3), normal('current', 4)]
    const result = ok(withRecords(records).reader.compareHistory({ kind: 'warmup', sessionId: 'current', limit: 2 }))
    expect(result.previous.map(s => s.summary.sessionId)).toEqual(['third', 'second'])
  })

  it('returns explicit NONE when current rules are incompatible with historical rules', () => {
    const current = makeSession({ id: 'new-rules', startedAt: at(2), rulesVersion: { spec: 'future', threshold: 'engineering-v99' } })
    const result = ok(withRecords([normal('before'), current]).reader.compareHistory({ kind: 'warmup', sessionId: current.id }))
    expect(result.gate).toBe('NONE')
    expect(result.reason).toBe('CURRENT_RULES_UNSUPPORTED')
    expect(result.previous).toEqual([])
  })

  it('returns scoring evidence with exact explanation bindings and no common aggregate score', () => {
    const record = normal()
    const result = ok(withRecords([record]).reader.readScoringEvidence('warmup', record.id))
    expect(result.evidence.some(e => e.score.scoreKind === 'warmup-standard')).toBe(true)
    expect(result.evidence.filter(e => e.score.scoreKind === 'guidance').every(e => e.score.value === null)).toBe(true)
    expect(result.details.map(d => d.evidenceId).sort()).toEqual(result.evidence.map(e => e.id).sort())
    expect(result).not.toHaveProperty('overallScore')
  })

  it('reports insufficient scoring data without turning missing samples into zero', () => {
    const record = makeSession({ id: 'no-data', startedAt: at(1), include: ['squat'], exerciseOrder: ['squat'],
      exercises: { squat: { reps: 0 } } })
    const { reader } = withRecords([record])
    expect(ok(reader.readSession('warmup', record.id)).summary.evidence.every(e => e.score.value === null)).toBe(true)
    expect(errorCode(reader.readScoringEvidence('warmup', record.id))).toBe('INSUFFICIENT_DATA')
  })
})

describe('Coach routine reader facade integration', () => {
  it('uses only routine storage, schema and score kinds', () => {
    const record = routine('routine', 1)
    const { reader, storage } = readerFromRaw('{invalid warmup', JSON.stringify([record]))
    const snapshot = ok(reader.readSession('routine', record.id))
    expect(snapshot.summary).toMatchObject({ kind: 'routine', completedReps: null, recordRef: { id: record.id, version: '1' } })
    expect(snapshot.summary.evidence.some(e => e.score.scoreKind === 'follow-along-similarity')).toBe(true)
    expect(snapshot.summary.evidence.every(e => e.score.scoreKind !== 'warmup-standard')).toBe(true)
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(ROUTINE_SESSION_STORAGE_KEY)
  })

  it('reuses the original routine gate and labels its scope as follow-along only', () => {
    const previous = routine('before', 1)
    const current = routine('current', 2)
    const { reader } = readerFromRaw(null, JSON.stringify([previous, current]))
    const result = ok(reader.compareHistory({ kind: 'routine', sessionId: current.id, subject: { kind: 'routine', id: 'baduanjin' } }))
    expect(result).toMatchObject({ gate: 'PARTIAL', reason: 'ROUTINE_FOLLOW_ALONG_ONLY' })
    expect(result.gates[0]).toEqual(buildRoutineReport(current, [previous])?.comparison)
    expect(result.previous.map(s => s.summary.sessionId)).toEqual([previous.id])
  })

  it('retains the native routine same-time ID ordering when selecting previous records', () => {
    const current = routine('same-m', 2)
    const previous = routine('same-a', 2)
    const laterId = routine('same-z', 2)
    const native = buildRoutineReport(current, [laterId, previous])!.comparison
    expect(native).toMatchObject({ available: true, previousId: previous.id })
    const { reader } = readerFromRaw(null, JSON.stringify([laterId, current, previous]))
    const result = ok(reader.compareHistory({ kind: 'routine', sessionId: current.id }))
    expect(result.gates[0]).toEqual(native)
    expect(result.previous.map(s => s.summary.sessionId)).toEqual([previous.id])
    expect(result.previous.some(s => s.summary.sessionId === laterId.id)).toBe(false)
  })

  it('retains the original insufficient-coverage reason and returns no progress evidence', () => {
    const current = routine('short', 2, 0.1)
    const previous = routine('before', 1)
    const native = buildRoutineReport(current, [previous])!
    expect(native.comparison.available).toBe(false)
    const result = ok(readerFromRaw(null, JSON.stringify([previous, current])).reader.compareHistory({ kind: 'routine', sessionId: current.id }))
    expect(result).toMatchObject({ gate: 'NONE', reason: native.comparison.reason, previous: [] })
  })

  it('rejects a matcher version that cannot be interpreted with current reports', () => {
    const previous = routine('before', 1)
    previous.matcher.version = 'follow-along-v99'
    const current = routine('current', 2)
    const { reader } = readerFromRaw(null, JSON.stringify([previous, current]))
    expect(errorCode(reader.compareHistory({ kind: 'routine', sessionId: current.id }))).toBe('UNSUPPORTED_VERSION')
  })

  it('isolates synthetic routine history from live routine comparisons', () => {
    const previous = routine('synthetic', 1)
    previous.source = 'synthetic'
    const current = routine('current', 2)
    const result = ok(readerFromRaw(null, JSON.stringify([previous, current])).reader.compareHistory({ kind: 'routine', sessionId: current.id }))
    expect(result.gate).toBe('NONE')
    expect(result.previous).toEqual([])
    expect(result.excluded).toContainEqual(expect.objectContaining({ sessionId: previous.id }))
  })

  it('preserves legacy routine provenance as unknown and excludes it from progress claims', () => {
    const { source, mode, ...legacy } = routine('legacy', 1)
    expect(source).toBe('live')
    expect(mode).toBe('normal')
    const current = routine('current', 2)
    const { reader } = readerFromRaw(null, JSON.stringify([legacy, current]))
    expect(ok(reader.readSession('routine', legacy.id)).summary.provenance).toMatchObject({ source: 'unknown', mode: 'unknown' })
    const result = ok(reader.compareHistory({ kind: 'routine', sessionId: current.id }))
    expect(result.gate).toBe('NONE')
    expect(result.previous).toEqual([])
  })

  it('returns an unavailable reference matcher as insufficient evidence', () => {
    const record = routine('no-reference', 1)
    record.matcher.available = false
    for (const chapter of record.chapters) {
      chapter.samples = 0
      chapter.similaritySum = 0
      chapter.regionSums = { arms: 0, torso: 0, legs: 0 }
      chapter.regionSamples = { arms: 0, torso: 0, legs: 0 }
      chapter.statusCounts = { in_sync: 0, ahead: 0, behind: 0, mismatch: 0 }
    }
    const { reader } = readerFromRaw(null, JSON.stringify([record]))
    expect(ok(reader.readSession('routine', record.id)).summary.evidence.every(e => e.score.value === null)).toBe(true)
    expect(errorCode(reader.readScoringEvidence('routine', record.id))).toBe('INSUFFICIENT_DATA')
  })

  it('validates evidence references against the actual routine criterion catalogue', () => {
    const record = { ...routine('bad-reference', 1), technique: { version: 'scoring-v2.1', criteria: [
      { criterionId: 'wu.squat.depth', chapterId: routine('shape', 1).chapters[0].chapterId,
        windows: [{ start: 100, end: 101, samples: 20, value: 0.5, score: 90 }] },
    ] } }
    const { reader } = readerFromRaw(null, JSON.stringify([record]))
    expect(errorCode(reader.readSession('routine', record.id))).toBe('CORRUPT')
  })
})

describe('Coach reader trust and read-only behavior', () => {
  it('does not mutate supplied records or write, clear, or repair the original store', () => {
    const records = [normal('before', 1), normal('current', 2)]
    const before = structuredClone(records)
    const raw = JSON.stringify(records)
    const { reader, storage } = readerFromRaw(raw)
    ok(reader.readSession('warmup', 'current'))
    ok(reader.readHistory({ kind: 'warmup' }))
    ok(reader.readScoringEvidence('warmup', 'current'))
    ok(reader.compareHistory({ kind: 'warmup', sessionId: 'current' }))
    expect(records).toEqual(before)
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(storage.clear).not.toHaveBeenCalled()
  })

  it('produces deterministic results for repeated reads against the same snapshot clock', () => {
    const { reader } = withRecords([normal('before', 1), normal('current', 2)])
    expect(reader.readSession('warmup', 'current')).toEqual(reader.readSession('warmup', 'current'))
    expect(reader.readHistory({ kind: 'warmup' })).toEqual(reader.readHistory({ kind: 'warmup' }))
    expect(reader.compareHistory({ kind: 'warmup', sessionId: 'current' })).toEqual(reader.compareHistory({ kind: 'warmup', sessionId: 'current' }))
  })

  it('tracks reader-owned immutable snapshots separately from structurally valid JSON', () => {
    const { reader } = withRecords([normal()])
    const snapshot = ok(reader.readSession('warmup', 'session'))
    expect(reader.owns(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.summary)).toBe(true)
    expect(Object.isFrozen(snapshot.summary.evidence)).toBe(true)
    expect(reader.owns(JSON.parse(JSON.stringify(snapshot)))).toBe(false)
    expect(reader.owns(snapshot.summary)).toBe(false)
    expect(reader.owns({ trust: 'reader-validated' })).toBe(false)
    expect(reader.owns(null)).toBe(false)
  })

  it('does not accept a different reader instance snapshot as its own', () => {
    const left = withRecords([normal()]).reader
    const right = withRecords([normal()]).reader
    const snapshot = ok(left.readSession('warmup', 'session'))
    expect(right.owns(snapshot)).toBe(false)
  })

  it('does not expose arbitrary local video or pose payloads in reader output', () => {
    const record = { ...normal(), videoFile: 'private-local-video.mov', landmarks: [{ x: 0.123456789 }],
      personalNotes: 'private-name-not-for-model' }
    const snapshot = ok(withRecords([record]).reader.readSession('warmup', record.id))
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain(record.videoFile)
    expect(serialized).not.toContain(record.personalNotes)
    expect(serialized).not.toContain('0.123456789')
  })
})
