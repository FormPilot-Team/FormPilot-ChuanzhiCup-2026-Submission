import type { RoutineId, RoutineProgram } from '../routines/types'

/**
 * DemoStage presenter configuration (Web V1.1, C5).
 *
 * The standard demonstration can be shown by the real-person video (current), a future AI digital human, or the
 * project's cartoon coach. Only the picture changes: the scoring reference (`program.video.poseTrackSrc`, extracted
 * from the real-person video), the chapter times, playback, pause and seek stay exactly as they are. An alternative
 * presenter is used only when its asset is delivered AND aligned to the original timeline; otherwise the stage falls
 * back to the real-person video and says why (in data attributes, never as fake content).
 */

export type DemoPresenter = 'real' | 'digital-human' | 'cartoon'

export const DEMO_PRESENTER_LABEL: Readonly<Record<DemoPresenter, string>> = Object.freeze({
  real: '真人',
  'digital-human': '数字人',
  cartoon: '卡通',
})

/** A delivered alternative demonstration for one routine. */
export interface PresenterAsset {
  presenter: Exclude<DemoPresenter, 'real'>
  src: string
  posterSrc: string
  width: number
  height: number
  contentAspect: number
  durationSeconds: number
  /** The real-person video this asset was produced against; must equal the program's own video. */
  alignedTo: string
  /** Chapter start times measured in the delivered asset, in the program's chapter order. */
  chapterStartSeconds: ReadonlyArray<number>
}

/**
 * Delivered assets. Empty on purpose: no digital-human or cartoon routine video has been delivered yet, and the task
 * forbids shipping low-quality placeholders. Adding an entry here (after the alignment check passes) is the only step
 * needed to switch a routine's presenter.
 */
export const ROUTINE_PRESENTER_ASSETS: Readonly<Partial<Record<RoutineId, ReadonlyArray<PresenterAsset>>>> = Object.freeze({})

/** One frame at 25 fps: the alignment tolerance from the C5 asset spec (≤ 1 frame). */
export const ALIGNMENT_TOLERANCE_SECONDS = 0.04

export type PresenterFallbackReason = 'asset_missing' | 'not_aligned'

export interface ResolvedDemo {
  presenter: DemoPresenter
  requested: DemoPresenter
  fallback?: PresenterFallbackReason
  src: string
  posterSrc: string
  width: number
  height: number
  contentAspect: number
}

export function presenterAligned(program: RoutineProgram, asset: PresenterAsset): boolean {
  if (asset.alignedTo !== program.video.src) return false
  if (Math.abs(asset.durationSeconds - program.video.durationSeconds) > ALIGNMENT_TOLERANCE_SECONDS) return false
  if (asset.chapterStartSeconds.length !== program.chapters.length) return false
  return program.chapters.every((chapter, index) => Math.abs(asset.chapterStartSeconds[index] - chapter.startSeconds) <= ALIGNMENT_TOLERANCE_SECONDS)
}

export function resolveRoutineDemo(
  program: RoutineProgram,
  requested: DemoPresenter,
  assets: Readonly<Partial<Record<RoutineId, ReadonlyArray<PresenterAsset>>>> = ROUTINE_PRESENTER_ASSETS,
): ResolvedDemo {
  const real: ResolvedDemo = {
    presenter: 'real',
    requested,
    src: program.video.src,
    posterSrc: program.video.posterSrc,
    width: program.video.width,
    height: program.video.height,
    contentAspect: program.video.contentAspect,
  }
  if (requested === 'real') return real
  const asset = assets[program.id]?.find((item) => item.presenter === requested)
  if (!asset) return { ...real, fallback: 'asset_missing' }
  if (!presenterAligned(program, asset)) return { ...real, fallback: 'not_aligned' }
  return {
    presenter: asset.presenter,
    requested,
    src: asset.src,
    posterSrc: asset.posterSrc,
    width: asset.width,
    height: asset.height,
    contentAspect: asset.contentAspect,
  }
}

function isPresenter(value: unknown): value is DemoPresenter {
  return value === 'real' || value === 'digital-human' || value === 'cartoon'
}

/**
 * The configured presenter: `VITE_DEMO_PRESENTER` at build time; in DEV only, `?presenter=` for checking the fallback.
 */
export function configuredPresenter(
  env: { DEV?: boolean; VITE_DEMO_PRESENTER?: string } = import.meta.env as { DEV?: boolean; VITE_DEMO_PRESENTER?: string },
  search = typeof window === 'undefined' ? '' : window.location.search,
): DemoPresenter {
  if (env.DEV) {
    const fromQuery = new URLSearchParams(search).get('presenter')
    if (isPresenter(fromQuery)) return fromQuery
  }
  return isPresenter(env.VITE_DEMO_PRESENTER) ? env.VITE_DEMO_PRESENTER : 'real'
}
