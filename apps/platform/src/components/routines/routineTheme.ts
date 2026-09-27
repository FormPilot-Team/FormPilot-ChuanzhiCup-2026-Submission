import type { RoutineAccent } from '../../features/routines/types'

/**
 * Mode identity accents. They mark which routine you are in (chips, the current step, progress fill) and never
 * replace FormPilot's own blue for actions, focus rings or the header, so every routine still reads as FormPilot.
 */
export interface RoutineAccentClasses {
  chip: string
  soft: string
  text: string
  fill: string
  ring: string
  step: string
}

export const ROUTINE_ACCENT: Readonly<Record<RoutineAccent, RoutineAccentClasses>> = Object.freeze({
  orange: { chip: 'bg-orange-50 text-orange-900', soft: 'bg-orange-50', text: 'text-orange-800', fill: 'bg-orange-500', ring: 'ring-orange-400', step: 'border-orange-500 bg-orange-500 text-white' },
  violet: { chip: 'bg-violet-50 text-violet-800', soft: 'bg-violet-50', text: 'text-violet-700', fill: 'bg-violet-500', ring: 'ring-violet-400', step: 'border-violet-500 bg-violet-500 text-white' },
  emerald: { chip: 'bg-emerald-50 text-emerald-800', soft: 'bg-emerald-50', text: 'text-emerald-700', fill: 'bg-emerald-500', ring: 'ring-emerald-400', step: 'border-emerald-500 bg-emerald-500 text-white' },
  rose: { chip: 'bg-rose-50 text-rose-800', soft: 'bg-rose-50', text: 'text-rose-700', fill: 'bg-rose-500', ring: 'ring-rose-400', step: 'border-rose-500 bg-rose-500 text-white' },
})
