import { useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, CircleCheck, Clock3 } from 'lucide-react'
import { GUIDE_ENTRY, MODE_STATUS_LABEL, PRIMARY_TRAINING_MODE, ROUTINE_MODES, TOOL_ENTRIES, modeEntryRoute, type ModeHubEntry, type ModeStatus } from '../../app/modeCatalog'
import { HISTORY_PATH, reportPath } from '../../app/routes'
import { AppHeader } from '../../components/layout/AppHeader'
import { OnboardingDialog } from '../../components/onboarding/OnboardingDialog'
import { PoseRecognitionIllustration } from '../../components/onboarding/OnboardingIllustrations'
import { historyScoreText, loadTrainingHistory } from '../../features/history/TrainingHistory'
import { loadRoutineHistory, mergeHistoryEntries } from '../../features/history/routineHistory'
import { recordOnboarding, shouldAutoOpenOnboarding, type OnboardingOutcome } from '../../features/onboarding/onboarding'
import { scopeTitle } from '../../features/routines/scope'
import { LocalStorageRoutineSessionRepository, type RoutineSessionRepository } from '../../features/routines/session/RoutineSessionRepository'
import { LocalStorageTrainingSessionRepository } from '../../features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionRepository } from '../../features/training/TrainingSessionRepository'
import { freeTrainingLabel } from '../../features/training/trainingScope'
import { cn } from '../../lib/cn'
import { formatDate } from '../Report/reportPresentation'

const localRepository = new LocalStorageTrainingSessionRepository()
const localRoutineRepository = new LocalStorageRoutineSessionRepository()

function StatusBadge({ status }: { status: ModeStatus }) {
  const available = status === 'available'
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', available ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
      {available ? <CircleCheck size={13} aria-hidden="true" /> : <Clock3 size={13} aria-hidden="true" />}
      {MODE_STATUS_LABEL[status]}
    </span>
  )
}

/** The primary training mode: the largest card and the only one with a strong call to action. */
function PrimaryModeCard({ mode }: { mode: ModeHubEntry }) {
  const route = modeEntryRoute(mode)
  const Icon = mode.icon
  return (
    <article className="panel flex min-w-0 flex-col overflow-hidden p-6 sm:p-8" aria-labelledby={`mode-${mode.id}-title`} data-testid={`mode-card-${mode.id}`}>
      <div className="grid min-w-0 flex-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(180px,.62fr)] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600"><Icon size={24} aria-hidden="true" /></span>
            <StatusBadge status={mode.status} />
          </div>
          <h3 id={`mode-${mode.id}-title`} className="mt-5 text-balance text-3xl font-bold text-slate-950">{mode.title}</h3>
          <p className="mt-3 max-w-xl text-pretty text-base leading-7 text-slate-600">{mode.description}</p>
          {mode.highlights?.length ? (
            <ul className="mt-5 flex flex-wrap gap-2" aria-label={`${mode.title}功能`}>
              {mode.highlights.map((item) => <li key={item} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">{item}</li>)}
            </ul>
          ) : null}
        </div>
        <div className="mx-auto hidden w-full max-w-[240px] md:block" aria-hidden="true"><PoseRecognitionIllustration /></div>
      </div>
      {route ? (
        <a href={route} className="primary-button mt-7 inline-flex items-center justify-center gap-2 self-start px-6 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" aria-label={`${mode.cta ?? '进入'} · ${mode.title}`}>
          {mode.cta ?? '进入'}<ArrowRight size={18} aria-hidden="true" />
        </a>
      ) : null}
    </article>
  )
}

/** Secondary training modes. A coming-soon mode renders as a static card: no link, no button, no empty route. */
function ModeCard({ mode }: { mode: ModeHubEntry }) {
  const route = modeEntryRoute(mode)
  const Icon = mode.icon
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-2xl', route ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500')}><Icon size={22} aria-hidden="true" /></span>
        <h3 id={`mode-${mode.id}-title`} className={cn('min-w-0 flex-1 text-balance text-xl font-bold', route ? 'text-slate-950' : 'text-slate-700')}>{mode.title}</h3>
        <StatusBadge status={mode.status} />
      </div>
      <p className="mt-3 text-pretty text-sm leading-6 text-slate-500">{mode.description}</p>
      {route ? <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700">{mode.cta ?? '进入'}<ArrowRight size={16} aria-hidden="true" /></p> : null}
    </>
  )
  if (route) {
    return <a href={route} className="panel block min-w-0 p-5 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:p-6" data-testid={`mode-card-${mode.id}`}>{body}</a>
  }
  return <article className="min-w-0 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5 sm:p-6" aria-labelledby={`mode-${mode.id}-title`} data-testid={`mode-card-${mode.id}`}>{body}</article>
}

/** Phrasing content only, so the same body is valid inside a link, a static card and the 使用说明 button. */
function ToolCardBody({ icon: Icon, title, description, status, action }: {
  icon: ModeHubEntry['icon']
  title: string
  description: string
  status?: ModeStatus
  action?: string
}) {
  const available = status !== 'coming_soon'
  return (
    <span className="flex min-w-0 items-start gap-3.5">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100', available ? 'text-slate-700' : 'text-slate-400')}><Icon size={20} aria-hidden="true" /></span>
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <strong className={cn('font-bold', available ? 'text-slate-950' : 'text-slate-600')}>{title}</strong>
          {status ? <StatusBadge status={status} /> : null}
        </span>
        <span className="mt-1 block text-pretty text-sm leading-6 text-slate-500">{description}</span>
        {action ? <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-700">{action}<ArrowRight size={15} aria-hidden="true" /></span> : null}
      </span>
    </span>
  )
}

function ToolCard({ entry }: { entry: ModeHubEntry }) {
  const route = modeEntryRoute(entry)
  const body = <ToolCardBody icon={entry.icon} title={entry.title} description={entry.description} status={entry.status} action={route ? '查看' : undefined} />
  if (route) {
    return <a href={route} className="panel block min-w-0 p-5 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid={`tool-card-${entry.id}`}>{body}</a>
  }
  return <article className="min-w-0 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5" aria-label={entry.title} data-testid={`tool-card-${entry.id}`}>{body}</article>
}

/** The latest finished training in any mode. Each source loads on its own, so one failing never hides the other. */
function RecentTraining({ repository, routineRepository }: { repository: TrainingSessionRepository; routineRepository: RoutineSessionRepository }) {
  const latest = useMemo(() => {
    const smart = loadTrainingHistory(repository)
    const routine = loadRoutineHistory(routineRepository)
    return mergeHistoryEntries(smart.status === 'ready' ? smart.items : [], routine.status === 'ready' ? routine.items : [])
      .find((entry) => !entry.incomplete)
  }, [repository, routineRepository])
  const summary = latest?.kind === 'smart'
    ? { label: latest.smart.scope.kind === 'free_training' ? freeTrainingLabel(latest.smart.scope.exerciseId) : undefined, score: historyScoreText(latest.smart.analysis, latest.smart.scope) }
    : latest?.kind === 'routine'
      ? { label: scopeTitle(latest.routine.report.program, latest.routine.record.scope), score: latest.routine.report.headline }
      : undefined
  return (
    <section className="mt-6 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="recent-training-title" data-testid="home-training-history">
      <div className="flex min-w-0 items-center gap-3">
        <CalendarDays size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
        <div className="min-w-0 text-sm">
          <h2 id="recent-training-title" className="inline font-bold text-slate-900">最近训练</h2>
          {latest && summary ? (
            <p className="mt-0.5 text-pretty leading-6 tabular-nums text-slate-600 sm:ml-3 sm:mt-0 sm:inline">
              <time dateTime={new Date(latest.startedAt).toISOString()}>{formatDate(latest.startedAt)}</time>
              {summary.label ? <><span className="mx-2 text-slate-300" aria-hidden="true">·</span>{summary.label}</> : null}
              <span className="mx-2 text-slate-300" aria-hidden="true">·</span><span className="font-semibold text-slate-800">{summary.score}</span>
            </p>
          ) : <p className="mt-0.5 text-slate-500 sm:ml-3 sm:mt-0 sm:inline">还没有训练记录</p>}
        </div>
      </div>
      <a href={latest ? reportPath(latest.id) : HISTORY_PATH} className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:self-auto">{latest ? '查看报告' : '查看训练记录'}<ArrowRight size={16} aria-hidden="true" /></a>
    </section>
  )
}

export function HomePage({ repository = localRepository, routineRepository = localRoutineRepository }: { repository?: TrainingSessionRepository; routineRepository?: RoutineSessionRepository }) {
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldAutoOpenOnboarding())
  const closeOnboarding = (outcome: OnboardingOutcome) => {
    recordOnboarding(outcome)
    setOnboardingOpen(false)
  }
  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#f6f9fc] text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-[1200px] px-4 pb-12 pt-7 sm:px-6 sm:pt-10 lg:px-8 lg:pb-16">
        <header>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">FormPilot</h1>
          <p className="mt-3 text-pretty text-base text-slate-600 sm:text-lg">实时动作识别与智能训练指导</p>
        </header>

        <section className="mt-8 sm:mt-10" aria-labelledby="modes-title">
          <h2 id="modes-title" className="text-balance text-lg font-bold text-slate-900">今天想用 FormPilot 做什么？</h2>
          <div className="mt-4">
            <PrimaryModeCard mode={PRIMARY_TRAINING_MODE} />
          </div>
          <div className="mt-6" role="group" aria-labelledby="routine-modes-title">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p id="routine-modes-title" className="text-balance font-bold text-slate-900">功法跟练</p>
              <p className="text-pretty text-sm text-slate-500">跟随标准示范视频练习，实时比对动作与节奏</p>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ROUTINE_MODES.map((mode) => <ModeCard key={mode.id} mode={mode} />)}
            </div>
          </div>
        </section>

        <section className="mt-8" aria-labelledby="tools-title">
          <h2 id="tools-title" className="text-balance text-lg font-bold text-slate-900">工具与记录</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {TOOL_ENTRIES.map((entry) => <ToolCard key={entry.id} entry={entry} />)}
            <button type="button" onClick={() => setOnboardingOpen(true)} className="panel block min-w-0 p-5 text-left hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid="tool-card-guide">
              <ToolCardBody icon={GUIDE_ENTRY.icon} title={GUIDE_ENTRY.title} description={GUIDE_ENTRY.description} action="打开" />
            </button>
          </div>
        </section>

        <RecentTraining repository={repository} routineRepository={routineRepository} />
      </main>
      <OnboardingDialog open={onboardingOpen} onClose={closeOnboarding} />
    </div>
  )
}
