import { Activity, CalendarDays, ChevronDown, Clock3, History, Info, ListChecks, Target } from 'lucide-react'
import { HISTORY_PATH, WORKSHOP_PATH, customTrainingPath, reportPath } from '../../app/routes'
import { BODY_AREAS, REQUIREMENTS } from '../../features/workshop/catalog'
import type { CustomActionReport } from '../../features/workshop/report'
import type { RequirementId } from '../../features/workshop/types'
import { formatDate, formatDuration, formatShortDate, scoreTone } from './reportPresentation'
import { FocusCard, FocusPanel, MiniBar, ReportActions, ReportLayout, ReportSummary, SectionHeading, type ReportTakeaway } from './reportShell'

const FEEDBACK_LABEL: Readonly<Record<string, string>> = {
  MOTION_TOO_SMALL: '动作幅度偏小，没有做到完成姿势',
  FRAMING: '身体没有完整入镜',
  POSE_LOST: '离开了画面',
}

function feedbackLabel(code: string): string {
  const requirement = /^REQUIREMENT_(.+)$/.exec(code)?.[1]?.toLowerCase().replaceAll('_', '-') as RequirementId | undefined
  if (requirement && requirement in REQUIREMENTS) return REQUIREMENTS[requirement].feedback
  return FEEDBACK_LABEL[code] ?? code
}

function unitOf(report: CustomActionReport): string {
  return report.record.goal.type === 'duration' ? '秒' : '次'
}

function summarySentence(report: CustomActionReport): string {
  const { progress, record } = report
  const verb = record.goal.type === 'duration' ? '保持了' : '完成了'
  const passed = record.reps ? `，其中 ${record.passedReps} ${unitOf(report)}识别重点都达标` : ''
  const hint = report.primaryFeedback ? `；主要提醒：${report.primaryFeedback.message}。` : '。'
  return `本次${verb} ${progress.done} / ${progress.target} ${progress.unit}${passed}${hint}`
}

function takeaways(report: CustomActionReport): ReportTakeaway[] {
  const items: ReportTakeaway[] = []
  items.push(report.primaryFeedback
    ? { label: '最大问题', text: report.primaryFeedback.message, tone: 'attention' }
    : { label: '最大问题', text: report.record.reps ? '本次没有明显的问题。' : '还没有识别到完整的动作。', tone: report.record.reps ? 'good' : 'attention' })
  const focus = report.focus[0]
  if (focus) items.push({ label: '下次重点', text: focus.title, tone: 'focus' })
  return items
}

function trendText(report: CustomActionReport): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  const { comparison } = report
  if (!comparison.available || comparison.doneDelta === null) return null
  const unit = report.progress.unit
  if (comparison.doneDelta === 0) return { text: '完成量与上次相同', tone: 'flat' }
  return comparison.doneDelta > 0 ? { text: `比上次多完成 ${comparison.doneDelta} ${unit}`, tone: 'up' } : { text: `比上次少完成 ${Math.abs(comparison.doneDelta)} ${unit}`, tone: 'down' }
}

export function CustomActionReportView({ report, actionExists }: { report: CustomActionReport; actionExists: boolean }) {
  const { record, progress } = report
  const unit = unitOf(report)
  const againHref = actionExists ? customTrainingPath(record.actionId) : WORKSHOP_PATH
  const feedback = Object.entries(record.feedbackCounts).filter(([, count]) => count > 0).sort((left, right) => right[1] - left[1]).slice(0, 4)
  return (
    <ReportLayout>
      <ReportSummary
        kind="custom"
        modeLabel={`我的动作 · ${BODY_AREAS[record.bodyArea].label}`}
        complete={report.complete}
        statusLabel={report.complete ? '训练完成' : '本次训练未完整完成'}
        title={`${record.actionName}训练报告`}
        score={{
          value: Math.round(progress.share * 100),
          suffix: '%',
          label: `完成度 · ${progress.done} / ${progress.target} ${progress.unit}`,
          emptyText: '暂无完成数据',
          tone: scoreTone(Math.round(progress.share * 100)),
          testId: 'custom-report-completion',
        }}
        trend={trendText(report)}
        summary={summarySentence(report)}
        comparison={report.comparison.available && report.comparison.previousStartedAt !== null ? `对比 ${formatShortDate(report.comparison.previousStartedAt)} 同一动作的训练。` : report.comparison.reason}
        metrics={[
          { icon: Target, label: record.goal.type === 'duration' ? '保持时间' : '完成次数', value: `${progress.done} / ${progress.target} ${progress.unit}`, progress: progress.share },
          { icon: Clock3, label: '训练时间', value: formatDuration(record.activeMs > 0 ? record.activeMs : null) },
          { icon: CalendarDays, label: '训练日期', value: formatDate(record.startedAt) },
          { icon: ListChecks, label: '识别重点全部达标', value: `${record.passedReps} ${unit}` },
        ]}
        takeaways={takeaways(report)}
      />

      {report.focus.length ? (
        <FocusPanel id="custom-focus-title" testId="custom-report-focus" description="按本次识别结果排出的练习重点。">
          <ol className={report.focus.length > 1 ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'}>
            {report.focus.map((item, index) => (
              <FocusCard
                key={item.kind}
                rank={index + 1}
                eyebrow={record.actionName}
                title={item.title}
                detail={item.detail}
                value={item.value}
                reason={item.reason}
                action={index === 0 && actionExists ? { label: '再练一次这个动作', href: customTrainingPath(record.actionId) } : null}
              />
            ))}
          </ol>
        </FocusPanel>
      ) : null}

      <section className="report-panel p-5 sm:p-6" aria-labelledby="custom-core-title" data-testid="custom-report-requirements">
        <SectionHeading id="custom-core-title" icon={Activity} title="核心表现" description={`每${unit}动作结束时检查的识别重点；看不清的时刻不计入。`} />
        {report.requirements.length ? (
          <dl className="mt-4 grid gap-3 md:grid-cols-2">
            {report.requirements.map((row) => (
              <div key={row.id} className="rounded-xl bg-slate-50 p-3.5" data-testid={`custom-requirement-${row.id}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="font-semibold text-slate-900">{row.label}</dt>
                  <dd className="text-sm font-bold tabular-nums text-slate-950">{row.rate === null ? '—' : `${row.rate}%`}</dd>
                </div>
                <div className="mt-2"><MiniBar value={row.rate} tone={scoreTone(row.rate)} /></div>
                <p className="mt-1.5 text-xs tabular-nums text-slate-500">{row.checked ? `${row.passed} / ${row.checked} ${unit}达标` : '本次没有可以判断的动作'}</p>
              </div>
            ))}
          </dl>
        ) : <p className="mt-4 text-sm text-slate-600">这个动作只检查“完成一次完整往返”，没有其他识别重点。</p>}
        {feedback.length ? (
          <div className="mt-5">
            <h3 className="text-sm font-bold text-slate-900">训练中的提醒</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {feedback.map(([code, count]) => <li key={code} className="rounded-full bg-white px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-200">{feedbackLabel(code)} <span className="tabular-nums text-slate-500">× {count}</span></li>)}
            </ul>
          </div>
        ) : null}
      </section>

      {report.comparison.available && report.comparison.previousId ? (
        <section className="report-panel p-5 sm:p-6" aria-labelledby="custom-progress-title" data-testid="custom-report-progress">
          <SectionHeading id="custom-progress-title" icon={History} title="相比上次" description={`与 ${formatDate(report.comparison.previousStartedAt as number)} 同一动作的训练比较。`} />
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 px-4 py-2.5"><dt className="text-xs text-slate-500">完成量</dt><dd className="mt-0.5 font-bold text-slate-900">{trendText(report)?.text ?? '—'}</dd></div>
            <div className="rounded-xl bg-slate-50 px-4 py-2.5"><dt className="text-xs text-slate-500">达标比例</dt><dd className="mt-0.5 font-bold text-slate-900">{report.comparison.passRateDelta === null ? '—' : report.comparison.passRateDelta === 0 ? '与上次持平' : report.comparison.passRateDelta > 0 ? `提高 ${report.comparison.passRateDelta} 个百分点` : `下降 ${Math.abs(report.comparison.passRateDelta)} 个百分点`}</dd></div>
          </dl>
          <a href={reportPath(report.comparison.previousId)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-bold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">查看上次报告</a>
        </section>
      ) : null}

      <section aria-labelledby="custom-notes-title" data-testid="custom-report-notes">
        <details className="group report-panel overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:content-none sm:p-5">
            <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-700" aria-hidden="true"><Info size={18} /></span>
            <div className="min-w-0 flex-1"><h2 id="custom-notes-title" className="text-balance font-bold text-slate-950">数据说明</h2><p className="mt-0.5 text-pretty text-sm text-slate-500">识别方式与数据范围</p></div>
            <ChevronDown size={18} className="text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <ul className="space-y-1.5 border-t border-slate-100 px-4 pb-5 pt-4 text-pretty text-sm leading-6 text-slate-600 sm:px-5">
            {report.notes.map((note) => <li key={note}>{note}</li>)}
            {actionExists ? null : <li>这个动作已经从动作工坊删除，报告仍然保留。</li>}
          </ul>
        </details>
      </section>

      <ReportActions
        title="带着重点，再练一次"
        description={actionExists ? '下一次训练会生成新的独立报告。' : '这个动作已删除，可以在动作工坊重新创建。'}
        historyHref={HISTORY_PATH}
        againLabel={actionExists ? '再练一次' : '去动作工坊'}
        onAgain={() => window.location.assign(againHref)}
      />
    </ReportLayout>
  )
}
