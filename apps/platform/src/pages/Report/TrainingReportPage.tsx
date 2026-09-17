import { ArrowLeft, CalendarDays, Check, ChevronDown, CircleDashed, Clock3, Dumbbell, MessageCircleWarning, RefreshCw, Sparkles, Target, TrendingUp } from 'lucide-react'
import { AppHeader } from '../../components/layout/AppHeader'
import { CapabilityRadar } from '../../components/report/CapabilityRadar'
import { buildTrainingReport } from '../../features/report/TrainingReportBuilder'
import type { CapabilitySummaryItem, ExerciseReportSummary, ReportIssue, ReportRecommendation, TrainingReportData } from '../../features/report/types'
import { LocalStorageTrainingSessionRepository } from '../../features/training/LocalStorageTrainingSessionRepository'
import { cn } from '../../lib/cn'

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—'
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${minutes}分 ${seconds.toString().padStart(2, '0')}秒` : `${seconds}秒`
}

function progressText(exercise: ExerciseReportSummary): string {
  if (exercise.evaluationMode === 'guidance') return exercise.completion === 'completed' ? '引导完成' : '引导未完成'
  if (exercise.progress === null || exercise.target === null || exercise.targetType === null) return '本次训练尚未完成该动作'
  return `${exercise.progress} / ${exercise.target}${exercise.targetType === 'cycles' ? ' 组' : ' 次'}`
}

export function ReportSummary({ report }: { report: TrainingReportData }) {
  const complete = report.completion.status === 'complete'
  const CompletionIcon = complete ? Check : CircleDashed
  return (
    <section className="panel overflow-hidden p-5 sm:p-7" aria-labelledby="report-summary-title" data-testid="report-summary">
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,.6fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn('grid size-11 place-items-center rounded-2xl', complete ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}><CompletionIcon size={23} /></span>
            <div>
              <p className="text-sm font-semibold text-blue-600">训练报告</p>
              <h1 id="report-summary-title" className="text-balance text-3xl font-bold text-slate-950 sm:text-4xl">{report.completion.label}</h1>
            </div>
          </div>
          <p className="mt-4 text-pretty text-base text-slate-600">{report.courseName}</p>
          <p className="mt-1 inline-flex items-center gap-2 text-sm text-slate-500"><CalendarDays size={16} />{formatDate(report.startedAt)}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetric icon={Clock3} label="训练时长" value={formatDuration(report.durationMs)} />
            <SummaryMetric icon={Target} label="课程完成度" value={`${report.completion.completed} / ${report.completion.total}`} />
            <SummaryMetric icon={TrendingUp} label={report.overallScoreScope === 'completed_scored_average' ? '已完成动作平均分' : '课程总评'} value={report.overallScore === null ? '—' : String(report.overallScore)} />
            <SummaryMetric icon={MessageCircleWarning} label="反馈记录" value={`${report.feedbackCount} 条`} />
          </div>
          <p className="mt-4 text-pretty text-sm text-slate-500" data-testid="overall-score-scope">{report.overallScoreDescription}</p>
        </div>
        <div className="relative mx-auto hidden h-56 w-full max-w-64 overflow-hidden rounded-3xl bg-blue-50 lg:block" aria-hidden="true">
          <img src="/assets/coach-lateral-raise.png" alt="" className="size-full object-contain object-bottom" />
          <span className="absolute inset-x-4 bottom-4 rounded-2xl bg-white/95 px-4 py-3 text-center text-sm font-semibold text-slate-700 shadow-sm">{report.overallScoreLabel}</span>
        </div>
      </div>
    </section>
  )
}

function SummaryMetric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
      <div className="flex items-center gap-2 text-sm text-slate-500"><Icon size={17} className="text-blue-500" />{label}</div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  )
}

export function CapabilitySection({ capabilities, completedScoredCount }: { capabilities: CapabilitySummaryItem[]; completedScoredCount: number }) {
  return (
    <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="capability-title" data-testid="report-capabilities">
      <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-600"><TrendingUp size={19} /></span><div><h2 id="capability-title" className="text-balance text-xl font-bold text-slate-900">能力维度汇总</h2><p className="text-pretty text-sm text-slate-500">仅汇总已完成计分动作中的可用指标</p></div></div>
      {completedScoredCount >= 2 ? <CapabilityRadar capabilities={capabilities} /> : (
        <div className="my-8 rounded-2xl bg-slate-50 p-6 text-center"><p className="font-semibold text-slate-800">完成更多动作后可查看能力分布</p><p className="mt-1 text-pretty text-sm text-slate-500">当前样本少于 2 个已完成计分动作。</p></div>
      )}
      <dl className="grid gap-2 sm:grid-cols-2">
        {capabilities.map((item) => <div key={item.dimension} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5"><dt className="truncate text-sm font-medium text-slate-700">{item.label}</dt><dd className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{item.value ?? '—'} <span className="font-normal text-slate-400">· {item.sampleCount}/{item.totalExerciseCount}</span></dd></div>)}
      </dl>
      <p className="mt-3 text-pretty text-xs text-slate-500">数值范围 0–100；每项标注可用动作样本数，缺失指标不会按 0 分处理。</p>
    </section>
  )
}

export function ExerciseReportCard({ exercise }: { exercise: ExerciseReportSummary }) {
  const guidance = exercise.evaluationMode === 'guidance'
  return (
    <details className="panel group min-w-0 overflow-hidden" data-testid={`exercise-report-${exercise.exerciseId}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-5 marker:content-none">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', guidance ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600')}><Dumbbell size={20} /></span>
        <div className="min-w-0"><h3 className="truncate font-bold text-slate-900">{exercise.name}</h3><p className="text-sm text-slate-500">{progressText(exercise)}</p></div>
        <div className="ml-auto shrink-0 text-right">
          <p className="font-bold tabular-nums text-slate-900">{guidance ? (exercise.completion === 'completed' ? '引导完成' : '引导未完成') : exercise.score === null ? '—' : `${exercise.score} 分`}</p>
          <p className="text-xs text-slate-500">{exercise.completion === 'completed' ? '已完成' : exercise.completion === 'unavailable' ? '暂无可展示的数据' : '未完成'}</p>
        </div>
        <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-100 px-5 pb-5 pt-4">
        {guidance ? <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><p className="font-semibold">{exercise.completion === 'completed' && exercise.target !== null ? `已完成 ${exercise.target} 秒有效运动引导目标` : '本次没有完整的有效运动引导记录'}</p><p className="mt-1 text-pretty">肩部环绕不显示或参与 0–100 数值总分；当前 Session 未保存的连续性、左右幅度和同步质量不会在报告中补算。</p></div> : (
          <dl className="grid gap-2 sm:grid-cols-2">
            {exercise.metrics.map((metric) => <div key={metric.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><dt className="text-sm text-slate-600">{metric.label}</dt><dd className="font-semibold tabular-nums text-slate-900">{metric.value ?? '—'}</dd></div>)}
          </dl>
        )}
        <p className="mt-3 text-pretty text-sm text-slate-600">{exercise.summaryText}</p>
        {exercise.topIssues[0] ? <p className="mt-2 text-sm font-medium text-coral-600">主要问题：{exercise.topIssues[0].reportLabel} · {exercise.topIssues[0].count} 次</p> : null}
      </div>
    </details>
  )
}

export function TopIssuesSection({ issues }: { issues: ReportIssue[] }) {
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="issues-title" data-testid="report-top-issues">
      <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-coral-50 text-coral-600"><MessageCircleWarning size={19} /></span><h2 id="issues-title" className="text-balance text-xl font-bold text-slate-900">本次最常见问题</h2></div>
      {issues.length ? <ol className="mt-4 space-y-2">{issues.map((issue, index) => (
        <li key={issue.id} className="flex min-w-0 items-center gap-3 rounded-2xl bg-coral-50/60 p-3.5"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-coral-600">{index + 1}</span><div className="min-w-0"><p className="text-pretty text-sm font-semibold text-slate-800">{issue.exerciseName} · {issue.reportLabel}</p><p className="text-xs text-slate-500">来自已确认纠错反馈</p></div><span className="ml-auto shrink-0 text-sm font-bold tabular-nums text-coral-600">{issue.count} 次</span></li>
      ))}</ol> : <div className="mt-4 rounded-2xl bg-slate-50 p-5"><p className="font-semibold text-slate-800">本次训练没有记录到明显的重复纠错问题。</p><p className="mt-1 text-pretty text-sm text-slate-500">没有记录到纠错不等于动作全部标准。</p></div>}
    </section>
  )
}

export function RecommendationsSection({ recommendations }: { recommendations: ReportRecommendation[] }) {
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="recommendations-title" data-testid="report-recommendations">
      <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-600"><Sparkles size={19} /></span><div><h2 id="recommendations-title" className="text-balance text-xl font-bold text-slate-900">下一次训练建议</h2><p className="text-pretty text-sm text-slate-500">基于已保存结果的规则建议</p></div></div>
      <ol className="mt-4 space-y-2">{recommendations.map((item, index) => <li key={item.id} className="flex gap-3 rounded-2xl bg-blue-50/70 p-4"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-blue-600">{index + 1}</span><p className="text-pretty text-sm leading-6 text-slate-700">{item.text}</p></li>)}</ol>
    </section>
  )
}

export function TrainingReportView({ report }: { report: TrainingReportData }) {
  const completedScoredCount = report.scoredExercises.filter((item) => item.completion === 'completed' && item.score !== null).length
  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#f6f9fc] text-slate-900">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1600px] px-4 py-5 lg:px-7">
        <button type="button" onClick={() => window.location.assign('/')} className="mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white"><ArrowLeft size={17} />返回首页</button>
        <ReportSummary report={report} />
        <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
          <CapabilitySection capabilities={report.capabilitySummary} completedScoredCount={completedScoredCount} />
          <section className="min-w-0" aria-labelledby="exercise-results-title" data-testid="report-exercises"><div className="mb-3 flex items-end justify-between gap-3"><div><h2 id="exercise-results-title" className="text-balance text-xl font-bold text-slate-900">各动作表现</h2><p className="text-pretty text-sm text-slate-500">展开查看已保存指标和主要问题</p></div><span className="text-sm tabular-nums text-slate-500">{report.exerciseSummaries.length} 项</span></div><div className="grid min-w-0 gap-3 sm:grid-cols-2">{report.exerciseSummaries.map((exercise) => <ExerciseReportCard key={exercise.exerciseId} exercise={exercise} />)}</div></section>
        </div>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2"><TopIssuesSection issues={report.topIssues} /><RecommendationsSection recommendations={report.recommendations} /></div>
        <section className="mt-4 flex flex-col items-center justify-between gap-4 rounded-3xl bg-blue-600 p-5 text-white shadow-sm sm:flex-row sm:p-6" aria-label="报告操作">
          <div><h2 className="text-balance text-xl font-bold">完成本次复盘</h2><p className="mt-1 text-pretty text-sm text-blue-100">报告仅基于本次已保存的训练数据。</p></div>
          <div className="flex w-full gap-2 sm:w-auto"><button type="button" onClick={() => window.location.assign('/train')} className="flex-1 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20 sm:flex-none"><RefreshCw size={16} className="mr-2 inline" />重新训练</button><button type="button" onClick={() => window.location.assign('/')} className="flex-1 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 shadow-sm sm:flex-none">返回首页</button></div>
        </section>
      </main>
    </div>
  )
}

export function ReportNotFound() {
  return (
    <div className="min-h-dvh bg-[#f6f9fc] text-slate-900"><AppHeader /><main className="mx-auto grid min-h-[70dvh] max-w-3xl place-items-center px-4 py-12"><section className="panel w-full p-8 text-center" data-testid="report-not-found"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><MessageCircleWarning size={23} /></span><h1 className="mt-4 text-balance text-2xl font-bold">未找到本次训练记录</h1><p className="mx-auto mt-2 max-w-md text-pretty text-sm text-slate-500">记录可能已被清除，或报告链接中的 Session ID 无效。</p><button type="button" onClick={() => window.location.assign('/')} className="primary-button mt-6">返回首页</button></section></main></div>
  )
}

export function TrainingReportPage({ sessionId }: { sessionId: string }) {
  const session = new LocalStorageTrainingSessionRepository().get(sessionId)
  return session ? <TrainingReportView report={buildTrainingReport(session)} /> : <ReportNotFound />
}
