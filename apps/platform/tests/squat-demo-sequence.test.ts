import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { squatDefinition } from '../src/features/exercises/squat/definition'

describe('Squat production demo sequence contract', () => {
  const sequence = squatDefinition.presentation.cameraDemo.sequence!

  it('starts from standing, reaches bottom, ascends, and returns to standing', () => {
    expect(sequence.map((frame) => frame.id)).toEqual([
      'STANDING', 'DESCENDING', 'BOTTOM', 'ASCENDING', 'STANDING_RETURN',
    ])
    expect(sequence[0].durationMs).toBeGreaterThanOrEqual(2000)
  })

  it('uses only raster frame assets and no landmark shortcut payload', () => {
    for (const frame of sequence) {
      expect(frame.src).toMatch(/^\/assets\/.*\.png$/)
      expect(frame.src).not.toMatch(/fixture|landmark|\.json/i)
      expect(existsSync(path.resolve('public', frame.src.slice(1)))).toBe(true)
    }
  })
})
