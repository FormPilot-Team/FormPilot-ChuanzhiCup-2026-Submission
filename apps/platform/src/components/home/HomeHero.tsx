import { BookOpen } from 'lucide-react'
import { COACH_NAME, COACH_WELCOME_ASSET } from '../coach/coachIdentity'

/** Compact brand hero: what FormPilot does, and the coach welcoming you. The guide is a small utility entry here. */
export function HomeHero({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <section className="fp-hero relative isolate overflow-hidden rounded-3xl border border-white/80 shadow-[0_18px_40px_-28px_rgb(30_64_175/0.35)]" aria-labelledby="home-title" data-testid="home-hero">
      {/* Motion arcs: the coach's welcome gesture traced as a trajectory. Decorative. */}
      <svg viewBox="0 0 520 300" fill="none" aria-hidden="true" focusable="false" className="pointer-events-none absolute -right-10 bottom-0 -z-10 h-full w-[70%] max-w-[560px] text-sky-400/50 sm:w-[58%]">
        <path d="M40 280 C120 120 300 40 500 30" stroke="currentColor" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round" />
        <path d="M110 300 C190 170 330 100 520 96" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".6" />
        <circle cx="304" cy="66" r="5" fill="#fff" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="472" cy="32" r="4" fill="#fff" stroke="currentColor" strokeWidth="2" />
      </svg>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(104px,34%)] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(200px,38%)] lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 self-center px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
          <p className="hidden max-w-full items-center gap-2 rounded-2xl bg-white/80 px-3 py-1 text-xs font-semibold leading-5 text-blue-700 shadow-sm ring-1 ring-blue-100 sm:inline-flex">
            <span className="fp-energy-gradient size-2 shrink-0 rounded-full" aria-hidden="true" />
            <span>实时识别 · 动作纠正 · 训练复盘</span>
          </p>
          <h1 id="home-title" className="fp-brand-gradient bg-clip-text sm:mt-3 pb-1 text-4xl font-bold tracking-tight text-transparent sm:text-5xl">FormPilot</h1>
          <p className="mt-1 text-pretty text-base leading-7 text-slate-700 sm:text-lg">实时识别你的动作，及时纠正，练完就能复盘。</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <p className="relative rounded-2xl rounded-tr-md bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-[0_8px_20px_-14px_rgb(30_64_175/0.55)] ring-1 ring-slate-100" data-testid="home-coach-welcome">
              <span className="sr-only">{COACH_NAME}：</span>今天想练什么？我会陪你完成训练。
            </p>
            <button type="button" onClick={onOpenGuide} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white/80 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" data-testid="home-guide">
              <BookOpen size={16} aria-hidden="true" />使用说明
            </button>
          </div>
        </div>
        <div className="relative h-[184px] min-w-0 self-end sm:h-[248px] lg:h-[280px]">
          <img
            src={COACH_WELCOME_ASSET}
            alt={`${COACH_NAME}向你打招呼`}
            width={600}
            height={703}
            className="absolute inset-0 size-full object-contain object-right-bottom mix-blend-multiply [mask-image:linear-gradient(to_bottom,#000_78%,transparent)] sm:object-bottom"
            draggable={false}
            data-testid="home-coach-image"
          />
        </div>
      </div>
    </section>
  )
}
