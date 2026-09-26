import { ArrowRight } from 'lucide-react'
import { MODE_STATUS_LABEL, modeEntryRoute, type ModeHubEntry } from '../../app/modeCatalog'
import { cn } from '../../lib/cn'
import { MODE_ACCENT } from './modeAccent'
import { ModeMotifArt } from './ModeMotifArt'

/**
 * One training mode on Home. Every mode uses this same card and size; the warm-up's light emphasis is its badge and
 * filled icon tile only. A coming-soon mode renders as a static card: no link, no button, no empty route.
 */
export function TrainingModeCard({ mode }: { mode: ModeHubEntry }) {
  const route = modeEntryRoute(mode)
  const accent = MODE_ACCENT[mode.accent]
  const Icon = mode.icon
  const descriptionId = `mode-${mode.id}-description`
  const body = (
    <>
      <ModeMotifArt motif={mode.motif} className={cn('absolute -right-3 top-4 hidden h-24 w-40 opacity-60 md:block', accent.motif)} />
      <span className="relative flex min-w-0 flex-1 items-center gap-4 md:flex-col md:items-stretch md:gap-0">
        <span className="flex shrink-0 items-center gap-2">
          <span className={cn('grid size-12 place-items-center rounded-2xl', accent.icon)}><Icon size={23} aria-hidden="true" /></span>
          {mode.badge ? <span className="fp-energy-gradient hidden rounded-full px-2.5 py-1 text-xs font-bold text-white shadow-sm md:inline-flex">{mode.badge}</span> : null}
        </span>
        <span className="block min-w-0 flex-1 md:mt-5">
          <span className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-lg font-bold text-slate-950 md:text-xl">{mode.title}</h3>
            {mode.badge ? <span className="fp-energy-gradient shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white md:hidden">{mode.badge}</span> : null}
            {!route ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{MODE_STATUS_LABEL[mode.status]}</span> : null}
          </span>
          {mode.meta ? <span className="mt-1 block truncate text-sm font-medium tabular-nums text-slate-500">{mode.meta}</span> : null}
          <span id={descriptionId} className="mt-2 hidden text-pretty text-sm leading-6 text-slate-600 md:line-clamp-2">{mode.description}</span>
        </span>
        <ModeMotifArt motif={mode.motif} className={cn('h-10 w-16 shrink-0 opacity-70 md:hidden', accent.motif)} />
        {route ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-blue-700 md:mt-auto md:pt-4" aria-hidden="true">
            <span className="hidden md:inline">{mode.cta ?? '开始'}</span><ArrowRight size={18} />
          </span>
        ) : null}
      </span>
    </>
  )
  const surface = cn('relative flex h-full min-w-0 overflow-hidden rounded-2xl border bg-gradient-to-br from-white via-white p-4 md:min-h-[212px] md:p-5', accent.tint)
  if (route) {
    return (
      <a
        href={route}
        className={cn(surface, 'fp-card-link border-slate-200/70 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_30px_-20px_rgb(30_64_175/0.25)]')}
        aria-label={`${mode.cta ?? '开始'} · ${mode.title}`}
        aria-describedby={descriptionId}
        data-testid={`mode-card-${mode.id}`}
        data-mode-accent={mode.accent}
      >
        {body}
      </a>
    )
  }
  return <article className={cn(surface, 'border-dashed border-slate-300')} aria-label={mode.title} data-testid={`mode-card-${mode.id}`}>{body}</article>
}
