import { lazy, Suspense } from 'react'
import { HomeV1Page } from '../pages/Web/HomeV1Page'
import { TrainingCenterPage } from '../pages/Web/TrainingCenterPage'
import { MePage } from '../pages/Web/MePage'
import { SettingsPage } from '../pages/Web/SettingsPage'
import { GamesCenterPage } from '../pages/Web/GamesCenterPage'
import { SmartTrainingPage } from '../pages/SmartTraining/SmartTrainingPage'
import { TrainingPage } from '../pages/Training/TrainingPage'
import { COACH_PATH, GAMES_PATH, HISTORY_PATH, ME_PATH, ME_SETTINGS_PATH, SMART_TRAINING_PATH, TRAINING_CENTER_PATH, isTrainingRoute, parseRoutineRoute, parseWorkshopRoute } from './routes'

const TrainingReportPage = lazy(async () => {
  const module = await import('../pages/Report/TrainingReportPage')
  return { default: module.TrainingReportPage }
})

const TrainingHistoryPage = lazy(async () => {
  const module = await import('../pages/History/TrainingHistoryPage')
  return { default: module.TrainingHistoryPage }
})

/** 动作工坊 and custom-action training load their own chunk, detector and recognizer only on these routes. */
const WorkshopRoutePage = lazy(async () => {
  const module = await import('../pages/Workshop/WorkshopRoutePage')
  return { default: module.WorkshopRoutePage }
})

/** AI Coach loads the decision engine (rules + fp-cdm weights) in its own chunk. */
const CoachPage = lazy(async () => {
  const module = await import('../pages/Web/CoachPage')
  return { default: module.CoachPage }
})

const RoutineRoutePage = lazy(async () => {
  const module = await import('../pages/Routines/RoutineRoutePage')
  return { default: module.RoutineRoutePage }
})

/** Public AI Coach demo (`pnpm demo:build` only; the constant check removes it from every other build). */
const PublicDemoApp = lazy(() => import('../publicDemo/PublicDemoApp'))

function WebLoading({ text }: { text: string }) {
  return <div className="grid min-h-dvh place-items-center bg-[#f7fafc] px-4 text-sm font-semibold text-slate-600" role="status">{text}</div>
}

export default function App() {
  if (import.meta.env.VITE_COACH_AGENT_MODE === 'public-demo') {
    return <Suspense fallback={<WebLoading text="正在打开 AI 教练在线演示…" />}><PublicDemoApp /></Suspense>
  }
  const { search } = window.location
  // Trailing slashes (e.g. /games/) open the same board.
  const pathname = window.location.pathname.length > 1 ? window.location.pathname.replace(/\/+$/, '') : window.location.pathname
  if (pathname === TRAINING_CENTER_PATH) {
    document.title = 'FormPilot · 训练中心'
    return <TrainingCenterPage />
  }
  if (pathname === GAMES_PATH) {
    document.title = 'FormPilot · 游戏中心'
    return <GamesCenterPage />
  }
  if (pathname === COACH_PATH) {
    document.title = 'FormPilot · AI Coach'
    return <Suspense fallback={<WebLoading text="正在打开 AI Coach…" />}><CoachPage /></Suspense>
  }
  if (pathname === ME_PATH) {
    document.title = 'FormPilot · 我的'
    return <MePage />
  }
  if (pathname === ME_SETTINGS_PATH) {
    document.title = 'FormPilot · 设备与设置'
    return <SettingsPage />
  }
  const reportMatch = pathname.match(/^\/report\/([^/]+)$/)
  if (reportMatch) {
    document.title = 'FormPilot · 训练报告'
    return (
      <Suspense fallback={<div className="grid min-h-dvh place-items-center bg-[#f5f7fa] px-4 text-sm font-semibold text-slate-600" role="status">正在读取训练报告…</div>}>
        <TrainingReportPage sessionId={decodeURIComponent(reportMatch[1])} />
      </Suspense>
    )
  }

  if (pathname === HISTORY_PATH) {
    document.title = 'FormPilot · 我的训练'
    return (
      <Suspense fallback={<div className="grid min-h-dvh place-items-center bg-[#f5f7fa] px-4 text-sm font-semibold text-slate-600" role="status">正在读取我的训练…</div>}>
        <TrainingHistoryPage />
      </Suspense>
    )
  }

  const workshopRoute = parseWorkshopRoute(pathname)
  if (workshopRoute) {
    document.title = workshopRoute.kind === 'train' ? 'FormPilot · 我的动作训练' : 'FormPilot · 动作工坊'
    return (
      <Suspense fallback={<div className="grid min-h-dvh place-items-center bg-[#f6f9fc] px-4 text-sm font-semibold text-slate-600" role="status">正在打开动作工坊…</div>}>
        <WorkshopRoutePage route={workshopRoute} />
      </Suspense>
    )
  }

  const routineRoute = parseRoutineRoute(pathname)
  if (routineRoute) {
    document.title = 'FormPilot · 跟练课程'
    return (
      <Suspense fallback={<div className="grid min-h-dvh place-items-center bg-[#f6f9fc] px-4 text-sm font-semibold text-slate-600" role="status">正在打开跟练课程…</div>}>
        <RoutineRoutePage route={routineRoute} />
      </Suspense>
    )
  }

  if (isTrainingRoute(pathname, search)) {
    document.title = 'FormPilot · 训练'
    return <TrainingPage />
  }

  if (pathname === SMART_TRAINING_PATH) {
    document.title = 'FormPilot · 热身训练'
    return <SmartTrainingPage />
  }

  if (pathname === '/' || pathname === '' || pathname === '/index.html') {
    document.title = 'FormPilot · AI 动作训练'
    return <HomeV1Page />
  }

  document.title = 'FormPilot · 页面不存在'
  return <NotFound />
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-[#f7fafc] px-4 text-center" data-testid="not-found">
      <div><p className="text-lg font-bold text-slate-900">没有找到这个页面</p><p className="mt-2 text-sm text-slate-600">链接可能已失效。</p><a className="mt-4 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" href="/">返回首页</a></div>
    </div>
  )
}
