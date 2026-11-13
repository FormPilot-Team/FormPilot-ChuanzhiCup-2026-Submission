import { describe, expect, it } from 'vitest'
import { ROUTINE_PRESENTER_ASSETS, configuredPresenter, resolveRoutineDemo, type PresenterAsset } from '../src/features/demo/demoPresenter'
import { getRoutineProgram } from '../src/features/routines/programs'

const program = getRoutineProgram('baduanjin')

function aligned(overrides: Partial<PresenterAsset> = {}): PresenterAsset {
  return {
    presenter: 'digital-human',
    src: '/assets/routines/baduanjin-digital-human.mp4',
    posterSrc: '/assets/routines/baduanjin-digital-human.jpg',
    width: 1920,
    height: 1080,
    contentAspect: 16 / 9,
    durationSeconds: program.video.durationSeconds,
    alignedTo: program.video.src,
    chapterStartSeconds: program.chapters.map((chapter) => chapter.startSeconds),
    ...overrides,
  }
}

describe('DemoStage presenter (Web V1.1 C5)', () => {
  it('ships no alternative presenter asset yet (no placeholder video)', () => {
    expect(Object.keys(ROUTINE_PRESENTER_ASSETS)).toEqual([])
  })

  it('uses the real-person video by default and keeps its metadata', () => {
    const demo = resolveRoutineDemo(program, 'real')
    expect(demo).toMatchObject({ presenter: 'real', requested: 'real', src: program.video.src, contentAspect: program.video.contentAspect })
    expect(demo.fallback).toBeUndefined()
  })

  it('falls back to the real-person video when the requested asset is missing', () => {
    expect(resolveRoutineDemo(program, 'digital-human')).toMatchObject({ presenter: 'real', requested: 'digital-human', fallback: 'asset_missing', src: program.video.src })
    expect(resolveRoutineDemo(program, 'cartoon')).toMatchObject({ presenter: 'real', fallback: 'asset_missing' })
  })

  it('switches only to an asset aligned to the original timeline (≤ 1 frame)', () => {
    const assets = { baduanjin: [aligned()] }
    expect(resolveRoutineDemo(program, 'digital-human', assets)).toMatchObject({ presenter: 'digital-human', src: '/assets/routines/baduanjin-digital-human.mp4' })
    const late = aligned({ chapterStartSeconds: program.chapters.map((chapter, index) => chapter.startSeconds + (index === 3 ? 0.2 : 0)) })
    expect(resolveRoutineDemo(program, 'digital-human', { baduanjin: [late] })).toMatchObject({ presenter: 'real', fallback: 'not_aligned' })
    const longer = aligned({ durationSeconds: program.video.durationSeconds + 1 })
    expect(resolveRoutineDemo(program, 'digital-human', { baduanjin: [longer] })).toMatchObject({ presenter: 'real', fallback: 'not_aligned' })
    const otherSource = aligned({ alignedTo: '/assets/routines/other.mp4' })
    expect(resolveRoutineDemo(program, 'digital-human', { baduanjin: [otherSource] })).toMatchObject({ presenter: 'real', fallback: 'not_aligned' })
  })

  it('reads the presenter from the build setting; the URL override exists in DEV only', () => {
    expect(configuredPresenter({ DEV: false }, '?presenter=cartoon')).toBe('real')
    expect(configuredPresenter({ DEV: false, VITE_DEMO_PRESENTER: 'digital-human' }, '')).toBe('digital-human')
    expect(configuredPresenter({ DEV: true }, '?presenter=cartoon')).toBe('cartoon')
    expect(configuredPresenter({ DEV: true }, '?presenter=nonsense')).toBe('real')
  })
})
