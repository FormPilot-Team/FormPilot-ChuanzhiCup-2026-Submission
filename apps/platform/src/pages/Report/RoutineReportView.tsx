import {
  Activity, ArrowLeft, CalendarDays, Check, ChevronDown, CircleDashed, Clock3, History, Info, Play, RefreshCw, Target,
} from 'lucide-react'
import { HISTORY_PATH, reportPath, routineTrainingPath } from '../../app/routes'
import { AppHeader } from '../../components/layout/AppHeader'
import { ROUTINE_ACCENT } from '../../components/routines/routineTheme'
import type { FollowAlongRegion } from '../../features/routines/followAlong/matcher'
import {
  REGION_LABEL, SIMILARITY_BAND_LABEL, type RoutineChapterReport, type RoutineComparison, type RoutineReport, type SimilarityBand,
} from '../../features/routines/report/routineReport'
import { chapterDisplayName, formatClock, scopeTitle } from '../../features/routines/scope'
import { cn } from '../../lib/cn'
import { HeroFact, SectionHeading } from './reportShell'
import { formatDate, formatDuration, formatShortDate } from './reportPresentation'

const REGIONS: ReadonlyArray<FollowAlongRegion> = ['arms', 'torso', 'legs']

const BAND_TONE: Readonly<Record<SimilarityBand, string>> = {
  high: 'bg-emerald-50 text-emerald-800',
  fair: 'bg-blue-50 text-blue-800',
  low: 'bg-coral-50 text-coral-600',
}

function percent(value: number): number {
  return Math.round(value * 100)
}

function deltaText(delta: number | null, trend: RoutineComparison['similarityTrend'], unit: string): string | null {
  if (delta === null || trend === null) return null
  if (trend === 'flat') return '基本持平'
  return delta > 0 ? `提升 ${delta}${unit}` : `下降 ${Math.abs(delta)}${unit}`
}

function tempoLabel(tempo: RoutineReport['tempo']): string {
  if (tempo === 'behind') return '常慢于视频'
  if (tempo === 'ahead') return '常快于视频'
  return '基本跟上视频'
}

export function RoutineReportHero({ report }: { report: RoutineReport }) {
  const { record, program } = report
  const CompletionIcon = report.complete ? Check : CircleDashed
  const comparison = report.comparison
  const similarityChange = deltaText(comparison.similarityDelta, comparison.similarityTrend, ' 分')
  return (
    <section className="overflow-hidden rounded-2xl bg-slate-950 text-white" aria-labelledby="report-title" data-testid="report-summary" data-report-kind="routine">
      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(310px,.75fr)]">
        <div className="p-6 sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-blue-200">
            <span className="grid size-9 place-items-center rounded-xl bg-white/10"><CompletionIcon size={18} aria-hidden="true" /></span>
            {report.complete ? '跟练完成' : '本次跟练未完整完成'}
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white">{scopeTitle(program, record.scope)}</span>
          </div>
          <h1 id="report-title" className="mt-6 max-w-3xl text-balance text-3xl font-bold leading-tight sm:text-4xl">{program.title}跟练报告</h1>
          <div className="mt-7 flex flex-wrap items-end gap-x-5 gap-y-2" data-testid="routine-report-similarity">
            {report.similarity === null ? (
              <p className="text-balance text-2xl font-bold sm:text-3xl">暂无跟练相似度</p>
            ) : (
              <>
                <span className="text-6xl font-bold tabular-nums sm:text-7xl">{report.similarity}%</span>
                <span className="pb-2 text-base font-semibold text-slate-300">跟练相似度 · {SIMILARITY_BAND_LABEL[report.band as SimilarityBand]}</span>
              </>
            )}
          </div>
          <p className="mt-5 max-w-2xl text-pretty text-sm leading-6 text-slate-300">
            {comparison.available && comparison.previousStartedAt !== null
              ? `与 ${formatShortDate(comparison.previousStartedAt)} 同一范围的跟练相比，相似度${similarityChange ?? '基本持平'}。`
              : comparison.reason}
          </p>
        </div>
        <dl className="grid content-center border-t border-white/10 bg-white/[0.04] sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-t-0">
          <HeroFact icon={Target} label="完成度" value={`${percent(report.coverage)}% · ${formatClock(report.coveredSeconds)} / ${formatClock(report.totalSeconds)}`} />
          <HeroFact icon={Clock3} label="训练时间" value={formatDuration(record.activeMs > 0 ? record.activeMs : null)} />
          <HeroFact icon={CalendarDays} label="训练日期" value={formatDate(record.startedAt)} />
        </dl>
      </div>
    </section>
  )
}

function OverviewSection({ report }: { report: RoutineReport }) {
  return (
    <section className="report-panel p-5 sm:p-7" aria-labelledby="routine-overview-title" data-testid="routine-report-overview">
      <SectionHeading id="routine-overview-title" icon={Activity} title="跟练概览" description="比较你与标准视频在同一时刻的身体姿态与节奏；数值只来自识别可靠的时刻。" />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-sm text-slate-500">节奏同步</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{report.syncShare === null ? '—' : `${report.syncShare}%`}</p>
          <p className="mt-1 text-xs text-slate-500">{report.syncShare === null ? '识别数据不足' : `跟练时间中与视频同步的比例 · ${tempoLabel(report.tempo)}`}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 md:col-span-2">
          <p className="text-sm text-slate-500">身体部位与示范的一致程度</p>
          <dl className="mt-2 grid grid-cols-3 gap-3">
            {REGIONS.map((region) => (
              <div key={region} className={cn('rounded-lg bg-white px-3 py-2', report.weakestRegion === region && (report.regions[region] ?? 100) < 70 && 'ring-2 ring-coral-500/50')}>
                <dt className="text-xs text-slate-500">{REGION_LABEL[region]}</dt>
                <dd className="text-xl font-bold tabular-nums text-slate-950">{report.regions[region] ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {report.focus.length ? (
        <div className="mt-6" data-testid="routine-report-focus">
          <h3 className="font-bold text-slate-950">下次练习重点</h3>
          <ol className="mt-3 grid gap-3 lg:grid-cols-2">
            {report.focus.map((item, index) => (
              <li key={item} className="flex gap-3 rounded-xl bg-blue-50 p-4">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-700 text-sm font-bold text-white">{index + 1}</span>
                <p className="text-pretty text-sm leading-6 text-slate-700">{item}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}

function ChapterRow({ item, report }: { item: RoutineChapterReport; report: RoutineReport }) {
  const accent = ROUTINE_ACCENT[report.program.accent]
  const { chapter } = item
  return (
    <li className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center" data-testid={`routine-report-chapter-${chapter.id}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums', chapter.kind === 'form' ? accent.chip : 'bg-slate-100 text-slate-600')}>{chapter.kind === 'form' ? chapter.formNumber : chapter.kind === 'opening' ? '起' : '收'}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900" title={chapterDisplayName(chapter)}>{chapterDisplayName(chapter)}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className={cn('h-full rounded-full', accent.fill)} style={{ width: `${percent(item.coverage)}%` }} /></div>
            <span className="tabular-nums">跟练 {percent(item.coverage)}%</span>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        {item.similarity === null ? (
          <span className="text-slate-500">{item.coverage > 0 ? '识别数据不足' : '未跟练'}</span>
        ) : (
          <>
            <span className="font-bold tabular-nums text-slate-950">{item.similarity}%</span>
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', BAND_TONE[item.band as SimilarityBand])}>{SIMILARITY_BAND_LABEL[item.band as SimilarityBand]}</span>
            {item.syncShare !== null ? <span className="text-xs tabular-nums text-slate-500">同步 {item.syncShare}%</span> : null}
            {item.tempo ? <span className="text-xs font-semibold text-amber-800">{item.tempo === 'behind' ? '偏慢' : '偏快'}</span> : null}
          </>
        )}
      </div>
      {chapter.kind === 'form' ? (
        <a href={routineTrainingPath(report.program.id, chapter.id)} className="inline-flex items-center gap-1 justify-self-start rounded-lg px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:justify-self-end" aria-label={`单独练习 ${chapterDisplayName(chapter)}`}><Play size={12} fill="currentColor" aria-hidden="true" />单练</a>
      ) : <span aria-hidden="true" />}
    </li>
  )
}

function ChaptersSection({ report }: { report: RoutineReport }) {
  return (
    <section className="report-panel p-5 sm:p-7" aria-labelledby="routine-chapters-title" data-testid="routine-report-chapters">
      <SectionHeading id="routine-chapters-title" icon={Target} title="分段表现" description="按标准视频的段落列出完成度、跟练相似度与节奏；需要时可以单独练习某一段。" />
      <ol className="mt-6 divide-y divide-slate-100">
        {report.chapters.map((item) => <ChapterRow key={item.chapter.id} item={item} report={report} />)}
      </ol>
    </section>
  )
}

function ProgressSection({ report }: { report: RoutineReport }) {
  const comparison = report.comparison
  if (!comparison.available || comparison.previousId === null || comparison.previousStartedAt === null) return null
  const similarity = deltaText(comparison.similarityDelta, comparison.similarityTrend, ' 分')
  const sync = deltaText(comparison.syncDelta, comparison.syncTrend, ' 个百分点')
  return (
    <section className="report-panel p-5 sm:p-7" aria-labelledby="routine-progress-title" data-testid="routine-report-progress">
      <SectionHeading id="routine-progress-title" icon={History} title="相比上次" description={`与 ${formatDate(comparison.previousStartedAt)} 同一练习范围的记录比较。`} />
      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 px-4 py-3"><dt className="text-xs text-slate-500">跟练相似度</dt><dd className="mt-1 font-bold text-slate-900">{similarity ?? '—'}</dd></div>
        <div className="rounded-xl bg-slate-50 px-4 py-3"><dt className="text-xs text-slate-500">节奏同步</dt><dd className="mt-1 font-bold text-slate-900">{sync ?? '—'}</dd></div>
      </dl>
      <a href={reportPath(comparison.previousId)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-bold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">查看上次报告</a>
    </section>
  )
}

function NotesSection({ report }: { report: RoutineReport }) {
  return (
    <section aria-labelledby="routine-notes-title" data-testid="routine-report-notes">
      <details className="group report-panel overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-5 marker:content-none sm:p-6">
          <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-700" aria-hidden="true"><Info size={18} /></span>
          <div className="min-w-0 flex-1"><h2 id="routine-notes-title" className="text-balance text-lg font-bold text-slate-950">数据说明</h2><p className="mt-1 text-pretty text-sm text-slate-500">查看比对方式与识别质量</p></div>
          <ChevronDown size={18} className="text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <ul className="space-y-2 border-t border-slate-100 px-5 pb-6 pt-5 text-pretty text-sm leading-6 text-slate-600 sm:px-6">
          {report.notes.map((note) => <li key={note}>{note}</li>)}
          <li>比对规则：{report.record.matcher.version}；标准视频章节：{report.program.title} v{report.record.programVersion}。</li>
        </ul>
      </details>
    </section>
  )
}

export function RoutineReportView({ report }: { report: RoutineReport }) {
  const scope = report.record.scope
  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#f5f7fa] text-slate-900" data-routine={report.program.id}>
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1320px] px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <button type="button" onClick={() => window.location.assign('/')} className="mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={17} />返回首页</button>
        <div className="space-y-5 sm:space-y-6">
          <RoutineReportHero report={report} />
          <OverviewSection report={report} />
          <ChaptersSection report={report} />
          <ProgressSection report={report} />
          <NotesSection report={report} />
          <section className="flex flex-col items-start justify-between gap-4 rounded-2xl bg-blue-700 p-6 text-white sm:flex-row sm:items-center sm:p-7" aria-label="报告操作">
            <div><h2 className="text-balance text-xl font-bold">带着重点，再练一次</h2><p className="mt-1 text-pretty text-sm text-blue-100">下一次跟练会生成新的独立报告。</p></div>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <a href={HISTORY_PATH} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-300 px-5 py-3 text-sm font-bold text-white hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><History size={17} />查看训练记录</a>
              <button type="button" onClick={() => window.location.assign(routineTrainingPath(report.program.id, scope.kind === 'form' ? scope.chapterId : undefined))} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-blue-800 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><RefreshCw size={17} />再练一次</button>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
