import { useId } from 'react'

/** Geometry of the app icon; `tests/app-icon.test.ts` keeps it identical to public/favicon.svg. */
export const FORMPILOT_MARK = Object.freeze({
  stroke: 'M19 50V29.5Q19 21 27.5 19.8L35 18.8M19 36H30.5',
  dot: { cx: 46, cy: 16.8, r: 5.6 },
  tileRadius: 15,
  gradient: ['#3b82f6', '#1d4ed8'] as const,
})

/** The FormPilot app icon, inline, for the header brand. The tab, window and EXE use the generated files. */
export function FormPilotMark({ className }: { className?: string }) {
  const gradientId = `fp-tile-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" data-testid="app-brand-mark">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={FORMPILOT_MARK.gradient[0]} />
          <stop offset="1" stopColor={FORMPILOT_MARK.gradient[1]} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={FORMPILOT_MARK.tileRadius} fill={`url(#${gradientId})`} />
      <path d={FORMPILOT_MARK.stroke} fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={FORMPILOT_MARK.dot.cx} cy={FORMPILOT_MARK.dot.cy} r={FORMPILOT_MARK.dot.r} fill="#fff" />
    </svg>
  )
}
