import type { ModeAccent } from '../../app/modeCatalog'

/**
 * One visual system for every training mode: the same card, a low-saturation tint of the mode's own colour, the
 * mode's pose as a soft silhouette and a thin motion trail. Accents never colour actions or text; FormPilot blue does.
 */
export interface ModeAccentClasses {
  /** Card surface: a pale tint fading to white. */
  surface: string
  /** Hover border. */
  hover: string
  /** Silhouette gradient stops (currentColor), top and bottom. */
  figureTop: string
  figureBottom: string
  /** Motion trail stroke colour (currentColor). */
  motif: string
  /** Icon tile on phone rows. */
  icon: string
}

export const MODE_ACCENT: Readonly<Record<ModeAccent, ModeAccentClasses>> = Object.freeze({
  brand: {
    surface: 'border-blue-100/80 bg-gradient-to-br from-[#e6f0ff] via-[#f1f7ff] to-white',
    hover: 'hover:border-blue-300',
    figureTop: 'text-sky-200',
    figureBottom: 'text-blue-400',
    motif: 'text-sky-400',
    icon: 'fp-energy-gradient text-white shadow-[0_8px_18px_-10px_rgb(14_165_233/0.9)]',
  },
  orange: {
    surface: 'border-orange-100/80 bg-gradient-to-br from-[#fff1e4] via-[#fff8f1] to-white',
    hover: 'hover:border-orange-200',
    figureTop: 'text-orange-200',
    figureBottom: 'text-orange-300',
    motif: 'text-orange-300',
    icon: 'bg-orange-50 text-orange-700',
  },
  violet: {
    surface: 'border-violet-100/80 bg-gradient-to-br from-[#f0edff] via-[#f7f5ff] to-white',
    hover: 'hover:border-violet-200',
    figureTop: 'text-violet-200',
    figureBottom: 'text-indigo-300',
    motif: 'text-violet-300',
    icon: 'bg-violet-50 text-violet-700',
  },
  emerald: {
    surface: 'border-emerald-100/80 bg-gradient-to-br from-[#e5f8ef] via-[#f2fbf7] to-white',
    hover: 'hover:border-emerald-200',
    figureTop: 'text-emerald-200',
    figureBottom: 'text-teal-300',
    motif: 'text-emerald-300',
    icon: 'bg-emerald-50 text-emerald-700',
  },
  rose: {
    surface: 'border-rose-100/80 bg-gradient-to-br from-[#ffecef] via-[#fff6f7] to-white',
    hover: 'hover:border-rose-200',
    figureTop: 'text-rose-200',
    figureBottom: 'text-rose-300',
    motif: 'text-rose-300',
    icon: 'bg-rose-50 text-rose-700',
  },
})
