import { describe, expect, it } from 'vitest'
import { analyzeTraining } from '../src/features/analysis'
import { mapWarmupSession, validateWarmupRecord } from '../src/features/coachAgent/warmupReader'
import { ReaderFault } from '../src/features/coachAgent/readerTypes'
import { validateTrainingSessionSummary } from '../src/features/coachAgent/validation'
import type { TrainingSessionState } from '../src/features/training/types'
import { makeSession, at, INVALID_REPS, MISSING_TOP_ELBOW } from './analysis-fixtures'

// Existing deterministic fixtures exercise actual stored runtime formats; none represents a human test.
const NOW = at(4)
function record(): TrainingSessionState {
  return makeSession({ id: 'synthetic-reader-session', source: 'synthetic', startedAt: at(2) })
}
function firstRep(session: TrainingSessionState) {
  return session.exercises.find(exercise => exercise.exerciseId === 'squat')!.repetitions[0]
}
function reject(raw: unknown, code = 'CORRUPT'): void {
  try {
    mapWarmupSession(raw, NOW)
    expect.fail('The corrupt stored record must be rejected.')
  } catch (error) {
    expect(error).toBeInstanceOf(ReaderFault)
    expect((error as ReaderFault).code).toBe(code)
  }
}

describe('warm-up reader stored session validation', () => {
  it('maps all six exercises and preserves original identity, versions, source, and course metadata', () => {
    const input = record()
    const result = mapWarmupSession(input, NOW)
    expect(result.summary.sessionId).toBe(input.id)
    expect(result.summary.recordRef).toEqual({ id: input.id, version: '2' })
    expect(result.summary.provenance).toEqual({ source: 'synthetic', mode: 'normal', producer: 'repository' })
    expect(result.summary.evidence).toHaveLength(6)
    expect(result.metadata).toMatchObject({ courseId: input.courseId, courseVersion: input.courseVersion, originalStatus: 'completed', rulesVersion: input.rulesVersion, analysisVersion: 'analysis-v1' })
    expect(validateTrainingSessionSummary(result.summary).ok).toBe(true)
  })

  it.each(['ready', 'active', 'paused'] as const)('keeps unfinished %s sessions readable', status => {
    const input = makeSession({ id: `synthetic-${status}`, source: 'synthetic', startedAt: at(2), status })
    const result = mapWarmupSession(input, NOW)
    expect(result.summary.status).toBe(status === 'paused' ? 'paused' : 'active')
    expect(result.summary.endedAt).toBeNull()
    expect(result.metadata.originalStatus).toBe(status)
  })

  it('distinguishes a finalized incomplete course from a completed one', () => {
    const input = record()
    input.courseStatus = 'incomplete'
    expect(mapWarmupSession(input, NOW).summary.status).toBe('incomplete')
  })

  it('preserves unknown source and mode without defaulting to live normal training', () => {
    const input = record() as unknown as Record<string, unknown>
    delete input.source
    delete input.mode
    expect(validateWarmupRecord(input)).not.toHaveProperty('source')
    expect(mapWarmupSession(input, NOW).summary.provenance).toEqual({ source: 'unknown', mode: 'unknown', producer: 'repository' })
    expect(mapWarmupSession(input, NOW).limitations.join(' ')).toContain('SOURCE_UNKNOWN')
  })

  it.each(['live', 'demo', 'synthetic'] as const)('does not relabel %s provenance', source => {
    const input = record()
    input.source = source
    const result = mapWarmupSession(input, NOW)
    expect(result.summary.provenance.source).toBe(source)
    expect(result.summary.evidence.every(item => item.provenance.source === source)).toBe(true)
    expect(result.limitations.some(item => item.startsWith('NON_LIVE_SOURCE'))).toBe(source !== 'live')
  })

  it.each([null, false, [], 7, 'session'])('rejects non-record %j', value => reject(value))
  it.each([1, 3, '2', undefined])('rejects unsupported stored version %s', schemaVersion => reject({ ...record(), schemaVersion }, 'UNSUPPORTED_VERSION'))
  it('rejects unknown capture sources and modes', () => {
    reject({ ...record(), source: 'model' })
    reject({ ...record(), mode: 'invented' })
  })

  it('rejects getters rather than executing them', () => {
    const input = record()
    let called = false
    Object.defineProperty(input, 'source', { enumerable: true, get() { called = true; return 'live' } })
    reject(input)
    expect(called).toBe(false)
  })

  it('rejects duplicated or foreign exercise references', () => {
    const duplicated = record()
    duplicated.exercises.push(structuredClone(duplicated.exercises[0]))
    reject(duplicated)
    const foreign = record()
    firstRep(foreign).rep.exerciseId = 'lateral_raise'
    reject(foreign)
  })

  it('rejects duplicate repetition indices', () => {
    const input = record()
    const exercise = input.exercises.find(item => item.exerciseId === 'squat')!
    exercise.repetitions[1].rep.repIndex = exercise.repetitions[0].rep.repIndex
    reject(input)
  })

  it.each([-1, 101, NaN, Infinity, null])('rejects invalid stored repetition score %s', score => {
    const input = record()
    ;(firstRep(input) as unknown as Record<string, unknown>).score = score
    reject(input)
  })

  it('rejects invalid component scores and non-finite measured values', () => {
    const invalidScore = record()
    firstRep(invalidScore).metrics.amplitude.score = 101
    reject(invalidScore)
    const invalidValue = record()
    firstRep(invalidValue).metrics.amplitude.value = NaN
    reject(invalidValue)
  })

  it.each([-1, NaN, Infinity, 1.5, null])('rejects invalid session epoch timestamp %s', startedAt => reject({ ...record(), startedAt }))
  it('rejects reversed session and repetition times and impossible duration', () => {
    reject({ ...record(), endedAt: at(1) })
    const reversed = record()
    firstRep(reversed).rep.completedAt = firstRep(reversed).rep.startedAt - 1
    reject(reversed)
    const duration = record()
    firstRep(duration).rep.durationMs = 100_000
    reject(duration)
  })

  it('rejects future observations relative to the supplied read clock', () => {
    expect(() => mapWarmupSession(record(), at(1))).toThrow(ReaderFault)
  })

  it('does not mix exercise epochs with signed raw pose offsets or the training clock', () => {
    const input = record()
    const result = mapWarmupSession(input, NOW)
    const knee = result.summary.evidence.find(item => item.subject.id === 'knee_raise')!
    expect(knee.window.start.domain).toBe('training-monotonic-ms')
    expect(knee.window.start.value).toBeLessThan(input.startedAt)
    expect(knee.window.start).toMatchObject({ clockId: `warmup:${input.id}` })
  })
})

describe('warm-up reader scoring projection', () => {
  it('uses the existing explanation and valid-sample analysis instead of stored aggregate scores', () => {
    const input = record()
    const expected = analyzeTraining(input, []).exercises.find(item => item.exerciseId === 'squat')!
    const mapped = mapWarmupSession(input, NOW)
    const evidence = mapped.summary.evidence.find(item => item.subject.id === 'squat')!
    expect(evidence.score).toMatchObject({ scoreKind: 'warmup-standard', scoringVersion: 'scoring-v2.1', status: 'available', value: expected.score })
    expect(evidence.score.value).not.toBe(input.exercises.find(item => item.exerciseId === 'squat')!.overallScore)
    expect(evidence.quality.sampleCount).toBe(expected.reps.analyzed)
    expect(expected.activeDurationMs).toBeGreaterThan(0)
    expect(mapped.details.find(item => item.evidenceId === evidence.id)!.explanation).toMatchObject({ activeDurationMs: expected.activeDurationMs })
    expect(mapped.summary.activeDurationMs).toBeNull()
  })

  it('retains real zero scores when enough valid samples exist', () => {
    const input = record()
    const exercise = input.exercises.find(item => item.exerciseId === 'squat')!
    exercise.repetitions.forEach(item => { item.score = 0 })
    expect(mapWarmupSession(input, NOW).summary.evidence.find(item => item.subject.id === 'squat')!.score).toMatchObject({ status: 'available', value: 0 })
  })

  it('keeps low sample count distinct from a zero score', () => {
    const input = record()
    input.exercises.find(item => item.exerciseId === 'squat')!.repetitions.length = 2
    const result = mapWarmupSession(input, NOW)
    expect(result.summary.evidence.find(item => item.subject.id === 'squat')!.score).toMatchObject({ status: 'insufficient', value: null })
    expect(result.limitations).toContain('INSUFFICIENT_SCORING_EVIDENCE:squat')
  })

  it('keeps invalid and partial sample counts from the existing analysis', () => {
    const invalid = mapWarmupSession(INVALID_REPS, NOW)
    const detail = invalid.details.find(item => item.evidenceId.includes('overhead_raise'))!
    expect(detail.explanation).toMatchObject({ sampleCounts: { invalid: 3, analyzed: 3 } })
    const partial = mapWarmupSession(MISSING_TOP_ELBOW, NOW)
    expect(partial.details.find(item => item.evidenceId.includes('overhead_raise'))!.explanation).toMatchObject({ sampleCounts: { partial: 3 } })
  })

  it('keeps guidance numeric observations separate from the nonnumeric guidance score', () => {
    const input = record()
    input.exercises[0].guidanceSummary = { samples: 8, metrics: { amplitude: { value: 30, score: 60 } }, errorFrames: { MOTION_TOO_SMALL: 2 } }
    const result = mapWarmupSession(input, NOW)
    const guidance = result.summary.evidence.find(item => item.subject.id === 'shoulder_rotation')!
    expect(guidance.score).toEqual({ scoreKind: 'guidance', scale: 'none', status: 'guidance', value: null, scoringVersion: null, rulesVersion: null })
    expect(guidance.quality.sampleCount).toBe(8)
    expect(result.details[0].explanation).toMatchObject({ guidance: expect.arrayContaining([expect.objectContaining({ value: 30 })]) })
  })

  it('rejects exchanging guidance and scored exercise kinds', () => {
    const input = record()
    input.exercises[0].evaluationMode = 'scored'
    reject(input)
    const other = record()
    other.exercises.find(item => item.exerciseId === 'squat')!.evaluationMode = 'guidance'
    reject(other)
  })

  it('keeps official requirements distinct from engineering numeric threshold provenance', () => {
    const result = mapWarmupSession(record(), NOW)
    const detail = result.details.find(item => item.evidenceId.includes('squat'))!
    expect(detail.explanation).toMatchObject({ thresholdsCalibrated: true, criteria: expect.arrayContaining([expect.objectContaining({ sourceType: 'OFFICIAL_GUIDANCE', thresholdSource: 'FORMPILOT_CALIBRATED', phase: expect.any(String) })]) })
    expect(detail.recordPaths).toEqual(['$.exercises[4].repetitions'])
  })

  it.each([undefined, { spec: 'future-rules', threshold: 'future-calibration' }])('does not apply current explanations to absent or unknown original rules %j', rulesVersion => {
    const input = record()
    input.rulesVersion = rulesVersion
    const result = mapWarmupSession(input, NOW)
    expect(result.summary.evidence.filter(item => item.score.scoreKind === 'warmup-standard').every(item => item.score.status === 'missing' && item.score.value === null && item.criterionIds.length === 0)).toBe(true)
    expect(result.metadata.rulesVersion).toEqual(rulesVersion ?? null)
    expect(result.metadata.analysisVersion).toBeNull()
    expect(result.limitations.join(' ')).toContain(rulesVersion ? 'RULES_UNSUPPORTED' : 'RULES_UNVERSIONED')
  })

  it('does not project videos, landmarks, feedback text or arbitrary payload fields', () => {
    const input = record()
    const raw = input as unknown as Record<string, unknown>
    raw.localVideo = 'private-video.mp4'
    raw.landmarks = [{ privatePoseMarker: 1 }]
    ;(firstRep(input) as unknown as Record<string, unknown>).privateMetadata = 'private-marker'
    const serialized = JSON.stringify(mapWarmupSession(raw, NOW))
    expect(serialized).not.toMatch(/private-video|privatePoseMarker|private-marker|localVideo|landmarks/)
  })

  it('is deterministic and leaves the input storage snapshot unchanged', () => {
    const input = record()
    const original = structuredClone(input)
    const first = mapWarmupSession(input, NOW)
    expect(mapWarmupSession(input, NOW)).toEqual(first)
    expect(input).toEqual(original)
    first.metadata.exerciseOrder = []
    first.summary.evidence[1].score.value = 0
    expect(input).toEqual(original)
    expect(mapWarmupSession(input, NOW).metadata.exerciseOrder).toEqual(original.exerciseOrder)
  })

  it('preserves a maximum-size original session identifier with bounded deterministic evidence and clock references', () => {
    const input = record()
    input.id = 's'.repeat(128)
    const result = mapWarmupSession(input, NOW)
    expect(result.summary.sessionId).toBe(input.id)
    expect(new Set(result.summary.evidence.map(item => item.id)).size).toBe(6)
    expect(result.summary.evidence.every(item => item.id.length <= 128 && item.recordRef.id === input.id)).toBe(true)
    expect(validateTrainingSessionSummary(result.summary).ok).toBe(true)
  })
})
