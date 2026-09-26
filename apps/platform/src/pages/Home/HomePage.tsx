import { useEffect, useMemo, useRef, useState } from 'react'
import { START_TRAINING_ANCHOR } from '../../app/routes'
import { TRAINING_MODES, WORKSHOP_ENTRY } from '../../app/modeCatalog'
import { HomeHero } from '../../components/home/HomeHero'
import { MyActionsStrip } from '../../components/home/MyActionsStrip'
import { MyTrainingSummary } from '../../components/home/MyTrainingSummary'
import { TrainingModeCard } from '../../components/home/TrainingModeCard'
import { WorkshopTeaser } from '../../components/home/WorkshopTeaser'
import { AICoach } from '../../components/aiCoach/AICoach'
import { AppHeader } from '../../components/layout/AppHeader'
import { OnboardingDialog } from '../../components/onboarding/OnboardingDialog'
import { historyEntryDigest } from '../../features/aiCoach/digests'
import type { CoachPageContext } from '../../features/aiCoach/types'
import { buildRecentReports } from '../../features/coachContext/recentReports'
import { loadTrainingHistory } from '../../features/history/TrainingHistory'
import { mergeHistoryEntries } from '../../features/history/historyEntries'
import { buildHomeTrainingSummary } from '../../features/history/homeSummary'
import { loadRoutineHistory } from '../../features/history/routineHistory'
import { loadCustomHistory } from '../../features/history/customHistory'
import { recordOnboarding, shouldAutoOpenOnboarding, type OnboardingOutcome } from '../../features/onboarding/onboarding'
import { LocalStorageRoutineSessionRepository, type RoutineSessionRepository } from '../../features/routines/session/RoutineSessionRepository'
import { LocalStorageTrainingSessionRepository } from '../../features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionRepository } from '../../features/training/TrainingSessionRepository'
import { LocalStorageCustomSessionRepository, type CustomSessionRepository } from '../../features/workshop/session'
import { LocalStorageCustomActionRepository, type CustomActionRepository } from '../../features/workshop/store'

const localRepository = new LocalStorageTrainingSessionRepository()
const localRoutineRepository = new LocalStorageRoutineSessionRepository()
const localCustomRepository = new LocalStorageCustomSessionRepository()
const localActionRepository = new LocalStorageCustomActionRepository()

interface HomePageProps {
  repository?: TrainingSessionRepository
  routineRepository?: RoutineSessionRepository
  customRepository?: CustomSessionRepository
  actionRepository?: CustomActionRepository
  /** Clock for "this week"; tests pin it. */
  now?: number
}

/**
 * Home answers "what do you want to do now": start one of five equal training modes, build your own action in
 * 动作工坊, or see how your training is going. Each history source loads on its own, so one failing never hides the other.
 */
export function HomePage({ repository = localRepository, routineRepository = localRoutineRepository, customRepository = localCustomRepository, actionRepository = localActionRepository, now }: HomePageProps) {
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldAutoOpenOnboarding())
  const trainingHeadingRef = useRef<HTMLHeadingElement>(null)
  const history = useMemo(() => {
    const smart = loadTrainingHistory(repository)
    const routine = loadRoutineHistory(routineRepository)
    const custom = loadCustomHistory(customRepository)
    const smartItems = smart.status === 'ready' ? smart.items : []
    const routineItems = routine.status === 'ready' ? routine.items : []
    const customItems = custom.status === 'ready' ? custom.items : []
    const entries = mergeHistoryEntries(smartItems, routineItems, customItems)
    const latest = entries.find((entry) => !entry.incomplete)
    return {
      summary: buildHomeTrainingSummary(entries, now ?? Date.now()),
      unavailable: smart.status === 'error' || routine.status === 'error' || custom.status === 'error',
      recent: buildRecentReports(smartItems, routineItems, 5, customItems),
      latest: latest ? historyEntryDigest(latest) : null,
    }
  }, [customRepository, now, repository, routineRepository])
  const myActions = useMemo(() => {
    const actions = actionRepository.load().actions
    // Most recently trained first, then most recently edited.
    let sessions: ReturnType<CustomSessionRepository['list']> = []
    try { sessions = customRepository.list() } catch { sessions = [] }
    const lastTrained = new Map<string, number>()
    for (const session of sessions) lastTrained.set(session.actionId, Math.max(lastTrained.get(session.actionId) ?? 0, session.startedAt))
    const ranked = [...actions].sort((left, right) => (lastTrained.get(right.id) ?? 0) - (lastTrained.get(left.id) ?? 0) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    return { shown: ranked.slice(0, 3), total: actions.length }
  }, [actionRepository, customRepository])

  // "开始训练" in the header links to /#start-training. The section only exists after React renders, so the
  // browser's own fragment scroll can miss it on a cross-page visit.
  useEffect(() => {
    if (window.location.hash !== `#${START_TRAINING_ANCHOR}`) return
    const heading = trainingHeadingRef.current
    heading?.scrollIntoView({ block: 'start' })
    heading?.focus({ preventScroll: true })
  }, [])

  const coachContext: CoachPageContext = { page: 'home', recent: history.recent, latest: history.latest, week: { count: history.summary.weekCount, previous: history.summary.previousWeekCount } }

  const closeOnboarding = (outcome: OnboardingOutcome) => {
    recordOnboarding(outcome)
    setOnboardingOpen(false)
  }

  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <HomeHero onOpenGuide={() => setOnboardingOpen(true)} />

        <section id={START_TRAINING_ANCHOR} className="mt-8 scroll-mt-4 sm:mt-10" aria-labelledby="start-training-title" data-testid="home-start-training">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <h2 id="start-training-title" ref={trainingHeadingRef} tabIndex={-1} className="fp-section-title focus:outline-none">开始训练</h2>
            <p className="text-pretty text-sm text-slate-500">选一种训练，FormPilot 会实时识别你的动作</p>
          </div>
          <ul className="mt-4 grid gap-3 md:grid-cols-6 md:gap-4" aria-label="训练模式" data-testid="home-training-modes">
            {TRAINING_MODES.map((mode, index) => (
              <li key={mode.id} className={index < 3 ? 'min-w-0 md:col-span-2' : 'min-w-0 md:col-span-3'}>
                <TrainingModeCard mode={mode} />
              </li>
            ))}
          </ul>
          <MyActionsStrip actions={myActions.shown} total={myActions.total} />
        </section>

        <div className="mt-8 grid min-w-0 gap-4 sm:mt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-5">
          <WorkshopTeaser entry={WORKSHOP_ENTRY} />
          <MyTrainingSummary summary={history.summary} unavailable={history.unavailable} />
        </div>
      </main>
      <AICoach context={coachContext} />
      <OnboardingDialog open={onboardingOpen} onClose={closeOnboarding} />
    </div>
  )
}
