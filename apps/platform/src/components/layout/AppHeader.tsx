import { Activity, Bot, House } from 'lucide-react'

export function AppHeader() {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  const search = typeof window === 'undefined' ? '' : window.location.search
  const trainingActive = pathname === '/train' || (pathname === '/' && search.length > 0)
  return (
    <header className="border-b border-slate-200/80 bg-white">
      <div className="mx-auto flex h-18 min-w-0 max-w-[1600px] items-center gap-4 px-4 lg:px-8">
        <a href="/" className="flex min-w-0 shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none">
          <span className="grid size-10 place-items-center rounded-2xl bg-blue-500 text-white shadow-sm"><Bot size={23} /></span>
          <div>
            <p className="text-lg font-bold text-slate-900">FormPilot</p>
            <p className="hidden text-xs text-slate-500 sm:block">实时识别 · 动作纠正 · 训练复盘</p>
          </div>
        </a>
        <nav className="ml-auto flex items-center gap-1" aria-label="主导航">
          <a href="/" aria-current={!trainingActive && pathname === '/' ? 'page' : undefined} className={!trainingActive && pathname === '/' ? 'flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-600' : 'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50'}><House size={17} />首页</a>
          <a href="/train" aria-current={trainingActive ? 'page' : undefined} className={trainingActive ? 'flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-600' : 'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50'}><Activity size={17} />训练</a>
        </nav>
      </div>
    </header>
  )
}
