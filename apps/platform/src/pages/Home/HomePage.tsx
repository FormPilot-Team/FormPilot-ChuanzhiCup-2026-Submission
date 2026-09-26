import { ArrowRight, Bot, CalendarDays, Camera, CircleCheck, Dumbbell, History, Lightbulb, ScanLine } from 'lucide-react'
import { AppHeader } from '../../components/layout/AppHeader'
import { ELECTRONIC_COACH_COURSE_V1 } from '../../features/course/CourseDefinition'
import { getExerciseDefinition } from '../../features/exercises/registry'
import { historyScoreText, loadTrainingHistory } from '../../features/history/TrainingHistory'
import { LocalStorageTrainingSessionRepository } from '../../features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionRepository } from '../../features/training/TrainingSessionRepository'
import { formatDate } from '../Report/reportPresentation'

const preparationItems = [
  '训练过程中请根据动作提示调整站位，确保所需身体区域完整入镜',
  '进入下肢动作时，请确保全身完整可见',
  '正面面对摄像头',
  '保证基本光线',
  '留出足够活动空间',
]

const courseItems = ELECTRONIC_COACH_COURSE_V1.steps.map((step) => step.exerciseId === 'step_jack' ? '侧步开合' : getExerciseDefinition(step.exerciseId).displayName)

const localRepository = new LocalStorageTrainingSessionRepository()

export function HomePage({ repository = localRepository }: { repository?: TrainingSessionRepository }) {
  const history = loadTrainingHistory(repository)
  const latest = history.status === 'ready' ? history.items.find((item) => !item.incomplete) : undefined
  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#f6f9fc] text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-[1280px] px-4 pb-12 pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pb-16">
        <section className="panel overflow-hidden px-5 py-8 sm:px-8 sm:py-10 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)] lg:items-center lg:gap-10 lg:px-12 lg:py-12" aria-labelledby="home-title">
          <div>
            <p className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700"><Bot size={17} />六动作实时训练课程</p>
            <h1 id="home-title" className="mt-5 max-w-2xl text-balance text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">FormPilot</h1>
            <p className="mt-4 max-w-2xl text-pretty text-base leading-7 text-slate-600 sm:text-lg">实时识别训练动作，并提供针对性的动作纠正与训练复盘。</p>
            <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" onClick={() => window.location.assign('/train')} className="primary-button inline-flex items-center justify-center gap-2 px-6 py-3 text-base">开始训练<ArrowRight size={18} /></button>
              <a href="/history" className="secondary-button inline-flex items-center justify-center gap-2 px-5 py-3 text-base"><History size={18} />训练记录</a>
            </div>
          </div>
          <div className="mt-8 rounded-3xl bg-blue-50/80 p-5 sm:p-6 lg:mt-0">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm"><ScanLine size={22} /></span>
              <div><p className="font-bold text-slate-900">训练开始前</p><p className="text-sm text-slate-500">准备好摄像头与活动空间</p></div>
            </div>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {preparationItems.map((item) => <li key={item} className="flex items-center gap-3 text-sm font-medium text-slate-700"><CircleCheck size={18} className="shrink-0 text-emerald-500" />{item}</li>)}
            </ul>
          </div>
        </section>

        <section className="panel mt-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" aria-labelledby="recent-training-title" data-testid="home-training-history">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><CalendarDays size={20} aria-hidden="true" /></span>
            <div className="min-w-0"><h2 id="recent-training-title" className="text-balance font-bold text-slate-950">最近训练</h2>{latest ? <p className="mt-1 text-pretty text-sm leading-6 tabular-nums text-slate-600"><time dateTime={new Date(latest.session.startedAt).toISOString()}>{formatDate(latest.session.startedAt)}</time><span className="mx-2 text-slate-300" aria-hidden="true">·</span><span className="font-semibold text-slate-800">{historyScoreText(latest.analysis)}</span></p> : <p className="mt-1 text-pretty text-sm text-slate-500">还没有训练记录</p>}</div>
          </div>
          <a href={latest ? `/report/${encodeURIComponent(latest.session.id)}` : '/history'} className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:self-auto">{latest ? '查看报告' : '查看训练记录'}<ArrowRight size={16} aria-hidden="true" /></a>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" aria-labelledby="course-overview-title">
          <div className="panel p-5 sm:p-7">
            <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><Dumbbell size={20} /></span><div><h2 id="course-overview-title" className="text-xl font-bold text-slate-900">六动作课程概览</h2><p className="mt-0.5 text-sm text-slate-500">依次完成热身与全身动作训练</p></div></div>
            <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {courseItems.map((name, index) => <li key={name} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3.5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-sm font-bold tabular-nums text-blue-600 shadow-sm">{index + 1}</span><span className="font-semibold text-slate-800">{name}</span></li>)}
            </ol>
          </div>
          <aside className="panel flex items-start gap-3 p-5 sm:p-6" aria-label="训练说明">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><Lightbulb size={20} /></span>
            <div><h2 className="font-bold text-slate-900">实时反馈，完成后复盘</h2><p className="mt-2 text-pretty text-sm leading-6 text-slate-600">训练过程中查看动作提示与纠正建议，课程结束后进入报告查看本次表现。</p><p className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-slate-500"><Camera size={15} />摄像头画面仅用于本次实时识别</p></div>
          </aside>
        </section>
      </main>
    </div>
  )
}
