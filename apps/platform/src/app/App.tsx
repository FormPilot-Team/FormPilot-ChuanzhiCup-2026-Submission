import { HomePage } from '../pages/Home/HomePage'
import { TrainingPage } from '../pages/Training/TrainingPage'
import { TrainingReportPage } from '../pages/Report/TrainingReportPage'

export default function App() {
  const { pathname, search } = window.location
  const reportMatch = pathname.match(/^\/report\/([^/]+)$/)
  if (reportMatch) {
    document.title = 'AI 电子教练 · 训练报告'
    return <TrainingReportPage sessionId={decodeURIComponent(reportMatch[1])} />
  }

  const legacyTrainingParams = ['demo', 'course', 'debug', 'fast', 'exercise', 'fixture', 'coachFixture']
  const params = new URLSearchParams(search)
  const usesLegacyTrainingEntry = pathname === '/' && legacyTrainingParams.some((key) => params.has(key))
  if (pathname === '/train' || usesLegacyTrainingEntry) {
    document.title = 'AI 电子教练 · 训练'
    return <TrainingPage />
  }

  document.title = 'AI 电子教练'
  return <HomePage />
}
