import { Bot, Dumbbell, History, House, Leaf, type LucideIcon } from 'lucide-react'
import { HISTORY_PATH, HOME_PATH, ROUTINES_PATH, SMART_TRAINING_PATH, isTrainingRoute, parseRoutineRoute } from '../../app/routes'
import { cn } from '../../lib/cn'

type NavKey = 'home' | 'training' | 'routines' | 'history'

const NAV_ITEMS: ReadonlyArray<{ key: NavKey; href: string; label: string; icon: LucideIcon }> = [
  { key: 'home', href: HOME_PATH, label: '首页', icon: House },
  { key: 'training', href: SMART_TRAINING_PATH, label: '智能训练', icon: Dumbbell },
  { key: 'routines', href: ROUTINES_PATH, label: '功法跟练', icon: Leaf },
  { key: 'history', href: HISTORY_PATH, label: '训练记录', icon: History },
]

function activeNav(pathname: string, search: string): NavKey | undefined {
  if (pathname === SMART_TRAINING_PATH || isTrainingRoute(pathname, search)) return 'training'
  if (parseRoutineRoute(pathname)) return 'routines'
  if (pathname === HISTORY_PATH || pathname.startsWith('/report/')) return 'history'
  return pathname === HOME_PATH ? 'home' : undefined
}

export function AppHeader() {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  const search = typeof window === 'undefined' ? '' : window.location.search
  const active = activeNav(pathname, search)
  return (
    <header className="border-b border-slate-200/80 bg-white">
      <div className="mx-auto flex h-18 min-w-0 max-w-[1600px] items-center gap-2 px-4 sm:gap-4 lg:px-8">
        <a href={HOME_PATH} className="flex min-w-0 shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <span className="grid size-10 place-items-center rounded-2xl bg-blue-500 text-white shadow-sm"><Bot size={23} aria-hidden="true" /></span>
          {/* Phones need the width for four navigation items; the wordmark stays the link's accessible name. */}
          <div className="sr-only sm:not-sr-only">
            <p className="text-lg font-bold text-slate-900">FormPilot</p>
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
                active === key ? 'bg-blue-50 font-semibold text-blue-600' : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700',
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
