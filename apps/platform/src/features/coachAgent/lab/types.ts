import type { CoachAnswer } from '../answer'
import type { CoachProvider } from '../provider'
import type { CoachProvenance, CoachScore } from '../contracts'
import type { SessionKind } from '../readerTypes'

export type LabMode = 'mock' | 'local'
export type LabDataSource = 'synthetic' | 'local'
export type LabStatus = 'idle' | 'ready' | 'running' | 'answered' | 'insufficient' | 'failed' | 'cancelled' | 'timeout'
export interface LabSession {
  id: string
  kind: SessionKind
  source: CoachProvenance['source']
  mode: CoachProvenance['mode']
  startedAt: number
  evidenceCount: number
  scoreKinds: CoachScore['scoreKind'][]
  versions: string[]
  limitations: string[]
}
export interface LabProblem { code: string; message: string }
export interface LabComparison { requestId: string; gate: 'FULL' | 'PARTIAL' | 'NONE'; reason: string | null }
/** Deliberately excludes raw records and every bootstrap/session/model credential. */
export interface CoachLabState {
  mode: LabMode
  dataSource: LabDataSource
  kind: SessionKind
  sessions: readonly LabSession[]
  currentSessionId: string | null
  allowedSessionIds: readonly string[]
  localConsent: boolean
  disclosureConsent: boolean
  inferenceConsent: boolean
  localConfigured: boolean
  question: string
  status: LabStatus
  result: CoachAnswer | null
  comparisons: readonly LabComparison[]
  problem: LabProblem | null
  localLoaded: boolean
}
export interface LabProviderConfiguration {
  mode: LabMode
  kind: SessionKind
  sessionId: string
  historyLimit: number
  local?: { endpoint: string; bootstrapToken: string }
}
export interface CoachLabDependencies {
  /** Lazy: it must not access window.localStorage before a user explicitly loads it. */
  getLocalStorage?: () => { getItem(key: string): string | null }
  now?: () => number
  timeoutMs?: number
  /** Trusted composition/test seam, never supplied by a model, URL or browser global. */
  providerFactory?: (configuration: LabProviderConfiguration) => CoachProvider
}
export interface CoachLabController {
  getSnapshot(): CoachLabState
  subscribe(listener: () => void): () => void
  setMode(mode: LabMode): void
  setDataSource(source: LabDataSource): void
  setKind(kind: SessionKind): void
  setLocalConsent(consent: boolean): void
  loadLocalSessions(): void
  selectCurrentSession(sessionId: string | null): void
  setAllowedSessions(sessionIds: readonly string[]): void
  setQuestion(question: string): void
  setDisclosureConsent(consent: boolean): void
  setInferenceConsent(consent: boolean): void
  configureLocal(configuration: { endpoint: string; bootstrapToken: string }): boolean
  run(): Promise<void>
  cancel(): void
  clear(): void
  dispose(): void
}
