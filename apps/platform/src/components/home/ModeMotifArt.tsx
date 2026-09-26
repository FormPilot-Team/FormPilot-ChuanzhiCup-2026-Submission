import type { ModeMotif } from '../../app/modeCatalog'
import { cn } from '../../lib/cn'

const MOTIF_PATHS: Readonly<Record<ModeMotif, { paths: string[]; dots: ReadonlyArray<readonly [number, number]> }>> = {
  // Warm-up: a rising heart-rate pulse, then an arc of increasing energy.
  pulse: {
    paths: ['M6 70 H44 L54 48 L66 86 L78 30 L90 70 H104', 'M104 70 C122 66 138 48 154 18'],
    dots: [[78, 30], [154, 18]],
  },
  // 八段锦: slow, even sweeps rising together, like breath-led arms lifting.
  lift: {
    paths: ['M8 86 C48 86 70 44 108 32 S146 18 154 14', 'M8 70 C40 70 60 36 94 24 S128 10 138 8'],
    dots: [[8, 86], [154, 14], [8, 70], [138, 8]],
  },
  // 太极拳: a continuous circle with the turning S of weight shifting through it.
  orbit: {
    paths: ['M112 14 A34 34 0 1 1 111.9 14', 'M112 14 C92 30 132 66 112 82', 'M20 78 C40 80 62 70 78 52'],
    dots: [[112, 14], [112, 82], [20, 78]],
  },
  // 五禽戏: a leaping trajectory with its landing steps.
  leap: {
    paths: ['M8 86 Q42 8 80 58 T152 36'],
    dots: [[8, 86], [44, 36], [80, 58], [116, 46], [152, 36]],
  },
  // 易筋经: extension spreading outward from the centre of the body.
  stretch: {
    paths: ['M54 90 A24 24 0 0 0 30 66', 'M76 90 A46 46 0 0 0 30 44', 'M98 90 A68 68 0 0 0 30 22', 'M120 90 A90 90 0 0 0 30 0'],
    dots: [[30, 90], [78, 42]],
  },
}

export function ModeMotifArt({ motif, className }: { motif: ModeMotif; className?: string }) {
  const art = MOTIF_PATHS[motif]
  return (
    <svg viewBox="0 0 160 96" fill="none" aria-hidden="true" focusable="false" className={cn('pointer-events-none', className)} data-motif={motif}>
      {art.paths.map((d) => <path key={d} d={d} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}
      {art.dots.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4.5" fill="#fff" stroke="currentColor" strokeWidth="2.5" />)}
    </svg>
  )
}
