import type { AgentToolResult, CoachScore, DataProvenance, MotionSubject, ScoringEvidence } from './contracts'
import type { EvidenceDetail, ReaderErrorCode, ReaderProblem, SessionKind } from './readerTypes'
import type { CoachSessionReader, ComparisonSnapshot } from './sessionReader'

export type DispatcherTool = 'read_session' | 'read_history' | 'read_scoring_evidence'
export interface ToolQuery { kind: SessionKind; sessionId?: string; subject?: MotionSubject; limit?: number }
export interface ToolIntent { tool: DispatcherTool; query: ToolQuery }

/** Trusted application configuration, never a provider argument. No implicit grants. */
export interface CoachAuthorization {
  principalId: string
  tools: readonly DispatcherTool[]
  sessions: Partial<Record<SessionKind, readonly string[]>>
  maxHistory: number
}

export type DispatchErrorCode = ReaderErrorCode | 'NOT_ALLOWED' | 'CANCELLED' | 'TIMEOUT'
  | 'DUPLICATE_CALL' | 'BUDGET_EXCEEDED'
export interface DispatchProblem {
  code: DispatchErrorCode
  message: string
  retryable: boolean
  /** Private local diagnostic; never include it in provider context. */
  readerProblem?: ReaderProblem
}

export interface EvidenceTrace {
  requestId: string
  evidenceId: string
  sessionId: string
  scoreKind: CoachScore['scoreKind']
  scoringVersion: string | null
  recordRef: ScoringEvidence['recordRef']
  provenance: DataProvenance
  recordPaths: string[]
}

/** Owned local receipt. Only an explicit minimal projection may reach a provider. */
export interface DispatchReceipt {
  ok: boolean
  requestId: string
  tool: DispatcherTool | null
  query: ToolQuery | null
  result: AgentToolResult | null
  problem: DispatchProblem | null
  evidence: EvidenceTrace[]
  limitations: string[]
  comparison: ComparisonSnapshot | null
  details: EvidenceDetail[]
}

export interface DispatcherOptions {
  reader: CoachSessionReader
  authorization?: CoachAuthorization
  now: () => number
  maxCalls?: number
  timeoutMs?: number
}

export interface CoachToolDispatcher {
  dispatch(intent: unknown, options?: { signal?: AbortSignal }): Promise<DispatchReceipt>
  owns(receipt: unknown): receipt is DispatchReceipt
  remainingCalls(): number
}
