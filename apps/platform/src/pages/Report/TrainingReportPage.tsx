import {
  Activity, AlertTriangle, ArrowLeft, CalendarDays, ChevronDown, Clock3, Dumbbell, Gauge, History, Info, ShieldCheck,
  Target, TrendingUp,
} from 'lucide-react'
import { HISTORY_PATH, START_TRAINING_PATH, freeTrainingPath, trainingEntryPath } from '../../app/routes'
import { AICoach } from '../../components/aiCoach/AICoach'
import { AppHeader } from '../../components/layout/AppHeader'
import { customDigest, routineDigest, warmUpDigest } from '../../features/aiCoach/digests'
import { CapabilityRadar } from '../../components/report/CapabilityRadar'
import type {
  CapabilityDimensionAnalysis, ExerciseAnalysis, Finding, FocusItem, IssueAnalysis, PriorityIssue, TrainingAnalysis,
} from '../../features/analysis'
import { isTrainingIncomplete } from '../../features/history/TrainingHistory'
import { REPORT_EXERCISE_PRESENTATION } from '../../features/report/presentation'
import { freeTrainingLabel, resolveTrainingScope, type TrainingScope } from '../../features/training/trainingScope'
import type { TrainingSessionState } from '../../features/training/types'
import { cn } from '../../lib/cn'
import {
  CAPABILITY_EXPLANATIONS, EXERCISE_NAMES, FREE_TRAINING_COMPARISON_TEXT, comparisonRatioText, completionProgress, formatDate,
  formatDuration, formatShortDate, freeTrainingProgressText, freeTrainingSummary, freeTrainingUnscoredText, issueTrendText, ratioText,
  scoreTone, scoreTrendText,
} from './reportPresentation'
import { FocusCard, FocusPanel, MiniBar, ReportActions, ReportLayout, ReportSummary, SectionHeading, type ReportTakeaway } from './reportShell'
import { CustomActionReportView } from './CustomActionReportView'
import { RoutineReportView } from './RoutineReportView'
import { useCustomActionReport } from './useCustomActionReport'
import { useRoutineReport } from './useRoutineReport'
import { useTrainingReportAnalysis } from './useTrainingReportAnalysis'

function sessionDuration(session: TrainingSessionState): number | null {
  if (typeof session.totalDurationMs === 'number' && Number.isFinite(session.totalDurationMs)) return Math.max(0, session.totalDurationMs)
  if (typeof session.endedAt === 'number' && Number.isFinite(session.endedAt)) return Math.max(0, session.endedAt - session.startedAt)
  return null
}

function comparisonText(analysis: TrainingAnalysis): string {
  if (analysis.comparison.level === 'FULL' && analysis.comparison.previousStartedAt !== null) {
    return `对比 ${formatShortDate(analysis.comparison.previousStartedAt)}`
  }
  if (analysis.comparison.level === 'PARTIAL') {
    return `已与上次共同完成的 ${analysis.comparison.commonExerciseIds.length} 个动作进行对比`
  }
  return analysis.comparison.reasonText ?? '当前没有可用的历史对比。'
}

function focusTitle(focus: FocusItem, analysis: TrainingAnalysis): string {
  const priority = analysis.priorityIssues.find((item) => item.canonicalIds.some((id) => focus.canonicalIds.includes(id)))
  if (priority) return priority.reportLabel
  const issue = analysis.exercises.flatMap((exercise) => exercise.issues).find((item) => focus.canonicalIds.includes(item.canonicalId))
  return issue ? `${EXERCISE_NAMES[issue.exerciseId]} · ${issue.reportLabel}` : focus.exerciseIds.map((id) => EXERCISE_NAMES[id]).join('、')
}

function exerciseList(ids: readonly ExerciseAnalysis['exerciseId'][]): string {
  return ids.map((id) => EXERCISE_NAMES[id]).join('、')
}

/** The two first-screen takeaways, taken from the analysis: its top priority and its first focus item. */
function smartTakeaways(analysis: TrainingAnalysis): ReportTakeaway[] {
  if (analysis.dataQuality.rulesSupport === 'UNSUPPORTED') return []
  const items: ReportTakeaway[] = []
  const top = analysis.priorityIssues[0]
  if (top) {
    items.push({ label: '最大问题', text: top.kind === 'THEME' ? top.reportLabel : `${exerciseList(top.exerciseIds)} · ${top.reportLabel}`, tone: 'attention' })
  } else {
    const empty = analysis.summary.find((item) => item.slot === 'NO_PRIORITY' || item.slot === 'LIMITED_DATA')
    if (empty) items.push({ label: '最大问题', text: empty.text, tone: empty.slot === 'NO_PRIORITY' ? 'good' : 'attention' })
  }
  const focus = analysis.nextFocus[0]
  if (focus) items.push({ label: '下次重点', text: focus.exerciseIds.length > 1 ? focus.cue : `${exerciseList(focus.exerciseIds)}：${focus.cue}`, tone: 'focus' })
  return items
}

export function ReportHero({ analysis, session }: { analysis: TrainingAnalysis; session: TrainingSessionState }) {
  const scope = resolveTrainingScope(session)
  const freeExerciseId = scope.kind === 'free_training' ? scope.exerciseId : null
  const scored = analysis.overall.scope === 'FULL_COURSE' || analysis.overall.scope === 'COMPLETED_EXERCISES'
  const overallTrend = analysis.comparison.level === 'FULL' ? scoreTrendText(analysis.overall.trend, analysis.overall.delta) : null
  const complete = !isTrainingIncomplete(session, analysis, scope)
  const statusLabel = freeExerciseId
    ? `${freeTrainingLabel(freeExerciseId)} · ${complete ? '已完成' : '未完成'}`
    : analysis.courseComplete ? '训练完成' : '本次训练未完整完成'
  const overall = analysis.summary.find((item) => item.slot === 'OVERALL')
  const validReps = analysis.dataQuality.reps.valid + analysis.dataQuality.reps.partial
  return (
    <ReportSummary
      kind="smart"
      modeLabel={freeExerciseId ? '热身训练 · 自由训练' : '热身训练 · 完整训练'}
      complete={complete}
      statusLabel={statusLabel}
      title="热身训练报告"
      score={{
        value: scored ? analysis.overall.score : null,
        label: analysis.overall.scope === 'FULL_COURSE' ? '综合评分' : '已完成动作平均分',
        emptyText: freeExerciseId ? freeTrainingUnscoredText(freeExerciseId) : '暂不给出综合评分',
        tone: scored ? scoreTone(analysis.overall.score) : 'none',
        testId: 'overall-score-scope',
      }}
      trend={overallTrend ? { text: overallTrend, tone: analysis.overall.trend === 'DECLINED' ? 'down' : analysis.overall.trend === 'IMPROVED' ? 'up' : 'flat' } : null}
      summary={overall?.text}
      comparison={freeExerciseId ? FREE_TRAINING_COMPARISON_TEXT : comparisonText(analysis)}
      metrics={[
        freeExerciseId
          ? { icon: Target, label: '训练动作', value: `${REPORT_EXERCISE_PRESENTATION[freeExerciseId].name} · ${freeTrainingProgressText(analysis, freeExerciseId)}` }
          : { icon: Target, label: '完成动作', value: `${analysis.overall.completedExercises} / ${analysis.overall.totalExercises}`, progress: analysis.overall.totalExercises ? analysis.overall.completedExercises / analysis.overall.totalExercises : 0 },
        { icon: Clock3, label: '训练时间', value: formatDuration(sessionDuration(session)) },
        { icon: CalendarDays, label: '训练日期', value: formatDate(analysis.sessionStartedAt) },
        { icon: Activity, label: '有效动作', value: `${validReps} 次` },
      ]}
      takeaways={smartTakeaways(analysis)}
    />
  )
}

export function TrainingAnalysisSection({ analysis }: { analysis: TrainingAnalysis }) {
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="analysis-summary-title" data-testid="report-analysis-summary">
      <SectionHeading id="analysis-summary-title" icon={Activity} title="训练分析" description="依据本次有效动作与可比较历史，按证据顺序给出结论。" />
      <ol className="mt-4 space-y-2.5">
        {analysis.summary.map((sentence, index) => (
          <li key={`${sentence.slot}-${index}`} className="flex gap-3">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold tabular-nums text-blue-700">{index + 1}</span>
            <p className="max-w-4xl text-pretty text-sm leading-6 text-slate-700">{sentence.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function priorityEvidence(issue: PriorityIssue) {
  if (issue.kind === 'SIDE_PAIR') {
    return issue.members.map((member) => ({
      key: member.canonicalId,
      label: member.side === 'left' ? '左侧' : '右侧',
      value: ratioText(member.stats, member.unit),
    }))
  }
  if (issue.kind === 'THEME') {
    return issue.members.map((member) => ({
      key: member.canonicalId,
      label: EXERCISE_NAMES[member.exerciseId],
      value: ratioText(member.stats, member.unit),
    }))
  }
  const member = issue.members[0]
  return member ? [{ key: member.canonicalId, label: '本次', value: ratioText(member.stats, member.unit) }] : []
}

export function PriorityIssuesSection({ analysis }: { analysis: TrainingAnalysis }) {
  if (analysis.dataQuality.rulesSupport === 'UNSUPPORTED') return null
  const emptySentence = analysis.summary.find((item) => item.slot === 'NO_PRIORITY' || item.slot === 'LIMITED_DATA')
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="priority-title" data-testid="report-top-issues">
      <SectionHeading id="priority-title" icon={AlertTriangle} title="本次最需要关注" description="综合问题频率、历史变化与动作内变化排序，最多三项。" />
      {analysis.priorityIssues.length ? (
        <ol className="mt-4 space-y-3">
          {analysis.priorityIssues.map((issue) => {
            const statuses = [...new Set(issue.members.map((member) => issueTrendText(member.trend)).filter((item): item is string => item !== null))]
            return (
              <li key={issue.id} className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 sm:grid-cols-[32px_minmax(0,1fr)_minmax(150px,.6fr)]">
                <span className="grid size-8 place-items-center rounded-lg bg-coral-50 text-sm font-bold tabular-nums text-coral-600">{issue.rank}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-balance font-bold text-slate-950">{issue.reportLabel}</h3>
                    {statuses.map((status) => <span key={status} className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{status}</span>)}
                  </div>
                  <p className="mt-1.5 text-pretty text-sm leading-6 text-slate-600">{issue.cue}。</p>
                </div>
                <dl className="grid content-start gap-1.5">
                  {priorityEvidence(issue).map((item) => (
                    <div key={item.key} className="flex items-center justify-between gap-3 text-sm"><dt className="text-slate-500">{item.label}</dt><dd className="font-semibold tabular-nums text-slate-900">{item.value}</dd></div>
                  ))}
                </dl>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <p className="text-pretty text-sm font-semibold leading-6 text-slate-800">{emptySentence?.text}</p>
        </div>
      )}
    </section>
  )
}

function exerciseDelta(exercise: ExerciseAnalysis): string | null {
  if (exercise.previousScore === null || exercise.scoreDelta === null || exercise.scoreTrend === null) return null
  return scoreTrendText(exercise.scoreTrend, exercise.scoreDelta)
}

function tempoText(exercise: ExerciseAnalysis): string | null {
  if (exercise.tempo.direction === 'TOO_FAST') return '动作偏快'
  if (exercise.tempo.direction === 'TOO_SLOW') return '动作偏慢'
  if (exercise.tempo.direction === 'APPROPRIATE') return '大部分在建议时间范围'
  return null
}

function visibleExerciseIssues(exercise: ExerciseAnalysis): IssueAnalysis[] {
  const valuableTrends = new Set(['NEW', 'RESOLVED', 'IMPROVED', 'PERSISTENT', 'WORSENED'])
  return exercise.issues.filter((issue) => issue.significance === 'SIGNIFICANT'
    || (issue.comparison?.trend !== null && valuableTrends.has(issue.comparison?.trend ?? '')))
}

export function ExerciseReportCard({ exercise }: { exercise: ExerciseAnalysis }) {
  const delta = exerciseDelta(exercise)
  const issues = visibleExerciseIssues(exercise)
  const tempo = tempoText(exercise)
  return (
    <details className="group report-panel min-w-0 overflow-hidden" data-testid={`exercise-report-${exercise.exerciseId}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3.5 p-4 marker:content-none sm:p-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700" aria-hidden="true"><Dumbbell size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate font-bold text-slate-950">{exercise.displayName}</h3>
            <p className="shrink-0 text-lg font-bold tabular-nums text-slate-950">{exercise.score === null ? '—' : exercise.score}</p>
          </div>
          <div className="mt-1.5"><MiniBar value={exercise.score} tone={scoreTone(exercise.score)} /></div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
            <p className="tabular-nums text-slate-500">{completionProgress(exercise.completion)}</p>
            <p className={cn('font-medium', exercise.scoreTrend === 'DECLINED' ? 'text-amber-700' : 'text-slate-500')}>{delta ?? (exercise.completion.status === 'completed' ? '本次评分' : '数据未完整')}</p>
          </div>
        </div>
        <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-100 px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5">
        <p className="text-pretty text-sm font-medium leading-6 text-slate-800">{exercise.takeaway ?? (exercise.completion.status === 'not_started' ? '本次未开始该动作。' : '当前没有可展示的动作结论。')}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="text-sm font-bold text-slate-900">有效分析</h4>
            <p className="mt-1.5 text-sm tabular-nums text-slate-600">有效分析 {exercise.reps.analyzed} / {exercise.reps.recorded} 次</p>
            {exercise.reps.invalid > 0 ? <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">另有 {exercise.reps.invalid} 次因识别质量不足未纳入分析。</p> : null}
            {tempo ? <p className="mt-1.5 text-sm text-slate-600">动作速度：{tempo}</p> : null}
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">需要关注的变化</h4>
            {issues.length ? <ul className="mt-1.5 space-y-1.5">{issues.map((issue) => (
              <li key={issue.canonicalId} className="text-sm leading-6 text-slate-600">
                <span className="font-semibold text-slate-800">{issue.reportLabel}</span>
                {issue.stats ? `，${ratioText(issue.stats, issue.unit)}` : ''}
                {issueTrendText(issue.comparison?.trend ?? null) ? `，${issueTrendText(issue.comparison?.trend ?? null)}` : ''}
              </li>
            ))}</ul> : <p className="mt-1.5 text-sm text-slate-500">没有需要展开说明的问题变化。</p>}
          </div>
        </div>
        {exercise.withinExerciseImprovement ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-pretty text-sm leading-6 text-emerald-900">{exercise.withinExerciseImprovement.text}</p> : null}
      </div>
    </details>
  )
}

function GuidanceCard({ analysis }: { analysis: TrainingAnalysis }) {
  const status = analysis.guidance.status === 'completed' ? '已完成' : analysis.guidance.status === 'incomplete' ? '未完成' : '未开始'
  return (
    <details className="group report-panel min-w-0 overflow-hidden" data-testid="exercise-report-shoulder_rotation">
      <summary className="flex cursor-pointer list-none items-center gap-3.5 p-4 marker:content-none sm:p-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700" aria-hidden="true"><ShieldCheck size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3"><h3 className="font-bold text-slate-950">肩部环绕</h3><p className="shrink-0 font-bold text-slate-950">{status}</p></div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-xs"><p className="text-slate-500">热身引导</p><p className="text-slate-500">不计分</p></div>
        </div>
        <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-100 px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5">
        <p className="text-pretty text-sm leading-6 text-slate-600">本动作主要用于热身和动作引导，不计入综合评分，也不进入五维能力。</p>
      </div>
    </details>
  )
}

export function ExercisePerformanceSection({ analysis, scope }: { analysis: TrainingAnalysis; scope?: TrainingScope }) {
  // Free training shows only its own exercise; the other course steps were never part of it.
  const freeExerciseId = scope?.kind === 'free_training' ? scope.exerciseId : null
  const exercises = freeExerciseId ? analysis.exercises.filter((exercise) => exercise.exerciseId === freeExerciseId) : analysis.exercises
  const showGuidance = !freeExerciseId || freeExerciseId === 'shoulder_rotation'
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="exercise-performance-title" data-testid="report-exercises">
      <SectionHeading id="exercise-performance-title" icon={Dumbbell} title="动作表现" description={freeExerciseId ? '本次动作的评分、完成度与结论，需要时展开证据。' : '每个动作的评分、完成度与一句话结论，需要时展开证据。'} />
      <div className={cn('mt-4 grid items-start gap-3', !freeExerciseId && 'md:grid-cols-2 xl:grid-cols-3')}>
        {showGuidance ? <GuidanceCard analysis={analysis} /> : null}
        {exercises.map((exercise) => <ExerciseReportCard key={exercise.exerciseId} exercise={exercise} />)}
      </div>
    </section>
  )
}

function capabilityDisplayValue(dimension: CapabilityDimensionAnalysis): number | null {
  return dimension.comparison?.current ?? dimension.value
}

export function CapabilitySection({ analysis }: { analysis: TrainingAnalysis }) {
  if (!analysis.capability.available) return null
  const comparableRadar = analysis.capability.dimensions.length === 5 && analysis.capability.dimensions.every((item) => item.comparison !== null)
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="capability-title" data-testid="report-capabilities">
      <SectionHeading id="capability-title" icon={Gauge} title="能力表现" description="五项能力均来自已完成动作的有效贡献；缺失证据不会按 0 分处理。" />
      <div className="mt-4 grid items-center gap-6 lg:grid-cols-[minmax(280px,.75fr)_minmax(0,1.25fr)]">
        <div>
          {analysis.capability.radarAvailable ? <CapabilityRadar dimensions={analysis.capability.dimensions} /> : (
            <div className="rounded-xl bg-slate-50 p-6 text-center">
              <p className="font-semibold text-slate-800">本次暂不绘制能力图</p>
              <p className="mt-1 text-pretty text-sm leading-6 text-slate-500">五维数据尚未完整，下面仍会列出当前可用结果。</p>
            </div>
          )}
          {analysis.capability.radarAvailable ? <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-slate-600"><span className="inline-flex items-center gap-2"><i className="size-2.5 rounded-full bg-blue-600" />本次</span>{comparableRadar ? <span className="inline-flex items-center gap-2"><i className="size-2.5 rounded-full border-2 border-slate-400" />上次</span> : null}</div> : null}
        </div>
        <dl className="divide-y divide-slate-100">
          {analysis.capability.dimensions.map((dimension) => {
            const value = capabilityDisplayValue(dimension)
            const delta = dimension.comparison ? scoreTrendText(dimension.comparison.trend, dimension.comparison.delta) : null
            return (
              <div key={dimension.dimension} className="grid gap-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(110px,160px)_auto] sm:items-center sm:gap-4" data-testid={`capability-${dimension.dimension.toLowerCase()}`}>
                <div className="min-w-0"><dt className="font-bold text-slate-900">{dimension.label}</dt><p className="mt-0.5 text-pretty text-xs leading-5 text-slate-500">{CAPABILITY_EXPLANATIONS[dimension.dimension]}</p></div>
                <MiniBar value={value} tone={scoreTone(value)} />
                <dd className="flex items-baseline gap-2 sm:justify-end"><span className="text-lg font-bold tabular-nums text-slate-950">{value ?? '—'}</span>{value === null ? <span className="text-xs text-slate-500">有效数据不足</span> : delta ? <span className={cn('text-xs font-semibold', dimension.comparison?.trend === 'DECLINED' ? 'text-amber-700' : 'text-slate-600')}>{delta}</span> : null}</dd>
              </div>
            )
          })}
        </dl>
      </div>
    </section>
  )
}

function trendIssues(analysis: TrainingAnalysis): IssueAnalysis[] {
  const allowed = new Set(['NEW', 'RESOLVED', 'IMPROVED', 'PERSISTENT', 'WORSENED'])
  return analysis.exercises.flatMap((exercise) => exercise.issues).filter((issue) => allowed.has(issue.comparison?.trend ?? ''))
}

function countTrend(issues: readonly IssueAnalysis[], trend: string) {
  return issues.filter((issue) => issue.comparison?.trend === trend).length
}

function strengthFindings(analysis: TrainingAnalysis): Finding[] {
  return analysis.strengths.filter((finding) => ['EXERCISE_STRENGTH', 'CAPABILITY_STRENGTH', 'ISSUE_FREE_STRENGTH'].includes(finding.kind))
}

export function ProgressSection({ analysis }: { analysis: TrainingAnalysis }) {
  if (analysis.comparison.level === 'NONE') return null
  const changes = trendIssues(analysis)
  const strengths = strengthFindings(analysis)
  const scoreProgress = analysis.improvements.filter((finding) => finding.kind === 'HISTORICAL_SCORE_IMPROVED' || finding.kind === 'HISTORICAL_OVERALL_IMPROVED')
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="progress-title" data-testid="report-progress">
      <SectionHeading id="progress-title" icon={History} title="相比上次" description={analysis.comparison.level === 'FULL' ? '使用完整课程范围进行比较。' : `仅比较双方共同完成的 ${analysis.comparison.commonExerciseIds.length} 个动作，不比较综合评分。`} />
      <div className="mt-4 flex flex-wrap gap-2" aria-label="问题变化统计">
        <ProgressChip label="已改善" count={countTrend(changes, 'IMPROVED')} tone="positive" />
        <ProgressChip label="已解决" count={countTrend(changes, 'RESOLVED')} tone="positive" />
        <ProgressChip label="新出现" count={countTrend(changes, 'NEW')} tone="attention" />
        <ProgressChip label="持续存在" count={countTrend(changes, 'PERSISTENT')} tone="neutral" />
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="font-bold text-slate-950">变化明细</h3>
          {changes.length ? <ul className="mt-2.5 divide-y divide-slate-100">{changes.map((issue) => {
            const previous = issue.comparison?.previous
            return (
              <li key={issue.canonicalId} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{EXERCISE_NAMES[issue.exerciseId]} · {issue.reportLabel}</p><span className="text-xs font-semibold text-slate-500">{issueTrendText(issue.comparison?.trend ?? null)}</span></div>
                {previous && issue.stats ? <p className="mt-0.5 text-sm tabular-nums text-slate-500">{comparisonRatioText(previous, issue.stats, issue.unit)}</p> : null}
              </li>
            )
          })}</ul> : <p className="mt-2.5 text-sm text-slate-500">共同范围内暂无需要列出的动作问题变化。</p>}
          {scoreProgress.length ? <ul className="mt-3 space-y-1.5">{scoreProgress.map((finding) => <li key={finding.id} className="text-pretty text-sm leading-6 text-slate-600">{finding.text}</li>)}</ul> : null}
        </div>
        <div>
          <h3 className="font-bold text-slate-950">本次表现较好的地方</h3>
          {strengths.length ? <ul className="mt-2.5 space-y-2">{strengths.map((finding) => <li key={finding.id} className="rounded-xl bg-emerald-50 px-4 py-2.5 text-pretty text-sm leading-6 text-emerald-950">{finding.text}</li>)}</ul> : <p className="mt-2.5 text-sm leading-6 text-slate-500">当前证据没有形成独立的优势结论。</p>}
        </div>
      </div>
    </section>
  )
}

function ProgressChip({ label, count, tone }: { label: string; count: number; tone: 'positive' | 'attention' | 'neutral' }) {
  return <span className={cn('rounded-full px-3 py-1 text-sm font-semibold tabular-nums', tone === 'positive' ? 'bg-emerald-50 text-emerald-800' : tone === 'attention' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700')}>{label} {count}</span>
}

/** Why a focus item comes first, restated from the analysis evidence it was built from. */
function focusReason(focus: FocusItem, analysis: TrainingAnalysis): { value: string | null; reason: string | null } {
  if (focus.source === 'PRIORITY_ISSUE') {
    const priority = analysis.priorityIssues.find((item) => item.canonicalIds.some((id) => focus.canonicalIds.includes(id)))
    if (!priority) return { value: null, reason: null }
    const trends = [...new Set(priority.members.map((member) => issueTrendText(member.trend)).filter((item): item is string => item !== null))]
    const scopeText = priority.kind === 'SIDE_PAIR' ? '，左右两侧都有出现' : priority.kind === 'THEME' ? `，在${exerciseList(priority.exerciseIds)}中都有出现` : ''
    const member = [...priority.members].sort((left, right) => right.stats.affected - left.stats.affected)[0]
    return {
      value: member ? ratioText(member.stats, member.unit) : null,
      reason: `本次需要关注的问题中排第 ${priority.rank} 位${scopeText}${trends.length ? `；${trends.join('、')}` : ''}。`,
    }
  }
  const issue = analysis.exercises.flatMap((exercise) => exercise.issues).find((item) => focus.canonicalIds.includes(item.canonicalId))
  const dimension = issue ? analysis.capability.dimensions.find((item) => item.dimension === issue.dimension) : undefined
  const value = dimension ? capabilityDisplayValue(dimension) : null
  return dimension && value !== null
    ? { value: `${dimension.label} ${value}`, reason: `本次没有显著的动作问题，「${dimension.label}」是相对较弱的能力。` }
    : { value: null, reason: null }
}

export function NextFocusSection({ analysis, scope }: { analysis: TrainingAnalysis; scope?: TrainingScope }) {
  if (analysis.dataQuality.rulesSupport === 'UNSUPPORTED') return null
  const freeExerciseId = scope?.kind === 'free_training' ? scope.exerciseId : null
  return (
    <FocusPanel id="focus-title" testId="report-recommendations" description="把本次分析变成下一次可以直接执行的动作要求。">
      {analysis.nextFocus.length ? (
        <ol className={cn('grid gap-3', analysis.nextFocus.length > 1 && 'lg:grid-cols-2')}>
          {analysis.nextFocus.map((focus) => {
            const { value, reason } = focusReason(focus, analysis)
            const single = focus.exerciseIds.length === 1 ? focus.exerciseIds[0] : null
            return (
              <FocusCard
                key={`${focus.rank}-${focus.canonicalIds.join('-')}`}
                rank={focus.rank}
                eyebrow={exerciseList(focus.exerciseIds)}
                title={focusTitle(focus, analysis)}
                detail={`${focus.cue}。`}
                value={value}
                reason={reason}
                target={focus.target?.text ?? null}
                action={single ? { label: single === freeExerciseId ? `再练一次${EXERCISE_NAMES[single]}` : `单独练习${EXERCISE_NAMES[single]}`, href: freeTrainingPath(single) } : null}
              />
            )
          })}
        </ol>
      ) : <div className="rounded-xl bg-white/90 p-4 ring-1 ring-blue-100"><p className="text-sm font-semibold text-slate-800">本次没有需要优先纠正的问题。</p></div>}
    </FocusPanel>
  )
}

function missingEvidenceNotes(analysis: TrainingAnalysis): string[] {
  return analysis.dataQuality.missingEvidence.map((item) => {
    const issue = analysis.exercises.flatMap((exercise) => exercise.issues).find((candidate) => candidate.canonicalId === item.canonicalId)
    const evaluable = issue?.stats?.evaluable ?? 0
    return evaluable > 0
      ? `${EXERCISE_NAMES[item.exerciseId]}有 ${evaluable} 次手肘伸展可以可靠判断，当前证据不足，因此本次未给出该项结论。`
      : `${EXERCISE_NAMES[item.exerciseId]}缺少可可靠判断的手肘伸展数据，因此本次未给出该项结论。`
  })
}

export function DataNotesSection({ analysis, scope }: { analysis: TrainingAnalysis; scope?: TrainingScope }) {
  const guidanceRelevant = scope?.kind !== 'free_training' || scope.exerciseId === 'shoulder_rotation'
  const promptCount = analysis.dataQuality.poseQuality.outOfFramePrompts + analysis.dataQuality.poseQuality.lowConfidencePrompts
  const notes = [...new Set([...analysis.dataQuality.notes, ...missingEvidenceNotes(analysis)])]
  return (
    <section aria-labelledby="data-notes-title" data-testid="report-data-notes">
      <details className="group report-panel overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:content-none sm:p-5">
          <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-700" aria-hidden="true"><Info size={18} /></span>
          <div className="min-w-0 flex-1"><h2 id="data-notes-title" className="text-balance font-bold text-slate-950">数据说明</h2><p className="mt-0.5 text-pretty text-sm text-slate-500">查看有效次数、识别质量与历史比较范围</p></div>
          <ChevronDown size={18} className="text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="border-t border-slate-100 px-4 pb-5 pt-4 sm:px-5">
          <dl className="grid gap-3 sm:grid-cols-3">
            <DataFact label="有效分析" value={`${analysis.dataQuality.reps.valid + analysis.dataQuality.reps.partial} 次`} />
            <DataFact label="未纳入分析" value={`${analysis.dataQuality.reps.invalid} 次`} />
            <DataFact label="识别质量提示" value={`${promptCount} 次`} />
          </dl>
          <ul className="mt-4 space-y-1.5 text-pretty text-sm leading-6 text-slate-600">
            {analysis.dataQuality.rulesSupport === 'LEGACY_UNVERSIONED' ? <li>此记录来自旧版本，无法与当前训练可靠比较。</li> : null}
            {analysis.dataQuality.rulesSupport === 'UNSUPPORTED' ? <li>此记录使用的评分规则与当前版本不同，本页只展示评分、完成度和数据说明。</li> : null}
            {analysis.comparison.level === 'PARTIAL' ? <li>历史比较仅覆盖双方共同完成的 {analysis.comparison.commonExerciseIds.length} 个动作。</li> : null}
            {analysis.dataQuality.limitedExercises.map((item) => <li key={item.exerciseId}>{EXERCISE_NAMES[item.exerciseId]}仅有 {item.analyzedReps} 次有效动作，本次分析范围有限。</li>)}
            {notes.map((note) => <li key={note}>{note}</li>)}
            {guidanceRelevant ? <li>肩部环绕属于热身引导，不计入综合评分或五维能力。</li> : null}
          </ul>
        </div>
      </details>
    </section>
  )
}

function DataFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 px-4 py-2.5"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-0.5 font-bold tabular-nums text-slate-900">{value}</dd></div>
}

export function TrainingReportView({ analysis: analyzed, session }: { analysis: TrainingAnalysis; session: TrainingSessionState }) {
  const scope = resolveTrainingScope(session)
  // Free training only rewords analysis-v1's course-scoped summary sentences; all other analysis output is shown as is.
  const analysis = scope.kind === 'free_training' ? { ...analyzed, summary: freeTrainingSummary(analyzed, scope.exerciseId) } : analyzed
  return (
    <ReportLayout>
      <ReportHero analysis={analysis} session={session} />
      <NextFocusSection analysis={analysis} scope={scope} />
      <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-2">
        <PriorityIssuesSection analysis={analysis} />
        <TrainingAnalysisSection analysis={analysis} />
      </div>
      <ExercisePerformanceSection analysis={analysis} scope={scope} />
      {/* The five-dimension view needs several exercises; a one-exercise session can never fill it. */}
      {scope.kind === 'free_training' ? null : <CapabilitySection analysis={analysis} />}
      <ProgressSection analysis={analysis} />
      <DataNotesSection analysis={analysis} scope={scope} />
      <ReportActions
        title="带着重点，再练一次"
        description="下一次训练会生成新的独立报告。"
        historyHref={HISTORY_PATH}
        againLabel="再次训练"
        onAgain={() => window.location.assign(trainingEntryPath(scope))}
      />
    </ReportLayout>
  )
}

function RecoveryLayout({ title, description, testId, showTrain = true }: { title: string; description: string; testId: string; showTrain?: boolean }) {
  return (
    <div className="fp-page min-h-dvh text-slate-900"><AppHeader /><main className="mx-auto grid min-h-[70dvh] max-w-3xl place-items-center px-4 py-12"><section className="fp-card w-full p-8 text-center" data-testid={testId}><span className="mx-auto grid size-12 place-items-center rounded-xl bg-slate-100 text-slate-600"><AlertTriangle size={22} /></span><h1 className="mt-4 text-balance text-2xl font-bold">{title}</h1><p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-slate-600">{description}</p><div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row"><button type="button" onClick={() => window.location.assign('/')} className="secondary-button inline-flex items-center justify-center gap-2"><ArrowLeft size={16} />返回首页</button>{showTrain ? <button type="button" onClick={() => window.location.assign(START_TRAINING_PATH)} className="primary-button inline-flex items-center justify-center gap-2">开始训练<TrendingUp size={16} /></button> : null}</div></section></main></div>
  )
}

export function ReportNotFound() {
  return <RecoveryLayout title="没有找到这次训练记录" description="记录可能已被清除，或者报告链接已经失效。你可以返回首页或开始一次新的训练。" testId="report-not-found" />
}

export function ReportReadError() {
  return <RecoveryLayout title="暂时无法读取训练报告" description="本地训练记录读取失败，请稍后重试。已有训练不会因此被重新计算。" testId="report-read-error" />
}

/** One report route for every mode: follow-along and custom-action records open their own report, anything else the warm-up's. */
export function TrainingReportPage({ sessionId }: { sessionId: string }) {
  const routine = useRoutineReport(sessionId)
  const custom = useCustomActionReport(sessionId)
  const state = useTrainingReportAnalysis(sessionId)
  if (routine.status === 'ready') return <><RoutineReportView report={routine.report} /><AICoach context={{ page: 'report', digest: routineDigest(routine.report) }} /></>
  if (custom.status === 'ready') return <><CustomActionReportView report={custom.report} actionExists={custom.actionExists} /><AICoach context={{ page: 'report', digest: customDigest(custom.report) }} /></>
  if (state.status === 'not_found') return routine.status === 'error' || custom.status === 'error' ? <ReportReadError /> : <ReportNotFound />
  if (state.status === 'error') return <ReportReadError />
  return <><TrainingReportView analysis={state.analysis} session={state.session} /><AICoach context={{ page: 'report', digest: warmUpDigest(state.analysis, state.session) }} /></>
}
