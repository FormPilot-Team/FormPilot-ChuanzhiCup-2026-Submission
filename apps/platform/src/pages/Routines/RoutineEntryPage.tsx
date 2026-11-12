import { useMemo, useState } from 'react'
import { ArrowRight, Camera, CircleCheck, Clock3, Eye, History, ListOrdered, Play, ScanLine } from 'lucide-react'
import { ROUTINES_PATH, reportPath, routineTrainingPath } from '../../app/routes'
import { AppHeader } from '../../components/layout/AppHeader'
import { RoutineDemoVideo, type DemoRequest } from '../../components/routines/RoutineDemoVideo'
import { ROUTINE_ACCENT } from '../../components/routines/routineTheme'
import { loadRoutineHistory, type RoutineHistoryItem } from '../../features/history/routineHistory'
import { chapterPoints } from '../../features/routines/followAlong/liveChecks'
import { isReliableRoutineSession, type RoutineChapterReport, type SimilarityBand } from '../../features/routines/report/routineReport'
import { chapterDisplayName, formatClock, formCount, scopeTitle } from '../../features/routines/scope'
import { LocalStorageRoutineSessionRepository, type RoutineSessionRepository } from '../../features/routines/session/RoutineSessionRepository'
import type { RoutineChapter, RoutineProgram } from '../../features/routines/types'
import { cn } from '../../lib/cn'
import { formatDate } from '../Report/reportPresentation'

const localRepository = new LocalStorageRoutineSessionRepository()

const ROUTINE_PREPARATION = [
  '站到离屏幕约 2.5–3 米处，头部到双脚完整入镜',
  '正面面对摄像头，保证基本光线',
  '双手在胸前合拢并保持，开始跟练；中途可用暂停键或空格暂停',
  '视频含原声口令，可在训练页随时开关视频原声与语音提示',
]

const BAND_TEXT: Readonly<Record<SimilarityBand, string>> = { high: 'text-emerald-700', fair: 'text-amber-700', low: 'text-coral-600' }
const BAND_FILL: Readonly<Record<SimilarityBand, string>> = { high: 'bg-emerald-400/70', fair: 'bg-amber-300/90', low: 'bg-coral-500/80' }

/**
 * What the detail page may say about the user's own history: the latest reliable whole-routine run (live, normal
 * mode, finished, matcher available) and, from its report, the per-chapter similarity where that chapter had enough
 * samples and the weakest chapter when the report names one. Nothing is shown without such a run.
 */
interface RoutineHistoryView {
  items: RoutineHistoryItem[]
  lastFull: RoutineHistoryItem | null
  chapterSimilarity: Map<string, RoutineChapterReport>
  weakest: RoutineChapterReport | null
}

function historyView(program: RoutineProgram, repository: RoutineSessionRepository): RoutineHistoryView {
  const history = loadRoutineHistory(repository)
  const items = history.status === 'ready' ? history.items.filter((item) => item.record.programId === program.id) : []
  const lastFull = items.find((item) => item.record.scope.kind === 'full' && isReliableRoutineSession(item.record) && item.record.programVersion === program.version) ?? null
  const chapterSimilarity = new Map<string, RoutineChapterReport>()
  for (const chapter of lastFull?.report.chapters ?? []) if (chapter.enoughData && chapter.similarity !== null) chapterSimilarity.set(chapter.chapter.id, chapter)
  const weakestReport = lastFull?.report.weakestChapter
  const weakest = weakestReport && weakestReport.enoughData && weakestReport.similarity !== null && weakestReport.chapter.kind === 'form' ? weakestReport : null
  return { items, lastFull, chapterSimilarity, weakest }
}

function chapterMark(chapter: RoutineChapter): string {
  return chapter.kind === 'form' ? String(chapter.formNumber) : chapter.kind === 'opening' ? '起' : '收'
}

function chapterShort(chapter: RoutineChapter): string {
  return chapter.kind === 'form' ? `${chapter.formNumber} ${chapter.name.slice(0, 4)}` : chapter.label
}

function RecentRuns({ program, items }: { program: RoutineProgram; items: RoutineHistoryItem[] }) {
  const recent = items.slice(0, 5)
  return (
    <section className="panel p-5" aria-labelledby="routine-recent-title" data-testid="routine-recent">
      <h2 id="routine-recent-title" className="flex items-center gap-2 text-balance font-bold text-slate-950"><History size={17} className="text-slate-500" aria-hidden="true" />最近跟练</h2>
      {recent.length ? (
        <ul className="mt-2 divide-y divide-slate-100">
          {recent.map((item) => (
            <li key={item.record.id} className="py-2.5 first:pt-1 last:pb-0">
              <a href={reportPath(item.record.id)} className="group flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    <time dateTime={new Date(item.record.startedAt).toISOString()}>{formatDate(item.record.startedAt)}</time>
                    <span className="mx-2 text-slate-300" aria-hidden="true">·</span>{scopeTitle(program, item.record.scope).replace(`${program.title} · `, '')}
                  </p>
                  <p className="mt-0.5 text-pretty text-sm tabular-nums text-slate-600">{item.report.headline}{item.incomplete ? ' · 未完成' : ''}</p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-slate-400 group-hover:text-blue-600" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-pretty text-sm leading-6 text-slate-500">还没有{program.title}的跟练记录。完成一次后，这里会显示完成度与跟练相似度的变化。</p>}
    </section>
  )
}

/**
 * 功法详情 (Web V1.1, C1): a large standard demonstration, the routine as one chapter bar, the selected chapter with
 * its cue and movement requirements, a continue card, and the chapter list with the user's own last result. History
 * figures appear only from a real reliable run; with no such run the page shows the course alone.
 */
export function RoutineEntryPage({ program, repository = localRepository }: { program: RoutineProgram; repository?: RoutineSessionRepository }) {
  const accent = ROUTINE_ACCENT[program.accent]
  const forms = formCount(program)
  const extras = program.chapters.length - forms
  const [demo, setDemo] = useState<DemoRequest | null>(null)
  const view = useMemo(() => historyView(program, repository), [program, repository])
  const [selectedId, setSelectedId] = useState<string>(() => view.weakest?.chapter.id ?? program.chapters.find((chapter) => chapter.kind === 'form')?.id ?? program.chapters[0].id)
  const selected = program.chapters.find((chapter) => chapter.id === selectedId) ?? program.chapters[0]
  const selectedResult = view.chapterSimilarity.get(selected.id)
  const points = chapterPoints(program.id, selected)
  const playChapter = (chapter: RoutineChapter) => setDemo({ token: Date.now(), startSeconds: chapter.startSeconds, label: chapterDisplayName(chapter) })
  const totalSeconds = program.video.durationSeconds
  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900" data-routine={program.id}>
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1320px] px-4 pb-12 pt-4 sm:px-6 lg:px-8 lg:pb-16">
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-slate-500" aria-label="位置">
          <a href={ROUTINES_PATH} className="rounded-md px-1 py-0.5 font-semibold hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid="routine-back">返回功法训练</a>
          <span aria-hidden="true">/</span><b className="text-slate-800">{program.title}</b>
        </nav>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div className="min-w-0" data-testid="routine-entry">
            <RoutineDemoVideo program={program} request={demo} />

            <div className="mt-4" data-testid="routine-chapter-bar" aria-label="章节时长与上次结果">
              <div className="flex h-2.5 gap-1">
                {program.chapters.map((chapter) => {
                  const result = view.chapterSimilarity.get(chapter.id)
                  return (
                    <button
                      key={chapter.id}
                      type="button"
                      onClick={() => setSelectedId(chapter.id)}
                      title={chapterDisplayName(chapter)}
                      aria-label={`查看${chapterDisplayName(chapter)}`}
                      className={cn('h-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', result?.band ? BAND_FILL[result.band] : 'bg-slate-300/50', chapter.id === selected.id && 'ring-[3px] ring-blue-400/50')}
                      style={{ flex: `${Math.max(1, chapter.endSeconds - chapter.startSeconds)} 1 0%` }}
                      data-chapter-id={chapter.id}
                      data-chapter-similarity={result?.similarity ?? ''}
                    />
                  )
                })}
              </div>
              <div className="mt-1.5 hidden gap-1 text-[11px] text-slate-500 sm:flex" aria-hidden="true">
                {program.chapters.map((chapter) => (
                  <span key={chapter.id} className={cn('min-w-0 truncate', chapter.id === selected.id && 'font-bold text-slate-900')} style={{ flex: `${Math.max(1, chapter.endSeconds - chapter.startSeconds)} 1 0%` }}>{chapterShort(chapter)}</span>
                ))}
              </div>
            </div>

            <section className="panel mt-4 grid min-w-0 gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" aria-labelledby="routine-selected-title" data-testid="routine-selected-chapter" data-chapter-id={selected.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="routine-selected-title" className="text-balance text-xl font-bold text-slate-950">{chapterDisplayName(selected)}</h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{formatClock(selected.endSeconds - selected.startSeconds)}</span>
                  {selectedResult?.similarity != null && selectedResult.band ? (
                    <span className={cn('rounded-full bg-white px-2.5 py-0.5 text-xs font-bold tabular-nums ring-1 ring-slate-200', BAND_TEXT[selectedResult.band])} data-testid="routine-selected-last">
                      上次 {selectedResult.similarity}%{view.weakest?.chapter.id === selected.id ? ' · 本套最低' : ''}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-pretty text-sm leading-6 text-slate-600">要领：{selected.cue}</p>
                {points.points.length ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="本段动作要求">
                    {points.points.map((point) => <li key={point.id} className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold', accent.chip)} title={point.cue}>{point.name}</li>)}
                  </ul>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 sm:grid">
                {selected.kind === 'form' ? (
                  <a href={routineTrainingPath(program.id, selected.id)} className="fp-cta-dark" data-testid="routine-selected-train">单练这一{program.formUnit}<ArrowRight size={16} aria-hidden="true" /></a>
                ) : null}
                <button type="button" onClick={() => playChapter(selected)} className="secondary-button inline-flex items-center justify-center gap-1.5" data-testid="routine-selected-demo"><Eye size={15} aria-hidden="true" />看本段示范</button>
              </div>
            </section>
          </div>

          <aside className="grid min-w-0 content-start gap-4">
            <div>
              <p className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold', accent.chip)}>跟练课程 · {program.subtitle}</p>
              <h1 className="mt-3 text-balance text-4xl font-bold tracking-tight text-slate-950">{program.title}</h1>
              <p className="mt-2 text-pretty text-sm leading-6 text-slate-600">{program.description}</p>
              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                <div className="flex items-center gap-2"><Clock3 size={15} className="text-slate-400" aria-hidden="true" /><dt className="sr-only">时长</dt><dd className="font-semibold tabular-nums text-slate-800">全套 {formatClock(totalSeconds)}</dd></div>
                <div className="flex items-center gap-2"><ListOrdered size={15} className="text-slate-400" aria-hidden="true" /><dt className="sr-only">组成</dt><dd className="font-semibold text-slate-800">{forms} {program.formUnit}{extras ? ` · 含${program.chapters.filter((chapter) => chapter.kind !== 'form').map((chapter) => chapter.name).join('与')}` : ''}</dd></div>
              </dl>
            </div>

            <section className="panel p-5" aria-labelledby="routine-continue-title" data-testid="routine-continue" data-has-history={view.lastFull ? 'true' : 'false'}>
              <div className="flex items-center justify-between gap-3">
                <h2 id="routine-continue-title" className="font-bold text-slate-950">{view.lastFull ? '继续练习' : '开始练习'}</h2>
                {view.lastFull ? (
                  <span className="text-xs tabular-nums text-slate-500" data-testid="routine-continue-last">上次 {formatDate(view.lastFull.record.startedAt)}{view.lastFull.report.similarity !== null ? ` · 整套 ${view.lastFull.report.similarity}%` : ''}</span>
                ) : null}
              </div>
              {view.weakest ? (
                <p className="mt-2 text-pretty text-sm text-slate-600" data-testid="routine-recommendation">上次相似度最低的是{chapterDisplayName(view.weakest.chapter)}（{view.weakest.similarity}%）。建议先单练这一{program.formUnit}，再完整跟练一遍。</p>
              ) : (
                <p className="mt-2 text-pretty text-sm text-slate-600">{view.lastFull ? '上次的分段数据不足以判断最需要练的一段，可以直接整套跟练。' : '跟着标准视频整套练习，或从右侧列表单独练习某一' + program.formUnit + '。'}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {view.weakest ? (
                  <a href={routineTrainingPath(program.id, view.weakest.chapter.id)} className="fp-cta flex-1" data-testid="routine-recommended-train">单练{view.weakest.chapter.label}</a>
                ) : null}
                <a href={routineTrainingPath(program.id)} className={cn(view.weakest ? 'fp-cta-dark' : 'fp-cta', 'flex-1')} data-testid="routine-start-full">开始整套跟练 · {formatClock(totalSeconds)}<ArrowRight size={16} aria-hidden="true" /></a>
              </div>
            </section>

            <section className="panel min-w-0 p-3" aria-labelledby="routine-forms-title" data-testid="routine-forms">
              <div className="flex items-baseline justify-between gap-2 px-2 pb-1 pt-1">
                <h2 id="routine-forms-title" className="font-bold text-slate-950">动作组成</h2>
                <span className="text-xs text-slate-500">{view.lastFull ? '右侧为上次相似度' : '按标准视频顺序'}</span>
              </div>
              <ol className="grid gap-0.5">
                {program.chapters.map((chapter) => {
                  const result = view.chapterSimilarity.get(chapter.id)
                  const current = chapter.id === selected.id
                  return (
                    <li key={chapter.id} className={cn('flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5', current && 'bg-blue-50/80 ring-1 ring-blue-200')}>
                      <button type="button" onClick={() => setSelectedId(chapter.id)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-pressed={current} data-testid={`routine-chapter-${chapter.id}`}>
                        <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums', chapter.kind === 'form' ? accent.chip : 'bg-slate-100 text-slate-500')}>{chapterMark(chapter)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900" title={chapterDisplayName(chapter)}>{chapter.kind === 'form' && chapter.label !== chapter.name ? chapter.name : chapterDisplayName(chapter)}</span>
                          <span className="block text-xs tabular-nums text-slate-500">{chapter.kind === 'form' ? `${chapter.label} · ` : ''}{formatClock(chapter.endSeconds - chapter.startSeconds)}</span>
                        </span>
                        {result?.band ? <span className={cn('shrink-0 text-xs font-bold tabular-nums', BAND_TEXT[result.band])}>{result.similarity}%</span> : null}
                      </button>
                      <button type="button" onClick={() => playChapter(chapter)} aria-label={`观看示范 ${chapterDisplayName(chapter)}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid={`routine-demo-${chapter.id}`}><Eye size={12} aria-hidden="true" />示范</button>
                      {chapter.kind === 'form' ? (
                        <a href={routineTrainingPath(program.id, chapter.id)} aria-label={`单独练习 ${chapterDisplayName(chapter)}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid={`routine-form-${chapter.id}`}><Play size={12} fill="currentColor" aria-hidden="true" />单练</a>
                      ) : <span className="w-[46px] shrink-0" aria-hidden="true" />}
                    </li>
                  )
                })}
              </ol>
            </section>

            <aside className="min-w-0 rounded-2xl bg-blue-50/70 p-5" aria-labelledby="routine-prep-title">
              <h2 id="routine-prep-title" className="flex items-center gap-2 font-bold text-slate-900"><ScanLine size={17} className="text-blue-600" aria-hidden="true" />训练开始前</h2>
              <ul className="mt-2.5 space-y-2">
                {ROUTINE_PREPARATION.map((item) => <li key={item} className="flex items-start gap-2.5 text-pretty text-sm leading-6 text-slate-700"><CircleCheck size={16} className="mt-[4px] shrink-0 text-emerald-500" aria-hidden="true" />{item}</li>)}
              </ul>
              <p className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-slate-500"><Camera size={15} aria-hidden="true" />摄像头画面仅用于本次实时识别</p>
            </aside>
            <RecentRuns program={program} items={view.items} />
          </aside>
        </div>
      </main>
    </div>
  )
}
