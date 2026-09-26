import { lazy, Suspense } from 'react'
import { HomePage } from '../pages/Home/HomePage'
import { SmartTrainingPage } from '../pages/SmartTraining/SmartTrainingPage'
import { TrainingPage } from '../pages/Training/TrainingPage'
import { HISTORY_PATH, SMART_TRAINING_PATH, isTrainingRoute, parseRoutineRoute } from './routes'

const TrainingReportPage = lazy(async () => {
  const module = await import('../pages/Report/TrainingReportPage')
  return { default: module.TrainingReportPage }
})

const TrainingHistoryPage = lazy(async () => {
  const module = await import('../pages/History/TrainingHistoryPage')
  return { default: module.TrainingHistoryPage }
})

const RoutineRoutePage = lazy(async () => {
  const module = await import('../pages/Routines/RoutineRoutePage')
  return { default: module.RoutineRoutePage }
})

export default function App() {
  const { pathname, search } = window.location
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

  document.title = 'FormPilot'
  return <HomePage />
}
