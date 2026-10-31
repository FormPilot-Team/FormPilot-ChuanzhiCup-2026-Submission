import { calculateSquatMetrics, weightedSquatScore } from '../../exercises/squat/scoring'
import type { SquatStateSnapshot } from '../../exercises/squat/stateMachine'
import type { SquatRepSummary } from '../../exercises/types'
import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../../exercises/thresholdVersioning'
import type { TrainingSessionState, RepetitionResult } from '../../training/types'
import { SESSION_STORAGE_KEY } from '../../training/LocalStorageTrainingSessionRepository'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../routines/session/RoutineSessionRepository'
import { RoutineProgressRecorder } from '../../routines/session/RoutineProgressRecorder'
import { FOLLOW_ALONG_CONFIG } from '../../routines/followAlong/matcher'
import { findRoutineProgram } from '../../routines/programs'
import type { RoutineSessionRecord } from '../../routines/session/types'

const DAY = 86_400_000
const START = 1_780_000_000_000

/** Synthetic observations use the existing scoring functions, never a Lab score formula. */
function squatSession(id: string, day: number, maxHipDrop: number, maxTorsoLean: number): TrainingSessionState {
  const startedAt = START + day * DAY
  const repetitions: RepetitionResult[] = Array.from({ length: 6 }, (_, index) => {
    const repStart = 50_000 + index * 6000
    const durationMs = 4000 + ((index * 137) % 300) - 150
    const rep: SquatRepSummary = {
      exerciseId: 'squat', repIndex: index + 1, startedAt: repStart,
      completedAt: repStart + durationMs, durationMs, maxTorsoLean,
      bottomTime: repStart + durationMs / 2, maxHipDrop,
      minKneeSpreadRatio: 0.86, maxKneeHeightDiff: 0.05,
      depthScore: 0, stabilityScore: 0, symmetryScore: 0,
      completionScore: 100, tempoScore: 0, overallScore: 0, errors: [],
    }
    const metrics = calculateSquatMetrics({ completedRep: rep, phase: 'COMPLETE' } as unknown as SquatStateSnapshot,
      { hipDrop: 0, kneeSpreadRatio: 1, kneeHeightDiff: 0, torsoLean: 0, timestamp: rep.completedAt })
    rep.depthScore = metrics.amplitude.score
    rep.stabilityScore = metrics.stability.score
    rep.symmetryScore = metrics.symmetry.score
    rep.tempoScore = metrics.tempo.score
    rep.overallScore = weightedSquatScore(metrics)
    return { rep, metrics, score: rep.overallScore, errors: [] }
  })
  return {
    schemaVersion: 2, id, source: 'synthetic', mode: 'normal',
    rulesVersion: { spec: EXERCISE_SPEC_VERSION, threshold: ENGINEERING_THRESHOLD_VERSION },
    startedAt, endedAt: startedAt + 600_000, status: 'completed', courseStatus: 'incomplete',
    exerciseOrder: ['squat'], activeExerciseId: 'squat', exercises: [{
      exerciseId: 'squat', startedAt, endedAt: startedAt + 60_000,
      repetitions, metricAverages: {}, overallScore: repetitions[0].score,
      topErrors: [], feedbackEvents: [], evaluationMode: 'scored', targetType: 'reps', targetValue: 6,
    }],
  }
}

/** In-memory only. No browser globals, persistence, cameras, media or network. */
export function createLabSyntheticFixture() {
  const warmup = [
    squatSession('synthetic-squat-before', 1, 0.1, 30),
    squatSession('synthetic-squat-current', 2, 0.15, 25),
  ]
  const program = findRoutineProgram('baduanjin')!
  const chapter = program.chapters.find(item => item.kind === 'form')!
  const scope = { kind: 'form' as const, chapterId: chapter.id }
  const recorder = new RoutineProgressRecorder(program, scope)
  for (let second = Math.floor(chapter.startSeconds); second < chapter.endSeconds; second += 1) recorder.markPlayback(second, second)
  for (let sample = 0; sample < 20; sample += 1) recorder.recordComparison(chapter.startSeconds + 0.5, {
    status: 'in_sync', similarity: 0.8, timingOffsetMs: 0,
    matchedAt: chapter.startSeconds + 0.5, videoTime: chapter.startSeconds + 0.5,
    regionScores: { arms: 0.8, torso: 0.8, legs: 0.8 }, mirrored: false,
  })
  const routine: RoutineSessionRecord = {
    schemaVersion: 1, kind: 'routine', id: 'synthetic-baduanjin',
    programId: program.id, programVersion: program.version, scope,
    source: 'synthetic', mode: 'normal', matcher: { version: FOLLOW_ALONG_CONFIG.version, available: true },
    startedAt: START + 3 * DAY, endedAt: START + 3 * DAY + 600_000,
    activeMs: 60_000, outcome: 'completed', chapters: recorder.snapshot(),
  }
  const records = new Map([
    [SESSION_STORAGE_KEY, JSON.stringify(warmup)],
    [ROUTINE_SESSION_STORAGE_KEY, JSON.stringify([routine])],
  ])
  return Object.freeze({
    storage: Object.freeze({ getItem: (key: string) => records.get(key) ?? null }),
    now: () => START + 30 * DAY,
  })
}
