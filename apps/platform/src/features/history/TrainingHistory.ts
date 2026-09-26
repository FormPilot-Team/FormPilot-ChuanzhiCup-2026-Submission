import { analyzeTraining, type TrainingAnalysis } from '../analysis'
import type { ExerciseId } from '../exercises/types'
import type { TrainingSessionRepository } from '../training/TrainingSessionRepository'
import { resolveTrainingScope, type TrainingScope } from '../training/trainingScope'
import type { TrainingSessionState } from '../training/types'

export interface TrainingHistoryItem {
  session: TrainingSessionState
  analysis: TrainingAnalysis
  /** Presentation label source (full course / free training); analysis never reads it. */
  scope: TrainingScope
  incomplete: boolean
  legacy: boolean
}

export interface TrainingTrendPoint {
  sessionId: string
  startedAt: number
  score: number
}

export interface RecurringTrainingIssue {
  id: string
  label: string
  sessionCount: number
  sampleSize: number
}

export interface TrainingHistoryOverview {
  available: boolean
  reliableSessionCount: number
  trendSessions: TrainingTrendPoint[]
  recurringIssues: RecurringTrainingIssue[]
}

export type TrainingHistoryLoadState =
  | { status: 'ready'; items: TrainingHistoryItem[]; overview: TrainingHistoryOverview }
  | { status: 'error' }

const EXERCISE_NAMES: Readonly<Record<string, string>> = {
  overhead_raise: '双臂上举',
  lateral_raise: '侧平举',
  step_jack: 'Step Jack',
  squat: '徒手深蹲',
  knee_raise: '交替提膝',
}

function compareIdsDescending(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? 1 : -1
}

export function compareHistorySessions(left: TrainingSessionState, right: TrainingSessionState): number {
  return right.startedAt - left.startedAt || compareIdsDescending(left.id, right.id)
}

export function isPrimaryHistorySession(session: TrainingSessionState): boolean {
  return session.source !== 'demo' && session.source !== 'synthetic' && session.mode !== 'fast'
}

/** Free training is finished when its one exercise reached the target and the session ended normally. */
function freeTrainingIncomplete(session: TrainingSessionState, analysis: TrainingAnalysis, exerciseId: ExerciseId): boolean {
  if (session.courseStatus !== 'completed') return true
  if (exerciseId === 'shoulder_rotation') return analysis.guidance.status !== 'completed'
  return analysis.exercises.find((item) => item.exerciseId === exerciseId)?.completion.status !== 'completed'
}

/** Course sessions keep analysis-v1's course completeness; free training is judged on its own exercise. */
export function isTrainingIncomplete(session: TrainingSessionState, analysis: TrainingAnalysis, scope: TrainingScope): boolean {
  return scope.kind === 'free_training' ? freeTrainingIncomplete(session, analysis, scope.exerciseId) : !analysis.courseComplete
}

export function buildTrainingHistoryItems(sessions: readonly TrainingSessionState[]): TrainingHistoryItem[] {
  const history = [...sessions]
  return history
    .filter(isPrimaryHistorySession)
    .sort(compareHistorySessions)
    .map((session) => {
      const analysis = analyzeTraining(session, history)
      const scope = resolveTrainingScope(session)
      return {
        session,
        analysis,
        scope,
        incomplete: isTrainingIncomplete(session, analysis, scope),
        legacy: analysis.dataQuality.rulesSupport === 'LEGACY_UNVERSIONED' || analysis.mode === 'unknown',
      }
    })
}

export function isReliableFullCourse(analysis: TrainingAnalysis): boolean {
  const flags = new Set(analysis.dataQuality.sessionFlags)
  return analysis.source === 'live'
    && analysis.mode === 'normal'
    && analysis.dataQuality.rulesSupport === 'SUPPORTED'
    && analysis.courseComplete
    && analysis.overall.scope === 'FULL_COURSE'
    && analysis.overall.score !== null
    && !flags.has('NOT_COURSE_FLOW')
    && !flags.has('NOT_FINALIZED')
}

export function historyScoreText(analysis: TrainingAnalysis, scope?: TrainingScope): string {
  if (scope?.kind === 'free_training' && scope.exerciseId === 'shoulder_rotation') return '热身引导 · 不计分'
  if (analysis.overall.scope === 'FULL_COURSE') return `综合评分 ${analysis.overall.score}`
  if (analysis.overall.scope === 'COMPLETED_EXERCISES') return `已完成动作平均分 ${analysis.overall.score}`
  return '暂无可靠评分'
}

export function historyComparisonText(analysis: TrainingAnalysis): string | null {
  if (analysis.comparison.level === 'PARTIAL') return '部分动作可对比'
  if (analysis.comparison.level !== 'FULL' || analysis.overall.delta === null || analysis.overall.trend === null) return null
  if (analysis.overall.trend === 'STABLE') return '基本持平'
  return analysis.overall.delta > 0 ? `↑ ${analysis.overall.delta}` : `↓ ${Math.abs(analysis.overall.delta)}`
}

function issueLabel(exerciseId: string, reportLabel: string): string {
  const exercise = EXERCISE_NAMES[exerciseId]
  return exercise ? `${exercise} · ${reportLabel}` : reportLabel
}

/** Pure multi-session presentation analysis. Input order never affects the result. */
export function buildTrainingHistoryOverview(analyses: readonly TrainingAnalysis[]): TrainingHistoryOverview {
  const reliable = analyses
    .filter(isReliableFullCourse)
    .sort((left, right) => right.sessionStartedAt - left.sessionStartedAt || compareIdsDescending(left.sessionId, right.sessionId))

  const recentTrend = reliable.slice(0, 10).reverse()
  const trendSessions = recentTrend.map((analysis) => ({
    sessionId: analysis.sessionId,
    startedAt: analysis.sessionStartedAt,
    score: analysis.overall.score as number,
  }))

  const issueCounts = new Map<string, { label: string; sessionCount: number }>()
  const recurringSample = reliable.slice(0, 5)
  for (const analysis of recurringSample) {
    const significant = new Map<string, string>()
    for (const exercise of analysis.exercises) {
      for (const issue of exercise.issues) {
        if (issue.significance === 'SIGNIFICANT') {
          significant.set(issue.canonicalId, issueLabel(issue.exerciseId, issue.reportLabel))
        }
      }
    }
    for (const [id, label] of significant) {
      const current = issueCounts.get(id)
      issueCounts.set(id, { label, sessionCount: (current?.sessionCount ?? 0) + 1 })
    }
  }

  const recurringIssues = [...issueCounts.entries()]
    .filter(([, issue]) => issue.sessionCount >= 2)
    .map(([id, issue]) => ({ id, label: issue.label, sessionCount: issue.sessionCount, sampleSize: recurringSample.length }))
    .sort((left, right) => right.sessionCount - left.sessionCount || left.label.localeCompare(right.label, 'zh-CN') || (left.id < right.id ? -1 : 1))

  return {
    available: reliable.length >= 3,
    reliableSessionCount: reliable.length,
    trendSessions,
    recurringIssues,
  }
}

export function loadTrainingHistory(repository: TrainingSessionRepository): TrainingHistoryLoadState {
  try {
    const items = buildTrainingHistoryItems(repository.list())
    return { status: 'ready', items, overview: buildTrainingHistoryOverview(items.map((item) => item.analysis)) }
  } catch {
    return { status: 'error' }
  }
}
