import { useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, CircleCheck, Hand, ListChecks, Play, ScanLine } from 'lucide-react'
import { HOME_PATH, TRAINING_PATH } from '../../app/routes'
import { AppHeader } from '../../components/layout/AppHeader'
import { OnboardingDialog } from '../../components/onboarding/OnboardingDialog'
import { recordOnboarding, type OnboardingOutcome } from '../../features/onboarding/onboarding'
import { FREE_TRAINING_OPTIONS } from './freeTrainingOptions'

const PREPARATION_ITEMS = [
  '训练过程中请根据动作提示调整站位，确保所需身体区域完整入镜',
  '进入下肢动作时，请确保全身完整可见',
  '正面面对摄像头',
  '保证基本光线',
  '留出足够活动空间',
]

export function SmartTrainingPage() {
  const [guideOpen, setGuideOpen] = useState(false)
  const closeGuide = (outcome: OnboardingOutcome) => {
    recordOnboarding(outcome)
    setGuideOpen(false)
  }
  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#f6f9fc] text-slate-900">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1200px] px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pb-16">
        <a href={HOME_PATH} className="mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={17} aria-hidden="true" />返回首页</a>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-balance text-3xl font-bold text-slate-950 sm:text-4xl">智能训练</h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-600 sm:text-base">实时姿态识别、AI 纠错与语音指导，训练结束后自动生成报告。</p>
          </div>
          <button type="button" onClick={() => setGuideOpen(true)} className="secondary-button inline-flex items-center justify-center gap-2 self-start sm:self-auto">
            <Hand size={17} aria-hidden="true" />开始 / 暂停手势
          </button>
        </header>

        <section className="panel mt-6 grid min-w-0 gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)] lg:gap-10 lg:p-8" aria-labelledby="full-course-title" data-testid="full-course-entry">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700"><ListChecks size={14} aria-hidden="true" />6 个动作 · 标准课程</p>
            <h2 id="full-course-title" className="mt-4 text-balance text-2xl font-bold text-slate-950">完整训练</h2>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 sm:text-base">依次完成 6 个动作，获得完整训练报告和历史比较。</p>
            <ol className="mt-5 grid grid-cols-2 gap-2 xl:grid-cols-3" aria-label="完整训练动作顺序">
              {FREE_TRAINING_OPTIONS.map((option, index) => (
                <li key={option.exerciseId} className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-xs font-bold tabular-nums text-blue-600 shadow-sm">{index + 1}</span>
                  <span className="truncate text-sm font-semibold text-slate-800">{option.name}</span>
                </li>
              ))}
            </ol>
            <a href={TRAINING_PATH} className="primary-button mt-6 inline-flex items-center justify-center gap-2 px-6 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">开始完整训练<ArrowRight size={18} aria-hidden="true" /></a>
          </div>
          <aside className="min-w-0 rounded-2xl bg-blue-50/70 p-5 sm:p-6" aria-labelledby="preparation-title">
            <h3 id="preparation-title" className="flex items-center gap-2 font-bold text-slate-900"><ScanLine size={18} className="text-blue-600" aria-hidden="true" />训练开始前</h3>
            <ul className="mt-4 space-y-3">
              {PREPARATION_ITEMS.map((item) => <li key={item} className="flex items-start gap-2.5 text-pretty text-sm font-medium leading-6 text-slate-700"><CircleCheck size={17} className="mt-[3px] shrink-0 text-emerald-500" aria-hidden="true" />{item}</li>)}
            </ul>
            <p className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-slate-500"><Camera size={15} aria-hidden="true" />摄像头画面仅用于本次实时识别</p>
          </aside>
        </section>

        <section className="mt-8" aria-labelledby="free-training-title" data-testid="free-training-entry">
          <h2 id="free-training-title" className="text-balance text-2xl font-bold text-slate-950">自由训练</h2>
          <p className="mt-1 text-pretty text-sm leading-6 text-slate-600 sm:text-base">选择一个动作单独练习，适合针对性训练。</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FREE_TRAINING_OPTIONS.map((option) => (
              <li key={option.exerciseId} className="min-w-0">
                <a
                  href={option.href}
                  aria-label={`开始${option.name}`}
                  aria-describedby={`free-${option.exerciseId}-detail`}
                  data-testid={`free-training-${option.exerciseId}`}
                  className="panel group flex h-full min-w-0 items-center gap-4 p-4 hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:p-5"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-slate-950">{option.name}</h3>
                    <p id={`free-${option.exerciseId}-detail`} className="mt-1 text-pretty text-sm text-slate-500">{option.focus}<span className="mx-1.5 text-slate-300" aria-hidden="true">·</span><span className="tabular-nums">{option.target}</span></p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 group-hover:bg-blue-100" aria-hidden="true"><Play size={14} fill="currentColor" />开始</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <OnboardingDialog open={guideOpen} onClose={closeGuide} initialStepId="start-gesture" />
    </div>
  )
}
