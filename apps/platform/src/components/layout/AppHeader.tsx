import { Bot, ChartLine, Dumbbell, House, type LucideIcon, WandSparkles } from 'lucide-react'
import { HISTORY_PATH, HOME_PATH, SMART_TRAINING_PATH, START_TRAINING_PATH, WORKSHOP_PATH, isTrainingRoute, parseRoutineRoute, parseWorkshopRoute } from '../../app/routes'
import { cn } from '../../lib/cn'

type NavKey = 'home' | 'training' | 'workshop' | 'history'

/** Product language: 开始训练 leads to Home's training section (no extra page), 动作工坊 to /workshop, 我的训练 to History. */
const NAV_ITEMS: ReadonlyArray<{ key: NavKey; href: string; label: string; icon: LucideIcon }> = [
  { key: 'home', href: HOME_PATH, label: '首页', icon: House },
  { key: 'training', href: START_TRAINING_PATH, label: '开始训练', icon: Dumbbell },
  { key: 'workshop', href: WORKSHOP_PATH, label: '动作工坊', icon: WandSparkles },
  { key: 'history', href: HISTORY_PATH, label: '我的训练', icon: ChartLine },
]

function activeNav(pathname: string, search: string): NavKey | undefined {
  if (pathname === SMART_TRAINING_PATH || isTrainingRoute(pathname, search) || parseRoutineRoute(pathname)) return 'training'
  const workshop = parseWorkshopRoute(pathname)
  if (workshop) return workshop.kind === 'train' ? 'training' : 'workshop'
  if (pathname === HISTORY_PATH || pathname.startsWith('/report/')) return 'history'
  return pathname === HOME_PATH ? 'home' : undefined
}

export function AppHeader() {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  const search = typeof window === 'undefined' ? '' : window.location.search
  const active = activeNav(pathname, search)
  return (
    <header className="border-b border-slate-200/70 bg-white/85">
      <div className="mx-auto flex h-18 min-w-0 max-w-[1600px] items-center gap-2 px-4 sm:gap-4 lg:px-8">
        <a href={HOME_PATH} className="flex min-w-0 shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <span className="fp-energy-gradient grid size-10 place-items-center rounded-2xl text-white shadow-[0_8px_18px_-10px_rgb(14_165_233/0.9)]"><Bot size={23} aria-hidden="true" /></span>
          {/* Phones need the width for the navigation items; the wordmark stays the link's accessible name. */}
          <div className="sr-only sm:not-sr-only">
            <p className="text-lg font-bold tracking-tight text-slate-900">FormPilot</p>
            <p className="hidden text-xs text-slate-500 sm:block">实时识别 · 动作纠正 · 训练复盘</p>
          </div>
        </a>
        <nav className="ml-auto flex items-center gap-1" aria-label="主导航">
          {NAV_ITEMS.map(({ key, href, label, icon: Icon }) => (
            <a
              key={key}
              href={href}
              aria-current={active === key ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-xl px-2 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:px-3 sm:text-sm',
                active === key ? 'bg-blue-50 font-semibold text-blue-700' : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800',
              )}
            >
              <Icon size={17} className="hidden sm:block" aria-hidden="true" />{label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  )
}
