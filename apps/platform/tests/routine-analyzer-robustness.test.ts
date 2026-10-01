import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRoutineAnalysisRecord } from '../src/features/routines/analyzers/analysisRecord'
import { createRoutineAnalysis } from '../src/features/routines/analyzers/registry'
import type { RoutineAnalysisRecord } from '../src/features/routines/analyzers/analysisRecord'
import type { ReferencePoint } from '../src/features/routines/followAlong/referenceTrack'
import { getRoutineProgram } from '../src/features/routines/programs'
import { buildRoutineReport } from '../src/features/routines/report/routineReport'
import { LocalStorageRoutineSessionRepository } from '../src/features/routines/session/RoutineSessionRepository'
import type { RoutineId } from '../src/features/routines/types'
import { standingPose } from './helpers/routineFixtures'
import { replayRoutine, ROUTINE_IDS, standardTrack } from './helpers/routineReplay'

/** Every number an analyzer stores must be finite or null, and every score within 0–100. */
function expectSane(record: RoutineAnalysisRecord | undefined) {
  expect(isRoutineAnalysisRecord(record)).toBe(true)
  expect(JSON.parse(JSON.stringify(record))).toEqual(record)
  const visit = (value: unknown, path: string) => {
    if (typeof value === 'number') expect(Number.isFinite(value), path).toBe(true)
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`))
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`)
  }
  visit(record, 'analysis')
  for (const chapter of record?.chapters ?? []) {
    const score = chapter.evaluation?.score
    if (score !== null && score !== undefined) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  }
}

const FORMS: Readonly<Record<RoutineId, string>> = { baduanjin: 'bdj-2', taijiquan: 'tjq-4', wuqinxi: 'wqx-4', yijinjing: 'yjj-3' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('routine analyzers: unusual input', () => {
  for (const id of ROUTINE_IDS) {
    it(`${id}: a user standing still, landmarks with NaN, and gaps stay finite and in range`, () => {
      const scope = { kind: 'form' as const, chapterId: FORMS[id] }
      expectSane(replayRoutine(id, { scope, userPose: () => standingPose() }).record.analysis)
      const broken = (landmarks: ReadonlyArray<ReferencePoint>, _video: number, index: number) => landmarks.map((point, landmark) => (index % 7 === 0 && landmark % 3 === 0 ? { ...point, x: Number.NaN } : point))
      expectSane(replayRoutine(id, { scope, transform: broken }).record.analysis)
      expectSane(replayRoutine(id, { scope, dropped: (_video, index) => index % 50 < 15 }).record.analysis)
    })

    it(`${id}: seeks backwards and fast mode (8× video) neither throw nor produce invalid records`, () => {
      const program = getRoutineProgram(id)
      const track = standardTrack(id)
      const engine = createRoutineAnalysis(program, { kind: 'full' }, track)!
      const chapter = program.chapters.find((item) => item.id === FORMS[id])!
      const aspect = track.width / track.height
      const frames = track.frames.filter((frame) => frame.t >= chapter.startSeconds && frame.t < chapter.endSeconds && frame.landmarks.length)
      let now = 0
      // Normal speed through the first half, a jump back to the start, then 8× (0.8 s of video per 0.1 s tick).
      for (const frame of frames.slice(0, frames.length / 2)) engine.observe(frame.t, (now += 100), { landmarks: frame.landmarks, confidence: frame.confidence, aspect })
      for (let index = 0; index < frames.length; index += 8) engine.observe(frames[index].t, (now += 100), { landmarks: frames[index].landmarks, confidence: frames[index].confidence, aspect })
      expectSane(engine.snapshot())
      expect(() => engine.live()).not.toThrow()
    })
  }
})

describe('routine analyzers: cost and storage', () => {
  for (const id of ROUTINE_IDS) {
    it(`${id}: a full routine stays small in the record and cheap to evaluate`, () => {
      const run = replayRoutine(id)
      const engine = run.analysis!
      const analysis = run.record.analysis!
      expectSane(analysis)
      const bytes = JSON.stringify(analysis).length
      // A full routine fits easily in localStorage next to the 30-record retention.
      expect(bytes).toBeLessThan(50_000)
      // Snapshot of every chapter from scratch (the engine caches per chapter; a fresh engine is the worst case).
      const fresh = createRoutineAnalysis(run.program, run.scope, standardTrack(id))!
      const track = standardTrack(id)
      const aspect = track.width / track.height
      const started = performance.now()
      let ticks = 0
      for (const frame of track.frames) {
        if (!frame.landmarks.length) continue
        fresh.observe(frame.t, frame.t * 1000, { landmarks: frame.landmarks, confidence: frame.confidence, aspect })
        ticks += 1
      }
      const observeMs = (performance.now() - started) / ticks
      const snapshotStarted = performance.now()
      fresh.snapshot()
      const snapshotMs = performance.now() - snapshotStarted
      const liveStarted = performance.now()
      for (let index = 0; index < 20; index += 1) fresh.live()
      const liveMs = (performance.now() - liveStarted) / 20
      console.info(`[analyzer cost] ${id}: record ${bytes} B, observe ${observeMs.toFixed(3)} ms/tick, full snapshot ${snapshotMs.toFixed(1)} ms, live ${liveMs.toFixed(2)} ms`)
      expect(observeMs).toBeLessThan(2)
      expect(snapshotMs).toBeLessThan(1000)
      expect(liveMs).toBeLessThan(50)
      expect(engine.snapshot()).toEqual(analysis)
    })
  }

  it('saves the analysis with the session and reads it back into the report', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } })
    const run = replayRoutine('taijiquan', { scope: { kind: 'form', chapterId: 'tjq-3' } })
    const repository = new LocalStorageRoutineSessionRepository()
    expect(repository.save(run.record)).toBe(true)
    const saved = repository.get(run.record.id)!
    expect(saved.analysis).toEqual(run.record.analysis)
    const report = buildRoutineReport(saved)!
    expect(report.analysis?.title).toBe('太极拳连续性')
    expect(report.analysis?.chapters.map((item) => item.chapterId)).toEqual(['tjq-3'])
  })
})
