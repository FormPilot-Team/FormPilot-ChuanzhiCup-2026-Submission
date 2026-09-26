import type { ModeAccent } from '../../app/modeCatalog'

/**
 * One visual system for every training mode: the same card, a soft tint of the mode's accent and a thin motion
 * motif (trajectory, arc, rhythm). Accents never colour actions or text; FormPilot blue does.
 */
export interface ModeAccentClasses {
  /** Card surface tint, as the end stop of a white gradient. */
  tint: string
  /** Motif stroke colour (currentColor). */
  motif: string
  /** Icon tile. */
  icon: string
  /** Small label chip. */
  chip: string
}

export const MODE_ACCENT: Readonly<Record<ModeAccent, ModeAccentClasses>> = Object.freeze({
  brand: { tint: 'to-sky-50', motif: 'text-sky-500', icon: 'fp-energy-gradient text-white shadow-[0_8px_18px_-10px_rgb(14_165_233/0.9)]', chip: 'bg-blue-50 text-blue-700' },
  emerald: { tint: 'to-emerald-50/80', motif: 'text-emerald-500', icon: 'bg-emerald-50 text-emerald-700', chip: 'bg-emerald-50 text-emerald-800' },
  indigo: { tint: 'to-indigo-50/80', motif: 'text-indigo-500', icon: 'bg-indigo-50 text-indigo-700', chip: 'bg-indigo-50 text-indigo-800' },
  amber: { tint: 'to-amber-50/80', motif: 'text-amber-500', icon: 'bg-amber-50 text-amber-800', chip: 'bg-amber-50 text-amber-900' },
  violet: { tint: 'to-violet-50/80', motif: 'text-violet-500', icon: 'bg-violet-50 text-violet-700', chip: 'bg-violet-50 text-violet-800' },
})
