import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { COACH_AVATAR_ASSET } from '../src/components/coach/coachIdentity'
import { RoutineFeedbackPanel } from '../src/components/routines/RoutineFeedbackPanel'
import { getRoutineProgram } from '../src/features/routines/programs'

/** Canvas size and alpha flag from a WebP's VP8X chunk. */
function webpInfo(path: string) {
  const data = readFileSync(path)
  expect(data.toString('latin1', 0, 4)).toBe('RIFF')
  expect(data.toString('latin1', 8, 12)).toBe('WEBP')
  expect(data.toString('latin1', 12, 16)).toBe('VP8X')
  const flags = data[20]
  return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3), alpha: (flags & 0x10) !== 0 }
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('coach avatar asset', () => {
  it('is a square transparent bust, as COACH_AVATAR_ASSET describes it', () => {
    const info = webpInfo(`public${COACH_AVATAR_ASSET.src}`)
    expect(info).toEqual({ width: COACH_AVATAR_ASSET.width, height: COACH_AVATAR_ASSET.height, alpha: true })
    expect(COACH_AVATAR_ASSET.width).toBe(COACH_AVATAR_ASSET.height)
    // Sharp at 64 px on a 3x screen.
    expect(COACH_AVATAR_ASSET.width).toBeGreaterThanOrEqual(192)
  })

  it('is what the realtime feedback card shows, never the full-body picture', () => {
    const program = getRoutineProgram('baduanjin')
    const html = renderToStaticMarkup(createElement(RoutineFeedbackPanel, {
      accent: program.accent,
      checks: [],
      trackingState: 'normal',
      coachMessage: '十指交叉上托',
      coachTone: 'neutral',
      comparisonAvailable: true,
    }))
    expect(html).toContain(`src="${COACH_AVATAR_ASSET.src}"`)
    expect(html).toContain('fp-coach-avatar')
    expect(html).not.toContain('overhead-raise-demo-start.png')
  })

  it('is the only picture in a round avatar anywhere in the app', () => {
    const offenders: string[] = []
    for (const file of sourceFiles('src')) {
      const source = readFileSync(file, 'utf8')
      // A full-body coach picture may only fill the warm-up dock's large portrait slot.
      if (source.includes('STATIC_AI_COACH_ASSET') && !file.endsWith(join('coach', 'AICoachDock.tsx'))) offenders.push(`${file}: STATIC_AI_COACH_ASSET`)
      for (const tag of source.match(/<img\b[^>]*>/g) ?? []) {
        if (/rounded-full/.test(tag)) offenders.push(`${file}: round <img> outside CoachAvatar`)
      }
    }
    expect(offenders).toEqual([])
  })
})
