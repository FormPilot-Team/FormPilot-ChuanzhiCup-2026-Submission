import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, CircleCheck, Clock3, Eye, History, ListOrdered, Play, ScanLine } from 'lucide-react'
import { ROUTINES_PATH, reportPath, routineTrainingPath } from '../../app/routes'
import { AppHeader } from '../../components/layout/AppHeader'
import { RoutineDemoVideo, type DemoRequest } from '../../components/routines/RoutineDemoVideo'
import { ROUTINE_ACCENT } from '../../components/routines/routineTheme'
import { loadRoutineHistory } from '../../features/history/routineHistory'
import { chapterDisplayName, formatClock, formCount, scopeTitle } from '../../features/routines/scope'
import { LocalStorageRoutineSessionRepository, type RoutineSessionRepository } from '../../features/routines/session/RoutineSessionRepository'
import type { RoutineProgram } from '../../features/routines/types'
import { cn } from '../../lib/cn'
import { formatDate } from '../Report/reportPresentation'

const localRepository = new LocalStorageRoutineSessionRepository()

const ROUTINE_PREPARATION = [
  '站到离屏幕约 2.5–3 米处，头部到双脚完整入镜',
  '正面面对摄像头，保证基本光线',
  '双手在胸前合拢并保持，开始跟练；中途可用暂停键或空格暂停',
  '视频含原声口令，可在训练页随时开关视频原声与语音提示',
]

function RecentRuns({ program, repository }: { program: RoutineProgram; repository: RoutineSessionRepository }) {
  const items = useMemo(() => {
    const history = loadRoutineHistory(repository)
    return history.status === 'ready' ? history.items.filter((item) => item.record.programId === program.id).slice(0, 5) : []
  }, [program.id, repository])
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="routine-recent-title" data-testid="routine-recent">
      <h2 id="routine-recent-title" className="flex items-center gap-2 text-balance text-lg font-bold text-slate-950"><History size={18} className="text-slate-500" aria-hidden="true" />最近跟练</h2>
      {items.length ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.record.id} className="py-3 first:pt-1 last:pb-0">
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
      ) : <p className="mt-3 text-pretty text-sm leading-6 text-slate-500">还没有{program.title}的跟练记录。完成一次后，这里会显示完成度与跟练相似度的变化。</p>}
    </section>
  )
}

export function RoutineEntryPage({ program, repository = localRepository }: { program: RoutineProgram; repository?: RoutineSessionRepository }) {
  const accent = ROUTINE_ACCENT[program.accent]
  const forms = formCount(program)
  const extras = program.chapters.length - forms
  const [demo, setDemo] = useState<DemoRequest | null>(null)
  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900" data-routine={program.id}>
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1200px] px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pb-16">
        <a href={ROUTINES_PATH} className="mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid="routine-back"><ArrowLeft size={17} aria-hidden="true" />返回功法训练</a>

        <section className="panel grid min-w-0 gap-6 overflow-hidden p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,.95fr)] lg:items-center lg:gap-10 lg:p-8" aria-labelledby="routine-title" data-testid="routine-entry">
          <div className="min-w-0">
            <p className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold', accent.chip)}>跟练课程 · {program.subtitle}</p>
            <h1 id="routine-title" className="mt-4 text-balance text-3xl font-bold text-slate-950 sm:text-4xl">{program.title}</h1>
            <p className="mt-3 max-w-xl text-pretty text-sm leading-6 text-slate-600 sm:text-base">{program.description}</p>
            <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2"><Clock3 size={16} className="text-slate-400" aria-hidden="true" /><dt className="sr-only">时长</dt><dd className="font-semibold tabular-nums text-slate-800">全套 {formatClock(program.video.durationSeconds)}</dd></div>
              <div className="flex items-center gap-2"><ListOrdered size={16} className="text-slate-400" aria-hidden="true" /><dt className="sr-only">组成</dt><dd className="font-semibold text-slate-800">{forms} {program.formUnit}{extras ? ` · 含${program.chapters.filter((chapter) => chapter.kind !== 'form').map((chapter) => chapter.name).join('与')}` : ''}</dd></div>
            </dl>
            <a href={routineTrainingPath(program.id)} className="primary-button mt-6 inline-flex items-center justify-center gap-2 px-6 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" data-testid="routine-start-full">开始整套跟练<ArrowRight size={18} aria-hidden="true" /></a>
          </div>
          <RoutineDemoVideo program={program} request={demo} />
        </section>

        <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="routine-forms-title" data-testid="routine-forms">
            <h2 id="routine-forms-title" className="text-balance text-lg font-bold text-slate-950">动作组成</h2>
            <p className="mt-1 text-pretty text-sm text-slate-500">按标准视频顺序排列。可以整套跟练，也可以单独练习某一{program.formUnit}。</p>
            <ol className="mt-4 grid gap-2 sm:grid-cols-2">
              {program.chapters.map((chapter) => (
                <li key={chapter.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums', chapter.kind === 'form' ? accent.chip : 'bg-white text-slate-500')}>{chapter.kind === 'form' ? chapter.formNumber : chapter.kind === 'opening' ? '起' : '收'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900" title={chapterDisplayName(chapter)}>{chapter.kind === 'form' && chapter.label !== chapter.name ? chapter.name : chapterDisplayName(chapter)}</p>
                    <p className="text-xs tabular-nums text-slate-500">{chapter.kind === 'form' ? `${chapter.label} · ` : ''}{formatClock(chapter.endSeconds - chapter.startSeconds)}</p>
                  </div>
                  <button type="button" onClick={() => setDemo({ token: Date.now(), startSeconds: chapter.startSeconds, label: chapterDisplayName(chapter) })} aria-label={`观看示范 ${chapterDisplayName(chapter)}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid={`routine-demo-${chapter.id}`}><Eye size={12} aria-hidden="true" />示范</button>
                  {chapter.kind === 'form' ? (
                    <a href={routineTrainingPath(program.id, chapter.id)} aria-label={`单独练习 ${chapterDisplayName(chapter)}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid={`routine-form-${chapter.id}`}><Play size={12} fill="currentColor" aria-hidden="true" />单练</a>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
          <div className="grid min-w-0 content-start gap-5">
            <aside className="min-w-0 rounded-2xl bg-blue-50/70 p-5 sm:p-6" aria-labelledby="routine-prep-title">
              <h2 id="routine-prep-title" className="flex items-center gap-2 font-bold text-slate-900"><ScanLine size={18} className="text-blue-600" aria-hidden="true" />训练开始前</h2>
              <ul className="mt-3 space-y-2.5">
                {ROUTINE_PREPARATION.map((item) => <li key={item} className="flex items-start gap-2.5 text-pretty text-sm font-medium leading-6 text-slate-700"><CircleCheck size={17} className="mt-[3px] shrink-0 text-emerald-500" aria-hidden="true" />{item}</li>)}
              </ul>
              <p className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-slate-500"><Camera size={15} aria-hidden="true" />摄像头画面仅用于本次实时识别</p>
            </aside>
            <RecentRuns program={program} repository={repository} />
          </div>
        </div>
      </main>
    </div>
  )
}
