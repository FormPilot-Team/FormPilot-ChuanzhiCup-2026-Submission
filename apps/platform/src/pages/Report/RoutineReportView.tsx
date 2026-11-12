import { Activity, CalendarDays, ChevronDown, Clock3, History, Info, Layers, Play, Target } from 'lucide-react'
import { HISTORY_PATH, reportPath, routinePath, routineTrainingPath } from '../../app/routes'
import { ROUTINE_ACCENT } from '../../components/routines/routineTheme'
import type { FollowAlongRegion } from '../../features/routines/followAlong/matcher'
import {
  REGION_LABEL, SIMILARITY_BAND_LABEL, type RoutineChapterReport, type RoutineComparison, type RoutineReport, type SimilarityBand,
} from '../../features/routines/report/routineReport'
import { chapterDisplayName, formatClock, scopeTitle } from '../../features/routines/scope'
import { cn } from '../../lib/cn'
import { formatDate, formatDuration, formatShortDate, scoreTone } from './reportPresentation'
import { RoutineAnalyzerSection } from './RoutineAnalyzerSection'
import { FocusCard, FocusPanel, MiniBar, ReportActions, ReportFold, ReportLayout, ReportSummary, SectionHeading, type ReportNextAction, type ReportTakeaway } from './reportShell'
import { RoutineTechniqueSection } from './scoreExplanation'

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

/** One sentence from the report's own numbers: how much was followed, how closely and in what rhythm. */
function routineSummary(report: RoutineReport): string {
  const followed = report.complete && report.coverage >= 0.9 ? '完整跟练了本次内容' : `跟练了 ${percent(report.coverage)}% 的内容`
  if (report.similarity === null) return `${followed}，识别数据不足，暂时无法给出跟练相似度。`
  const band = SIMILARITY_BAND_LABEL[report.band as SimilarityBand]
  return `${followed}，与标准视频${band}（${report.similarity}%），节奏${tempoLabel(report.tempo)}。`
}

function routineTakeaways(report: RoutineReport): ReportTakeaway[] {
  const items: ReportTakeaway[] = []
  const weakest = report.weakestChapter
  const region = report.weakestRegion
  if (weakest && weakest.similarity !== null && weakest.band !== 'high') {
    items.push({ label: '最大问题', text: `${chapterDisplayName(weakest.chapter)} · 相似度 ${weakest.similarity}%`, tone: 'attention' })
  } else if (region && (report.regions[region] ?? 100) < 70) {
    items.push({ label: '最大问题', text: `${REGION_LABEL[region]}与示范差异最大（${report.regions[region]}%）`, tone: 'attention' })
  } else if (report.similarity !== null) {
    items.push({ label: '最大问题', text: '本次没有明显低于平均的段落或部位。', tone: 'good' })
  }
  const focus = report.focusItems[0]
  if (focus) items.push({ label: '下次重点', text: focus.title, tone: 'focus' })
  return items
}

export function RoutineReportHero({ report }: { report: RoutineReport }) {
  const { record, program } = report
  const comparison = report.comparison
  const similarityChange = deltaText(comparison.similarityDelta, comparison.similarityTrend, ' 分')
  const chapterCount = report.chapters.length
  return (
    <ReportSummary
      kind="routine"
      modeLabel={scopeTitle(program, record.scope)}
      complete={report.complete}
      statusLabel={report.complete ? '跟练完成' : '本次跟练未完整完成'}
      title={`${program.title}跟练报告`}
      score={{
        value: report.similarity,
        suffix: '%',
        label: report.similarity === null ? '跟练相似度' : `跟练相似度 · ${SIMILARITY_BAND_LABEL[report.band as SimilarityBand]}`,
        emptyText: '暂无跟练相似度',
        tone: scoreTone(report.similarity),
        testId: 'routine-report-similarity',
      }}
      trend={comparison.available ? { text: `相似度与上次相比${similarityChange ?? '基本持平'}`, tone: comparison.similarityTrend === 'up' ? 'up' : comparison.similarityTrend === 'down' ? 'down' : 'flat' } : null}
      summary={routineSummary(report)}
      comparison={comparison.available && comparison.previousStartedAt !== null
        ? `对比 ${formatShortDate(comparison.previousStartedAt)} 同一练习范围的跟练。`
        : comparison.reason}
      metrics={[
        { icon: Target, label: '完成度', value: `${percent(report.coverage)}% · ${formatClock(report.coveredSeconds)} / ${formatClock(report.totalSeconds)}`, progress: report.coverage },
        { icon: Clock3, label: '训练时间', value: formatDuration(record.activeMs > 0 ? record.activeMs : null) },
        { icon: CalendarDays, label: '训练日期', value: formatDate(record.startedAt) },
        { icon: Layers, label: '章节', value: chapterCount > 1 ? `${chapterCount} 段` : '单独一段' },
      ]}
      takeaways={routineTakeaways(report)}
      problem={routineProblem(report)}
      nextActions={routineNextActions(report)}
    />
  )
}

/** 主要问题: the weakest chapter (when the report names one below 高度一致) with its own cue; otherwise the takeaway. */
function routineProblem(report: RoutineReport) {
  const weakest = report.weakestChapter
  if (!weakest || weakest.similarity === null || weakest.band === 'high') return undefined
  const below = report.similarity !== null ? report.similarity - weakest.similarity : null
  return (
    <div className="mt-3 min-w-0" data-testid="routine-report-problem" data-chapter-id={weakest.chapter.id}>
      <p className="text-balance text-xl font-bold text-slate-950">{chapterDisplayName(weakest.chapter)}</p>
      <p className="mt-2"><span className="inline-flex rounded-lg bg-coral-50 px-2.5 py-1 text-xs font-bold tabular-nums text-coral-600 ring-1 ring-coral-500/25">相似度 {weakest.similarity}%{below !== null && below > 0 ? ` · 比本次平均低 ${below} 个百分点` : ''}</span></p>
      <p className="mt-3 text-pretty text-sm leading-6 text-slate-600">要领：{weakest.chapter.cue}</p>
      {weakest.tempo ? <p className="mt-1 text-xs text-slate-500">节奏：{weakest.tempo === 'behind' ? '这一段常慢于视频' : '这一段常快于视频'}</p> : null}
    </div>
  )
}

function routineNextActions(report: RoutineReport): ReportNextAction[] {
  const scope = report.record.scope
  const focusChapter = report.focusItems.find((item) => item.chapterId)?.chapterId ?? null
  const chapter = focusChapter ? report.program.chapters.find((item) => item.id === focusChapter) : undefined
  const again = { label: scope.kind === 'full' ? '整套再练一次' : '再练这一段', href: routineTrainingPath(report.program.id, scope.kind === 'form' ? scope.chapterId : undefined), testId: 'routine-next-again' }
  const detail = { label: '看示范与动作要领', href: routinePath(report.program.id), testId: 'routine-next-detail' }
  if (chapter && !(scope.kind === 'form' && scope.chapterId === chapter.id)) {
    return [{ label: `单练${chapter.label}`, href: routineTrainingPath(report.program.id, chapter.id), primary: true, testId: 'routine-next-form' }, again, detail]
  }
  return [{ ...again, primary: true }, detail]
}

const STRIP_FILL: Readonly<Record<SimilarityBand, string>> = {
  high: 'bg-emerald-300/80 text-emerald-950',
  fair: 'bg-amber-300/90 text-amber-950',
  low: 'bg-coral-500/80 text-white',
}

/** 分段表现 at a glance: one bar per chapter, width = chapter length, colour = the chapter's own similarity band. */
function SegmentsSection({ report }: { report: RoutineReport }) {
  if (report.chapters.length < 2) return null
  const weak = report.chapters
    .filter((item) => item.similarity !== null && item.band !== 'high')
    .sort((left, right) => (left.similarity as number) - (right.similarity as number))
  const highCount = report.chapters.filter((item) => item.band === 'high').length
  const flex = (item: RoutineChapterReport) => `${Math.max(1, item.chapter.endSeconds - item.chapter.startSeconds)} 1 0%`
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="routine-segments-title" data-testid="routine-report-segments">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 id="routine-segments-title" className="text-lg font-bold text-slate-950">分段表现</h2>
          <span className="text-xs text-slate-500">宽度 = 段落时长 · 颜色 = 跟练相似度</span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-600" aria-label="颜色说明">
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-emerald-300" aria-hidden="true" />≥ 80% {SIMILARITY_BAND_LABEL.high}</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-amber-300" aria-hidden="true" />60–79% {SIMILARITY_BAND_LABEL.fair}</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-coral-500" aria-hidden="true" />&lt; 60% {SIMILARITY_BAND_LABEL.low}</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-slate-200" aria-hidden="true" />数据不足</span>
        </div>
      </div>
      <div className="mt-4 flex h-11 gap-1" role="img" aria-label={report.chapters.map((item) => `${chapterDisplayName(item.chapter)} ${item.similarity === null ? '数据不足' : `${item.similarity}%`}`).join('，')}>
        {report.chapters.map((item) => (
          <div
            key={item.chapter.id}
            className={cn('grid min-w-0 place-items-center overflow-hidden rounded-lg text-xs font-bold tabular-nums', item.band ? STRIP_FILL[item.band] : 'bg-slate-200/80 text-slate-500')}
            style={{ flex: flex(item) }}
            title={chapterDisplayName(item.chapter)}
            data-segment-id={item.chapter.id}
            data-segment-band={item.band ?? 'none'}
          >
            {item.similarity ?? '—'}
          </div>
        ))}
      </div>
      <div className="mt-1.5 hidden gap-1 text-[11px] text-slate-500 sm:flex" aria-hidden="true">
        {report.chapters.map((item) => (
          <span key={item.chapter.id} className={cn('min-w-0 truncate', report.weakestChapter?.chapter.id === item.chapter.id && 'font-bold text-coral-600')} style={{ flex: flex(item) }}>
            {item.chapter.kind === 'form' ? `${item.chapter.formNumber} ${item.chapter.name.slice(0, 4)}` : item.chapter.label}
          </span>
        ))}
      </div>
      {weak.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {weak.slice(0, 2).map((item) => (
            <div key={item.chapter.id} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-slate-200/70" data-testid="routine-report-weak-segment">
              <span className={cn('rounded-lg px-2 py-0.5 text-xs font-bold tabular-nums', BAND_TONE[item.band as SimilarityBand])}>{item.similarity}%</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{chapterDisplayName(item.chapter)}</p>{item.syncShare !== null ? <p className="text-xs tabular-nums text-slate-500">节奏同步 {item.syncShare}%</p> : null}</div>
              {item.chapter.kind === 'form' ? <a href={routineTrainingPath(report.program.id, item.chapter.id)} className="secondary-button shrink-0 px-3 py-1.5 text-xs">单练</a> : null}
            </div>
          ))}
          {highCount ? <div className="grid place-items-center rounded-2xl px-4 py-3 text-center text-sm text-slate-600">其余 {highCount} 段{SIMILARITY_BAND_LABEL.high}（≥ 80%）</div> : null}
        </div>
      ) : null}
    </section>
  )
}

const FOCUS_COLUMNS = ['', 'lg:grid-cols-2', 'lg:grid-cols-3'] as const

function RoutineFocusSection({ report }: { report: RoutineReport }) {
  if (!report.focusItems.length) return null
  const chapterLabel = (id: string | null) => report.program.chapters.find((chapter) => chapter.id === id)?.label
  return (
    <FocusPanel id="routine-focus-title" testId="routine-report-focus" description="按本次跟练数据排出的练习重点，可以直接单独练习对应的一段。">
      <ol className={cn('grid gap-3', FOCUS_COLUMNS[Math.min(report.focusItems.length, 3) - 1])}>
        {report.focusItems.map((item, index) => (
          <FocusCard
            key={item.text}
            rank={index + 1}
            eyebrow={item.chapterId ? `${report.program.title} · ${chapterLabel(item.chapterId)}` : report.program.title}
            title={item.title}
            detail={item.detail}
            value={item.value}
            reason={item.reason}
            action={item.chapterId ? { label: `单独练习这一${report.program.formUnit}`, href: routineTrainingPath(report.program.id, item.chapterId) } : null}
          />
        ))}
      </ol>
    </FocusPanel>
  )
}

function OverviewSection({ report }: { report: RoutineReport }) {
  const regionSummary = REGIONS.map((region) => `${REGION_LABEL[region]} ${report.regions[region] ?? '—'}`).join(' · ')
  return (
    <section className="min-w-0" aria-labelledby="routine-overview-title" data-testid="routine-report-overview">
      <ReportFold id="routine-overview-title" title="分区表现" summary={<span className="tabular-nums">{regionSummary} · 节奏同步 {report.syncShare === null ? '—' : `${report.syncShare}%`}</span>}>
      <p className="flex items-start gap-2 px-1 text-pretty text-sm leading-6 text-slate-500"><Activity size={16} className="mt-1 shrink-0 text-blue-600" aria-hidden="true" />跟练相似度：你与标准视频在同一时刻的身体姿态与节奏的视觉接近程度，不等于动作规范评价；数值只来自识别可靠的时刻。</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3.5">
          <dt className="text-xs text-slate-500">跟练相似度</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{report.similarity === null ? '—' : `${report.similarity}%`}</dd>
          <div className="mt-2"><MiniBar value={report.similarity} tone={scoreTone(report.similarity)} /></div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <dt className="text-xs text-slate-500">节奏同步</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{report.syncShare === null ? '—' : `${report.syncShare}%`}</dd>
          <p className="mt-1 text-xs text-slate-500">{report.syncShare === null ? '识别数据不足' : tempoLabel(report.tempo)}</p>
        </div>
        {REGIONS.map((region) => {
          const value = report.regions[region]
          const weakest = report.weakestRegion === region && (value ?? 100) < 70
          return (
            <div key={region} className={cn('rounded-xl bg-slate-50 p-3.5', weakest && 'ring-2 ring-coral-500/40')}>
              <dt className="text-xs text-slate-500">{REGION_LABEL[region]}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{value ?? '—'}</dd>
              <div className="mt-2"><MiniBar value={value} tone={scoreTone(value)} /></div>
            </div>
          )
        })}
      </dl>
      </ReportFold>
    </section>
  )
}

function ChapterRow({ item, report }: { item: RoutineChapterReport; report: RoutineReport }) {
  const accent = ROUTINE_ACCENT[report.program.accent]
  const { chapter } = item
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto]" data-testid={`routine-report-chapter-${chapter.id}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums', chapter.kind === 'form' ? accent.chip : 'bg-slate-100 text-slate-600')}>{chapter.kind === 'form' ? chapter.formNumber : chapter.kind === 'opening' ? '起' : '收'}</span>
        <p className="min-w-0 truncate text-sm font-semibold text-slate-900" title={chapterDisplayName(chapter)}>{chapterDisplayName(chapter)}</p>
      </div>
      <div className="order-last col-span-2 flex min-w-0 items-center gap-2 text-xs text-slate-500 md:order-none md:col-span-1">
        <span className="w-20 shrink-0 md:w-auto md:flex-1"><MiniBar value={percent(item.coverage)} tone="fair" /></span>
        <span className="tabular-nums">跟练 {percent(item.coverage)}%</span>
      </div>
      <div className="hidden min-w-0 flex-wrap items-center gap-2 text-sm md:flex">
        {item.similarity === null ? (
          <span className="text-xs text-slate-500">{item.coverage > 0 ? '识别数据不足' : '未跟练'}</span>
        ) : (
          <>
            <span className="font-bold tabular-nums text-slate-950">{item.similarity}%</span>
            <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold', BAND_TONE[item.band as SimilarityBand])}>{SIMILARITY_BAND_LABEL[item.band as SimilarityBand]}</span>
            {item.syncShare !== null ? <span className="text-xs tabular-nums text-slate-500">同步 {item.syncShare}%</span> : null}
            {item.tempo ? <span className="text-xs font-semibold text-amber-800">{item.tempo === 'behind' ? '偏慢' : '偏快'}</span> : null}
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm font-bold tabular-nums text-slate-950 md:hidden">{item.similarity === null ? '—' : `${item.similarity}%`}</span>
        {chapter.kind === 'form' ? (
          <a href={routineTrainingPath(report.program.id, chapter.id)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`单独练习 ${chapterDisplayName(chapter)}`}><Play size={12} fill="currentColor" aria-hidden="true" />单练</a>
        ) : <span className="w-12" aria-hidden="true" />}
      </div>
    </li>
  )
}

function ChaptersSection({ report }: { report: RoutineReport }) {
  return (
    <section className="report-panel p-5 sm:p-6" aria-labelledby="routine-chapters-title" data-testid="routine-report-chapters">
      <SectionHeading id="routine-chapters-title" icon={Target} title="分段明细" description="按标准视频的段落列出完成度、跟练相似度与节奏；需要时可以单独练习某一段。" />
      <ol className="mt-4 divide-y divide-slate-100">
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
    <section className="report-panel p-5 sm:p-6" aria-labelledby="routine-progress-title" data-testid="routine-report-progress">
      <SectionHeading id="routine-progress-title" icon={History} title="相比上次" description={`与 ${formatDate(comparison.previousStartedAt)} 同一练习范围的记录比较。`} />
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 px-4 py-2.5"><dt className="text-xs text-slate-500">跟练相似度</dt><dd className="mt-0.5 font-bold text-slate-900">{similarity ?? '—'}</dd></div>
        <div className="rounded-xl bg-slate-50 px-4 py-2.5"><dt className="text-xs text-slate-500">节奏同步</dt><dd className="mt-0.5 font-bold text-slate-900">{sync ?? '—'}</dd></div>
      </dl>
      <a href={reportPath(comparison.previousId)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-bold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">查看上次报告</a>
    </section>
  )
}

function NotesSection({ report }: { report: RoutineReport }) {
  return (
    <section aria-labelledby="routine-notes-title" data-testid="routine-report-notes">
      <details className="group report-panel overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 marker:content-none sm:p-5">
          <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-700" aria-hidden="true"><Info size={18} /></span>
          <div className="min-w-0 flex-1"><h2 id="routine-notes-title" className="text-balance font-bold text-slate-950">数据说明</h2><p className="mt-0.5 text-pretty text-sm text-slate-500">查看比对方式与识别质量</p></div>
          <ChevronDown size={18} className="text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <ul className="space-y-1.5 border-t border-slate-100 px-4 pb-5 pt-4 text-pretty text-sm leading-6 text-slate-600 sm:px-5">
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
    <ReportLayout dataRoutine={report.program.id}>
      <RoutineReportHero report={report} />
      <SegmentsSection report={report} />
      <RoutineFocusSection report={report} />
      <ChaptersSection report={report} />
      <RoutineAnalyzerSection report={report} />
      <ProgressSection report={report} />
      {/* Folded (C4): the region breakdown, the technique explanation and the data notes, opened on demand. */}
      <div className="grid min-w-0 gap-3 lg:grid-cols-3 lg:items-start" data-testid="routine-report-folds">
        <OverviewSection report={report} />
        <ReportFold id="routine-technique-fold-title" title="评分说明 · 动作规范检查" summary={report.technique.score === null ? '查看已检查的动作要求与扣分依据' : <span className="tabular-nums">动作规范 {report.technique.score} 分 · 与跟练相似度分开评价</span>} testId="routine-technique-fold">
          <RoutineTechniqueSection report={report} />
        </ReportFold>
        <NotesSection report={report} />
      </div>
      <ReportActions
        title="带着重点，再练一次"
        description="下一次跟练会生成新的独立报告。"
        historyHref={HISTORY_PATH}
        againLabel="再练一次"
        onAgain={() => window.location.assign(routineTrainingPath(report.program.id, scope.kind === 'form' ? scope.chapterId : undefined))}
      />
    </ReportLayout>
  )
}
