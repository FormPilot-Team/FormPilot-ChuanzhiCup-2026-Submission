import type { CoachContext, RecentReportSummary } from '../coachContext/types'

/**
 * AI Coach Lite: a context-aware preset coach. It answers a fixed set of questions (plus simple keyword matching)
 * from what FormPilot measured and already shows — the live training context, report data and recent history. It
 * never calls a language model and never invents a finding, a score or a diagnosis.
 */

export type CoachPage = 'home' | 'history' | 'training' | 'report' | 'workshop'

/** One report reduced to what the coach may say about it. Every field comes from the report's own data. */
export interface ReportDigest {
  kind: 'warm-up' | 'routine' | 'custom'
  /** e.g. 热身训练 · 完整训练, 八段锦 · 整套跟练, 我的动作 · 侧平举 */
  title: string
  startedAt: number
  complete: boolean
  /** e.g. 完成 6 / 6 个动作 · 跟练了 92% · 完成 8 / 10 次 */
  completionText: string
  /** The report's main number, only when it has one (no score is invented for custom actions). */
  result: { label: string; value: string } | null
  biggestIssue: { title: string; detail: string; value?: string } | null
  nextFocus: { title: string; detail: string; target?: string; href?: string } | null
  comparison: { text: string; direction: 'up' | 'down' | 'flat' } | null
  /** Why there is no comparison, in the report's words. */
  comparisonReason: string | null
  strengths: string[]
  reportPath: string
  /**
   * Scoring v2: why the result is what it is — score parts, the biggest deductions with the measured value and
   * phase, and where each requirement / number comes from. Null when the report has no score (我的动作).
   */
  scoreExplanation: ScoreExplanationDigest | null
}

export interface ScoreExplanationDigest {
  /** e.g. 综合评分 82 分 = 5 个计分动作的平均 / 动作规范评价 86（与跟练相似度分开计算）. */
  summary: string
  parts: Array<{ label: string; value: string }>
  deductions: Array<{ title: string; evidence: string; cue: string; basis: string }>
  /** Which parts are official movement requirements and which are FormPilot's numbers. */
  source: string
}

/** How to perform the current exercise, from its definition (never generated). */
export interface CoachExerciseGuide {
  howTo: string
  keyPoints: string[]
  /** What FormPilot checks during this exercise, in user language. */
  checks: string[]
}

export type CoachPageContext =
  | { page: 'home' | 'history'; recent: ReadonlyArray<RecentReportSummary>; latest: ReportDigest | null; week: { count: number; previous: number } | null }
  | { page: 'training'; live: CoachContext; guide: CoachExerciseGuide }
  | { page: 'report'; digest: ReportDigest }
  | { page: 'workshop' }

export interface CoachAnswer {
  text: string
  facts?: Array<{ label: string; value: string }>
  link?: { label: string; href: string }
  /** Where the answer comes from, e.g. 依据：本次训练报告. */
  basis?: string
}
