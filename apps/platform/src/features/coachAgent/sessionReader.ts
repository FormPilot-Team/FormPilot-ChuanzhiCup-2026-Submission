import { SESSION_STORAGE_KEY } from '../training/LocalStorageTrainingSessionRepository'
import { ROUTINE_SESSION_STORAGE_KEY } from '../routines/session/RoutineSessionRepository'
import { buildSessionFacts } from '../analysis/sessionFacts'
import { selectPreviousComparable } from '../analysis/comparison'
import { compareWithPrevious } from '../routines/report/routineReport'
import { findRoutineProgram } from '../routines/programs'
import type { MotionSubject } from './contracts'
import { validateTrainingSessionSummary } from './validation'
import { mapWarmupSession, validateWarmupRecord } from './warmupReader'
import { mapRoutineSession, validateRoutineRecord } from './routineReader'
import { ReaderFault, readerFailure } from './readerTypes'
import type {
  CoachReadDependencies, EvidenceSnapshot, HistorySnapshot, ReaderResult,
  SessionKind, SessionSnapshot,
} from './readerTypes'

const KEYS = { warmup: SESSION_STORAGE_KEY, routine: ROUTINE_SESSION_STORAGE_KEY }
const EXERCISES = ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise']
const ROUTINES = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']

export interface HistoryQuery { kind: SessionKind; subject?: MotionSubject; limit?: number }
export interface ComparisonQuery extends HistoryQuery { sessionId: string }
export interface ComparisonSnapshot {
  gate: 'FULL' | 'PARTIAL' | 'NONE'
  reason: string | null
  current: SessionSnapshot
  previous: SessionSnapshot[]
  /** Original gate output, with its own score-kind semantics. No cross-kind overall delta. */
  gates: Array<WarmupGate | RoutineGate>
  excluded: Array<{ sessionId: string; reasons: string[] }>
}

export type WarmupGate = ReturnType<typeof selectPreviousComparable>['comparison']
export type RoutineGate = ReturnType<typeof compareWithPrevious>

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 128
    || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    throw new ReaderFault('INVALID_INPUT', '$query', 'Expected a bounded session identifier.')
  }
}

function checkQuery(query: HistoryQuery): number {
  if (!query || !Object.hasOwn(KEYS, query.kind)) throw new ReaderFault('INVALID_INPUT', '$query.kind', 'Unknown session kind.')
  if (query.subject && (query.subject.kind !== (query.kind === 'warmup' ? 'exercise' : 'routine')
    || !(query.kind === 'warmup' ? EXERCISES : ROUTINES).includes(query.subject.id))) {
    throw new ReaderFault('INVALID_INPUT', '$query.subject', 'Subject does not belong to this session kind.')
  }
  const limit = query.limit ?? 20
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new ReaderFault('INVALID_INPUT', '$query.limit', 'Limit must be between 1 and 64.')
  return limit
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function matches(snapshot: SessionSnapshot, subject?: MotionSubject): boolean {
  if (!subject) return true
  if (subject.kind === 'routine') return snapshot.metadata.programId === subject.id
  return snapshot.summary.evidence.some(e => e.subject.kind === 'exercise' && e.subject.id === subject.id)
}

function projected(snapshot: SessionSnapshot, subject?: MotionSubject): SessionSnapshot {
  if (!subject) return snapshot
  const evidence = snapshot.summary.evidence.filter(e => e.subject.kind === subject.kind && e.subject.id === subject.id)
  const ids = new Set(evidence.map(e => e.id))
  return { ...snapshot, summary: { ...snapshot.summary, evidence }, details: snapshot.details.filter(d => ids.has(d.evidenceId)) }
}

/** Application-only composition boundary. Model input supplies query IDs, never dependencies or records. */
export function createCoachSessionReader(dependencies: CoachReadDependencies) {
  const owned = new WeakSet<object>()
  function seal<T>(value: T): T { freeze(value); if (value && typeof value === 'object') owned.add(value); return value }
  function run<T>(operation: () => T): ReaderResult<T> {
    try { return { ok: true, data: seal(operation()) } } catch (error) { return readerFailure(error) }
  }
  function load(kind: SessionKind) {
    checkQuery({ kind })
    let raw: string | null
    let capturedAt: number
    try {
      capturedAt = dependencies.now()
      raw = dependencies.storage.getItem(KEYS[kind])
    } catch (error) {
      throw new ReaderFault(error instanceof Error && error.name === 'SecurityError' ? 'PERMISSION_DENIED' : 'UNAVAILABLE', '$storage', 'Training storage could not be read.')
    }
    if (!Number.isSafeInteger(capturedAt) || capturedAt < 0 || capturedAt > 8_640_000_000_000_000) {
      throw new ReaderFault('UNAVAILABLE', '$clock', 'Trusted snapshot clock is unavailable.')
    }
    if (raw === null) return { records: [] as unknown[], sessions: [] as SessionSnapshot[] }
    if (typeof raw !== 'string' || raw.length > 8_388_608) throw new ReaderFault('CORRUPT', '$storage', 'Stored data exceeds the reader capacity.')
    let records: unknown
    try { records = JSON.parse(raw) as unknown } catch { throw new ReaderFault('CORRUPT', '$storage', 'Stored training JSON is invalid.') }
    if (!Array.isArray(records) || records.length > 256) throw new ReaderFault('CORRUPT', '$storage', 'Expected a bounded session array.')
    const seen = new Set<string>()
    const sessions = records.map((record: unknown, index) => {
      const mapped = kind === 'warmup' ? mapWarmupSession(record, capturedAt) : mapRoutineSession(record, capturedAt)
      const validated = validateTrainingSessionSummary(mapped.summary)
      if (!validated.ok) throw new ReaderFault('CORRUPT', `$[${index}].summary`, 'Mapped session failed the Phase 1A contract.')
      const id = validated.value.sessionId
      if (seen.has(id)) throw new ReaderFault('CORRUPT', `$[${index}].id`, 'Duplicate persisted session identifiers.')
      seen.add(id)
      const evidenceIds = new Set(validated.value.evidence.map(e => e.id))
      if (mapped.details.some(d => !evidenceIds.has(d.evidenceId))
        || new Set(mapped.details.map(d => d.evidenceId)).size !== mapped.details.length
        || mapped.details.length !== evidenceIds.size) {
        throw new ReaderFault('CORRUPT', `$[${index}].details`, 'Evidence explanation references do not resolve.')
      }
      return seal<SessionSnapshot>({ ...mapped, summary: validated.value, trust: 'reader-validated',
        storage: { key: KEYS[kind], index, schemaVersion: kind === 'warmup' ? 2 : 1 } })
    })
    return { records, sessions }
  }
  function locate(kind: SessionKind, id: string) {
    identifier(id)
    const loaded = load(kind)
    const current = loaded.sessions.find(s => s.summary.sessionId === id)
    if (!current) throw new ReaderFault('NOT_FOUND', '$query.sessionId', 'The requested training session does not exist.')
    return { ...loaded, current }
  }

  return {
    /** Membership is instance-local and cannot be obtained by deserializing model JSON. */
    owns(snapshot: unknown): boolean { return typeof snapshot === 'object' && snapshot !== null && owned.has(snapshot) },
    readSession(kind: SessionKind, sessionId: string): ReaderResult<SessionSnapshot> {
      return run(() => locate(kind, sessionId).current)
    },
    readHistory(query: HistoryQuery): ReaderResult<HistorySnapshot> {
      return run(() => {
        const limit = checkQuery(query)
        const { sessions } = load(query.kind)
        const selected = sessions.filter(s => matches(s, query.subject))
          .sort((a, b) => b.summary.startedAt.value - a.summary.startedAt.value || (a.summary.sessionId < b.summary.sessionId ? 1 : -1))
          .slice(0, limit)
        return { state: selected.length ? 'PRESENT' : 'EMPTY', sessions: selected.map(s => seal(projected(s, query.subject))) }
      })
    },
    readScoringEvidence(kind: SessionKind, sessionId: string): ReaderResult<EvidenceSnapshot> {
      return run(() => {
        const { current } = locate(kind, sessionId)
        if (!current.summary.evidence.length) throw new ReaderFault('INSUFFICIENT_DATA', '$evidence', 'This record has no traceable scoring observations.')
        const available = current.summary.evidence.some(e => e.score.status === 'available' || (e.score.scoreKind === 'guidance' && e.quality.sampleCount > 0))
        if (!available) throw new ReaderFault('INSUFFICIENT_DATA', '$evidence', 'Scoring observations are insufficient or their versions are unsupported.')
        return { state: current.limitations.length ? 'PARTIAL' : 'AVAILABLE', evidence: current.summary.evidence,
          details: current.details, limitations: current.limitations }
      })
    },
    compareHistory(query: ComparisonQuery): ReaderResult<ComparisonSnapshot> {
      return run(() => {
        const limit = checkQuery(query)
        const { current, records, sessions } = locate(query.kind, query.sessionId)
        const excluded: ComparisonSnapshot['excluded'] = []
        const none = (reason: string, gates: Array<WarmupGate | RoutineGate> = []): ComparisonSnapshot => ({ gate: 'NONE', reason,
          current: seal(projected(current, query.subject)), previous: [], gates, excluded })
        if (!matches(current, query.subject)) return none('SUBJECT_NOT_IN_SESSION')
        if (current.summary.provenance.source !== 'live' || current.summary.provenance.mode !== 'normal') return none('CURRENT_PROVENANCE_NOT_VERIFIED_LIVE_NORMAL')
        const prior = sessions.filter(s => s.summary.sessionId !== query.sessionId
          && (s.summary.startedAt.value < current.summary.startedAt.value
            || (query.kind === 'routine' && s.summary.startedAt.value === current.summary.startedAt.value && s.summary.sessionId < query.sessionId)))
        const eligible = prior.filter(s => {
          const reasons: string[] = []
          if (s.summary.provenance.source !== 'live' || s.summary.provenance.mode !== 'normal') reasons.push('PROVENANCE_NOT_VERIFIED_LIVE_NORMAL')
          if (!matches(s, query.subject)) reasons.push('SUBJECT_NOT_IN_SESSION')
          if (reasons.length) excluded.push({ sessionId: s.summary.sessionId, reasons })
          return !reasons.length
        })
        const previous: SessionSnapshot[] = []
        const gates: Array<WarmupGate | RoutineGate> = []
        let gate: ComparisonSnapshot['gate'] = 'FULL'
        let reason: string | null = null
        if (query.kind === 'warmup') {
          const rawCurrent = validateWarmupRecord(records[current.storage.index])
          let candidates = eligible.map(s => validateWarmupRecord(records[s.storage.index]))
          while (previous.length < limit) {
            const selection = selectPreviousComparable(buildSessionFacts(rawCurrent), candidates)
            gates.push(selection.comparison)
            excluded.push(...selection.comparison.excluded)
            if (!selection.previous) { if (!previous.length) reason = selection.comparison.reason; break }
            const selected = selection.previous.session.id
            candidates = candidates.filter(s => s.id !== selected)
            if (query.subject?.kind === 'exercise' && !selection.comparison.commonExerciseIds.some(id => id === query.subject?.id)) {
              excluded.push({ sessionId: selected, reasons: ['REQUESTED_EXERCISE_NOT_COMPARABLE'] }); continue
            }
            previous.push(seal(projected(sessions.find(s => s.summary.sessionId === selected)!, query.subject)))
            if (selection.comparison.level === 'PARTIAL') { gate = 'PARTIAL'; reason = selection.comparison.reason }
          }
        } else {
          const rawCurrent = validateRoutineRecord(records[current.storage.index])
          const program = findRoutineProgram(rawCurrent.programId)
          if (!program) return none('PROGRAM_UNAVAILABLE')
          let candidates = eligible.filter(s => {
            const same = s.metadata.matcherVersion === current.metadata.matcherVersion
            if (!same) excluded.push({ sessionId: s.summary.sessionId, reasons: ['MATCHER_VERSION_MISMATCH'] })
            return same
          }).map(s => validateRoutineRecord(records[s.storage.index]))
          while (previous.length < limit) {
            const selection = compareWithPrevious(rawCurrent, program, candidates)
            gates.push(selection)
            if (!selection.available || !selection.previousId) { reason = selection.reason; break }
            previous.push(seal(projected(sessions.find(s => s.summary.sessionId === selection.previousId)!, query.subject)))
            candidates = candidates.filter(s => s.id !== selection.previousId)
          }
          // Routine's native gate covers follow-along only, never technique or a warm-up overall score.
          gate = 'PARTIAL'
          if (previous.length) reason = 'ROUTINE_FOLLOW_ALONG_ONLY'
        }
        if (!previous.length) return none(reason ?? 'NO_COMPARABLE_HISTORY', gates)
        return { gate, reason: gate === 'FULL' ? null : reason, current: seal(projected(current, query.subject)), previous, gates, excluded }
      })
    },
  }
}

export type CoachSessionReader = ReturnType<typeof createCoachSessionReader>
