import type { ModeMotif } from '../../app/modeCatalog'
import { cn } from '../../lib/cn'
import { MODE_FIGURES } from './modeFigures'

/**
 * A mode's characteristic pose as a soft silhouette (landmarks from the mode's own reference data, see
 * modeFigures.ts). One gradient paints the whole figure, so overlapping limbs never darken each other.
 */
export function ModeFigure({ motif, gradientId, top, bottom, className }: { motif: ModeMotif; gradientId: string; top: string; bottom: string; className?: string }) {
  const figure = MODE_FIGURES[motif]
  const paint = `url(#${gradientId})`
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={cn('pointer-events-none', className)} data-figure={motif}>
      <defs>
        {/* User-space units: a perfectly vertical limb has an empty bounding box and would not be painted otherwise. */}
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
          <stop offset="0" stopColor="currentColor" className={top} />
          <stop offset="1" stopColor="currentColor" className={bottom} />
        </linearGradient>
      </defs>
      <g fill={paint} stroke={paint} strokeLinecap="round" strokeLinejoin="round">
        <path d={figure.torso} strokeWidth={figure.torsoRound} />
        {figure.segments.map(([x1, y1, x2, y2, width]) => <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={width} />)}
        <circle cx={figure.head[0]} cy={figure.head[1]} r={figure.head[2]} stroke="none" />
      </g>
    </svg>
  )
}
