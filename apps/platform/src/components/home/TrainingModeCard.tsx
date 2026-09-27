import { ArrowRight } from 'lucide-react'
import { MODE_STATUS_LABEL, modeEntryRoute, type ModeHubEntry } from '../../app/modeCatalog'
import { cn } from '../../lib/cn'
import { MODE_ACCENT } from './modeAccent'
import { ModeFigure } from './ModeFigure'
import { ModeMotifArt } from './ModeMotifArt'

/**
 * One training mode on Home. Every mode uses this same card and size; each carries its own pale tint, its
 * characteristic pose as a silhouette and a motion trail (plus a faint character for the classical forms). The
 * warm-up's light emphasis is its 推荐 badge and filled button only. A coming-soon mode renders as a static card: no
 * link, no button, no empty route.
 */
export function TrainingModeCard({ mode }: { mode: ModeHubEntry }) {
  const route = modeEntryRoute(mode)
  const accent = MODE_ACCENT[mode.accent]
  const Icon = mode.icon
  const descriptionId = `mode-${mode.id}-description`
  const recommended = Boolean(mode.badge)
  const body = (
    <>
      {mode.mark ? <span className={cn('fp-mode-mark absolute right-3 top-3 hidden md:block', accent.mark)} aria-hidden="true">{mode.mark}</span> : null}
      <ModeMotifArt motif={mode.motif} className={cn('absolute -right-8 bottom-3 hidden h-24 w-44 opacity-25 md:block', accent.motif)} />
      <ModeFigure
        motif={mode.motif}
        gradientId={`mode-figure-${mode.id}`}
        top={accent.figureTop}
        bottom={accent.figureBottom}
        className="absolute -bottom-1 right-9 h-[112%] w-auto opacity-35 md:-right-3 md:bottom-0 md:h-[64%] md:opacity-70"
      />
      {mode.badge ? <span className="fp-energy-gradient absolute left-0 top-0 hidden rounded-br-xl rounded-tl-2xl px-3 py-1 text-xs font-bold text-white md:inline-flex">{mode.badge}</span> : null}
      <span className="relative flex min-w-0 flex-1 items-center gap-4 md:flex-col md:items-stretch md:gap-0">
        <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl md:hidden', accent.icon)}><Icon size={23} aria-hidden="true" /></span>
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-lg font-bold text-slate-950 md:text-xl">{mode.title}</h3>
            {mode.badge ? <span className="fp-energy-gradient shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white md:hidden">{mode.badge}</span> : null}
            {!route ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{MODE_STATUS_LABEL[mode.status]}</span> : null}
          </span>
          {mode.meta ? <span className="mt-1 block truncate text-sm font-medium tabular-nums text-slate-500 md:text-[13px] md:tracking-tight">{mode.meta}</span> : null}
          {/* Two short lines beside the silhouette, split where the summary has its middle dot. */}
          {mode.summary ? <span className="mt-2 hidden max-w-[64%] text-[13px] leading-5 text-slate-600 md:block">{mode.summary.split(' · ').map((part) => <span key={part} className="block">{part}</span>)}</span> : null}
          <span id={descriptionId} className="sr-only">{mode.description}</span>
        </span>
        {route ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 text-sm font-bold md:mt-auto md:self-start md:rounded-full md:px-3.5 md:py-1.5',
              recommended ? 'text-blue-700 md:bg-blue-600 md:text-white md:shadow-[0_8px_18px_-10px_rgb(37_99_235/0.9)]' : 'text-blue-700 md:bg-white/90 md:shadow-sm md:ring-1 md:ring-slate-200/70',
            )}
            aria-hidden="true"
          >
            <span className="hidden md:inline">{mode.cta ?? '开始'}</span><ArrowRight size={17} />
          </span>
        ) : null}
      </span>
    </>
  )
  const surface = cn('relative flex h-full min-w-0 overflow-hidden rounded-2xl border p-4 md:min-h-[220px] md:p-5 md:pt-11', accent.surface)
  if (route) {
    return (
      <a
        href={route}
        className={cn(surface, 'fp-card-link group shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_30px_-22px_rgb(30_64_175/0.3)]', accent.hover)}
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
