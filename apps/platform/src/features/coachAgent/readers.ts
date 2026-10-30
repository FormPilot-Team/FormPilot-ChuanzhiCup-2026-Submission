/** Explicit, opt-in read access. This module is not imported by the training runtime. */
export { createCoachSessionReader } from './sessionReader'
export type { CoachSessionReader, HistoryQuery, ComparisonQuery, ComparisonSnapshot, WarmupGate, RoutineGate } from './sessionReader'
export type {
  CoachReadDependencies, ReaderResult, ReaderProblem, ReaderErrorCode, SessionKind,
  SessionSnapshot, HistorySnapshot, EvidenceSnapshot, EvidenceDetail,
} from './readerTypes'
