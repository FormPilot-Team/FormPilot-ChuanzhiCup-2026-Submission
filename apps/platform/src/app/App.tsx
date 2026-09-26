import { lazy, Suspense } from 'react'
import { HomePage } from '../pages/Home/HomePage'
import { TrainingPage } from '../pages/Training/TrainingPage'

const TrainingReportPage = lazy(async () => {
  const module = await import('../pages/Report/TrainingReportPage')
  return { default: module.TrainingReportPage }
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

  const legacyTrainingParams = ['demo', 'course', 'debug', 'fast', 'exercise', 'fixture', 'coachFixture']
  const params = new URLSearchParams(search)
  const usesLegacyTrainingEntry = pathname === '/' && legacyTrainingParams.some((key) => params.has(key))
  if (pathname === '/train' || usesLegacyTrainingEntry) {
    document.title = 'FormPilot · 训练'
    return <TrainingPage />
  }

  document.title = 'FormPilot'
  return <HomePage />
}
