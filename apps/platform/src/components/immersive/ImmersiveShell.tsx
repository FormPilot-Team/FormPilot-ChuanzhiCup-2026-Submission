import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useEffect, useId, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { FormPilotMark } from '../layout/FormPilotMark'

/**
 * The dark immersive training shell (Web V1.1 visual spec): no first-level navigation, one top bar with the exit, the
 * title and the training status, then the training content. Browsing, creating and report pages stay light.
 */
export function ImmersiveShell({ topBar, children, className, testId }: { topBar: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn('imm-shell', className)} data-theme="immersive" data-testid={testId}>
      {topBar}
      <main className="imm-main">{children}</main>
    </div>
  )
}

export function ImmersiveTopBar({ exit, title, subtitle, status, actions }: { exit: ReactNode; title: ReactNode; subtitle?: ReactNode; status?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="imm-topbar">
      <span className="flex shrink-0 items-center gap-2" aria-label="FormPilot"><FormPilotMark className="size-7" /><span className="imm-hide-md text-sm font-bold tracking-tight text-white">FormPilot</span></span>
      {exit}
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="min-w-0 truncate text-base font-bold text-white sm:text-lg">{title}</h1>
        {subtitle ? <p className="imm-hide-sm min-w-0 truncate text-xs text-slate-400 sm:text-sm">{subtitle}</p> : null}
      </div>
      {status}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/**
 * 详细数据: secondary live data (checks, similarity by region, camera status, chapter points) folded away so the
 * training view shows one correction at a time. The content stays mounted while closed, so nothing it measures is
 * lost; it is only hidden.
 */
export function DetailsDrawer({ open, onOpenChange, title = '详细数据', children }: { open: boolean; onOpenChange: (open: boolean) => void; title?: string; children: ReactNode }) {
  const id = useId()
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenChange, open])
  return (
    <aside id={id} className="imm-drawer" data-open={open ? 'true' : 'false'} aria-label={title} hidden={!open} data-testid="details-drawer">
      <div className="flex items-center gap-2 px-1 pb-2">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100" onClick={() => onOpenChange(false)} data-testid="details-close">
          <PanelRightClose size={15} aria-hidden="true" />收起
        </button>
      </div>
      <div className="grid min-w-0 gap-3">{children}</div>
    </aside>
  )
}

export function DetailsToggle({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <button type="button" className="imm-ghost" aria-expanded={open} onClick={() => onOpenChange(!open)} data-testid="details-toggle">
      {open ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}<span className="hidden sm:inline">详细数据</span>
    </button>
  )
}
