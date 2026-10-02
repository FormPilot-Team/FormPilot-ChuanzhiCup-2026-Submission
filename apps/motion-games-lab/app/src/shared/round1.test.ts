// Round-1 playtest regressions that are not detector logic: the hand cursor art, the round lengths and
// the archery wording tiers (soft hint vs. guard).
import { afterEach, describe, expect, it } from 'vitest'
import { COPY } from '../data/games'
import { ArcheryController } from '../games/archery/controller'
import { ArcheryRound } from '../games/archery/round'
import type { DrawState, MotionAdapterApi } from '../motion/contracts'
import { DEFAULT_SETTINGS, loadSettings, ROUND_OPTIONS } from './settings'
import { paintHand, type HandPose } from './world/hands'

/** A Canvas 2D stand-in that records every colour used and every piece of text drawn. */
function recordingContext() {
  const colours = new Set<string>()
  const texts: string[] = []
  const gradient = (stops: string[]) => ({ addColorStop: (_o: number, c: string) => stops.push(c) })
  const stops: string[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient(stops)
      if (key === 'fillText' || key === 'strokeText') return (text: string) => texts.push(text)
      if (key in target) return target[key]
      return () => undefined
    },
    set(target, key: string, value) {
      if ((key === 'fillStyle' || key === 'strokeStyle' || key === 'shadowColor') && typeof value === 'string') colours.add(value)
      target[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, colours, texts, stops }
}

describe('hand cursor art (formal mode)', () => {
  it('left and right hands use exactly the same colours, and no 左/右 text is drawn', () => {
    for (const pose of ['open', 'half', 'grab'] as HandPose[]) {
      const left = recordingContext()
      const right = recordingContext()
      paintHand(left.ctx, 160, pose, 'left')
      paintHand(right.ctx, 160, pose, 'right')
      expect([...left.colours].sort()).toEqual([...right.colours].sort())
      expect(left.stops).toEqual(right.stops)
      expect(left.texts).toEqual([])
      expect(right.texts).toEqual([])
      // warm white, not the old teal / orange
      for (const c of [...left.colours, ...left.stops]) expect(c.toLowerCase()).not.toMatch(/2bb5a8|ff9a3c|#178a80|#d9701b/)
    }
  })
})

describe('round length options', () => {
  const store = new Map<string, string>()
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  afterEach(() => {
    store.clear()
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('offers 1, 2 and 3 minutes only (4 minutes was removed), default unchanged', () => {
    expect([...ROUND_OPTIONS]).toEqual([60, 120, 180])
    expect(ROUND_OPTIONS).toContain(DEFAULT_SETTINGS.roundSeconds)
  })

  it('a saved 4-minute setting falls back to the default; valid saved lengths are kept', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = fake
    store.set('motion-games-lab.settings.v1', JSON.stringify({ roundSeconds: 240, difficulty: 'standard' }))
    expect(loadSettings()).toMatchObject({ roundSeconds: DEFAULT_SETTINGS.roundSeconds, difficulty: 'standard' })
    store.set('motion-games-lab.settings.v1', JSON.stringify({ roundSeconds: 60 }))
    expect(loadSettings().roundSeconds).toBe(60)
  })
})

describe('archery wording: a soft hint never replaces the step, only a persisting guard does', () => {
  function controllerWith(state: Partial<DrawState>) {
    const draw: DrawState = {
      options: { drawSide: 'right', drawGoal: 0.7, holdMs: 1000 }, phase: 'hold', attemptId: 1, drawRatio: 1, holdProgress: 0.4,
      stability: 1, aim: { x: 0, y: 0 }, guard: null, hint: null, readyProgress: 1, peakRatio: 1, ...state,
    }
    const adapter = {
      enable: () => undefined, setDetectionActive: () => undefined, subscribe: () => () => undefined, configureDraw: () => undefined, drawState: () => draw,
    } as unknown as MotionAdapterApi
    const c = new ArcheryController(adapter, new ArcheryRound({ difficulty: 'standard', durationMs: 60_000 }), { drawSide: 'right', armLength: 1.1 })
    c.startPlaying(0)
    return c
  }

  it('slightly bent bow arm: the step stays "稳住…", a gentle line is added underneath', () => {
    const c = controllerWith({ hint: 'bow-arm-straighter' })
    expect(c.instruction(0)).toBe(COPY.archery.hold)
    expect(c.softHint()).toBe(COPY.archery.bowArmSoft)
  })

  it('a clearly bent arm that persisted becomes the instruction; no soft line on top', () => {
    const c = controllerWith({ guard: 'bow-arm-bent' })
    expect(c.instruction(0)).toBe(COPY.archery.bowArmBent)
    expect(c.softHint()).toBeNull()
  })
})
