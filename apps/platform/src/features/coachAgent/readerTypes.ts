import type { ScoringEvidence, TrainingSessionSummary } from './contracts'

export type ReaderErrorCode = 'NOT_FOUND' | 'UNAVAILABLE' | 'CORRUPT' | 'UNSUPPORTED_VERSION'
  | 'INSUFFICIENT_DATA' | 'INVALID_INPUT' | 'PERMISSION_DENIED'
export interface ReaderProblem { code: ReaderErrorCode; path: string; message: string }
export type ReaderResult<T> = { ok: true; data: T } | { ok: false; error: ReaderProblem }
export type SessionKind = 'warmup' | 'routine'

/** Supplied by application composition, never by model arguments. No write capability. */
export interface CoachReadDependencies {
  storage: { getItem(key: string): string | null }
  now: () => number
}

export interface EvidenceDetail {
  evidenceId: string
  /** JSON paths in the original session; values are a bounded, local explanation projection. */
  recordPaths: string[]
  explanation: unknown
}

/** Local reader output; explanation is separate from the unchanged Phase 1A contract. */
export interface MappedSession {
  summary: TrainingSessionSummary
  details: EvidenceDetail[]
  limitations: string[]
  /** Allowlisted record metadata only. No frames, landmarks or video files. */
  metadata: Record<string, unknown>
}

export interface SessionSnapshot extends MappedSession {
  trust: 'reader-validated'
  storage: { key: string; index: number; schemaVersion: number }
}

export interface HistorySnapshot {
  state: 'EMPTY' | 'PRESENT'
  sessions: SessionSnapshot[]
}

export interface EvidenceSnapshot {
  state: 'AVAILABLE' | 'PARTIAL'
  evidence: ScoringEvidence[]
  details: EvidenceDetail[]
  limitations: string[]
}

export class ReaderFault extends Error {
  constructor(readonly code: ReaderErrorCode, readonly path: string, message: string) {
    super(message)
  }
}

export function readerFailure(error: unknown): { ok: false; error: ReaderProblem } {
  return { ok: false, error: error instanceof ReaderFault
    ? { code: error.code, path: error.path, message: error.message }
    : { code: 'CORRUPT', path: '$', message: 'Record failed validation or analysis.' } }
}
