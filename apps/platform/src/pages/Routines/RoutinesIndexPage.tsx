import { ArrowLeft, ArrowRight, Gauge, ScanLine, Timer } from 'lucide-react'
import { HOME_PATH, routinePath } from '../../app/routes'
import { AppHeader } from '../../components/layout/AppHeader'
import { ROUTINE_ACCENT } from '../../components/routines/routineTheme'
import { ROUTINE_PROGRAMS } from '../../features/routines/programs'
import { formatClock, formCount } from '../../features/routines/scope'
import { cn } from '../../lib/cn'

const HOW_IT_WORKS = [
  { icon: ScanLine, title: '跟练相似度', text: '比较你与标准视频在同一时刻的身体姿态（上肢、躯干、下肢）。镜像跟练同样有效。' },
  { icon: Timer, title: '节奏', text: '判断你是否跟上视频：稍慢或稍快持续一段时间才会提醒。' },
  { icon: Gauge, title: '跟练报告', text: '结束后查看每一段的完成度、相似度与节奏，并与上次同范围的练习对比。' },
]

export function RoutinesIndexPage({ unknownRoutine = false }: { unknownRoutine?: boolean }) {
  return (
    <div className="fp-page min-h-dvh min-w-0 overflow-x-clip text-slate-900">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-[1200px] px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pb-16">
        <a href={HOME_PATH} className="mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft size={17} aria-hidden="true" />返回首页</a>
        <header>
          <h1 className="text-balance text-3xl font-bold text-slate-950 sm:text-4xl">跟练课程</h1>
          <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-600 sm:text-base">跟随标准示范视频练习八段锦、太极拳、五禽戏与易筋经，FormPilot 实时比对你的动作与节奏。</p>
        </header>
        {unknownRoutine ? (
          <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status" data-testid="routine-not-found">没有找到这个课程，请从下面选择一套开始。</p>
        ) : null}

        <ul className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="全部跟练课程" data-testid="routines-index">
          {ROUTINE_PROGRAMS.map((program) => {
            const accent = ROUTINE_ACCENT[program.accent]
            return (
              <li key={program.id} className="min-w-0">
                <a href={routinePath(program.id)} className="panel group flex h-full min-w-0 flex-col overflow-hidden hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid={`routine-card-${program.id}`}>
                  <div className="aspect-video w-full overflow-hidden bg-slate-950">
                    <img src={program.video.posterSrc} alt="" aria-hidden="true" className="size-full object-cover" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-balance text-xl font-bold text-slate-950">{program.title}</h2>
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', accent.chip)}>{program.subtitle}</span>
                    </div>
                    <p className="mt-2 flex-1 text-pretty text-sm leading-6 text-slate-600">{program.description}</p>
                    <p className="mt-3 flex items-center justify-between gap-3 text-sm">
                      <span className="tabular-nums text-slate-500">全套 {formatClock(program.video.durationSeconds)} · {formCount(program)} {program.formUnit}</span>
                      <span className="inline-flex items-center gap-1 font-bold text-blue-700 group-hover:text-blue-800">查看<ArrowRight size={16} aria-hidden="true" /></span>
                    </p>
                  </div>
                </a>
              </li>
            )
          })}
        </ul>

        <section className="mt-8 grid gap-4 md:grid-cols-3" aria-label="跟练如何评估">
          {HOW_IT_WORKS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-slate-200/80 bg-white/70 p-5">
              <p className="flex items-center gap-2 font-bold text-slate-900"><Icon size={18} className="text-blue-600" aria-hidden="true" />{title}</p>
              <p className="mt-2 text-pretty text-sm leading-6 text-slate-600">{text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
