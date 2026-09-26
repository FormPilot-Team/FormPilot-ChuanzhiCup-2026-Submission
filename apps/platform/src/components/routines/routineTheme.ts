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
  emerald: { chip: 'bg-emerald-50 text-emerald-800', soft: 'bg-emerald-50', text: 'text-emerald-700', fill: 'bg-emerald-500', ring: 'ring-emerald-400', step: 'border-emerald-500 bg-emerald-500 text-white' },
  indigo: { chip: 'bg-indigo-50 text-indigo-800', soft: 'bg-indigo-50', text: 'text-indigo-700', fill: 'bg-indigo-500', ring: 'ring-indigo-400', step: 'border-indigo-500 bg-indigo-500 text-white' },
  amber: { chip: 'bg-amber-50 text-amber-900', soft: 'bg-amber-50', text: 'text-amber-800', fill: 'bg-amber-500', ring: 'ring-amber-400', step: 'border-amber-500 bg-amber-500 text-white' },
  violet: { chip: 'bg-violet-50 text-violet-800', soft: 'bg-violet-50', text: 'text-violet-700', fill: 'bg-violet-500', ring: 'ring-violet-400', step: 'border-violet-500 bg-violet-500 text-white' },
})
