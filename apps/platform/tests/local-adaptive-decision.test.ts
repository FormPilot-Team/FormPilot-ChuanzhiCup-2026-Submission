import { describe, expect, it, vi } from 'vitest'
import { LocalAdaptiveDecisionEngine, LOCAL_POLICY, guardLocalStrategy } from '../src/features/adaptiveTraining/LocalAdaptiveDecisionEngine'
import { LOCAL_EXPECTATIONS, replayLocalScenario } from '../src/features/adaptiveTraining/localScenarioReplay'
import { DECISION_SCENARIOS, NORMAL_INPUT } from '../src/features/adaptiveTraining/scenarios'
import { STRATEGIES, type TrainingDecisionInput } from '../src/features/adaptiveTraining/protocol'
import { TrainingDecisionObserver } from '../src/features/adaptiveTraining/TrainingDecisionObserver'

const repeated: TrainingDecisionInput = { ...NORMAL_INPUT, score: 58, consecutiveErrors: 2, feedbackResponse: 'not_corrected',
  errors: [{ code: 'DEPTH_INSUFFICIENT', severity: .4 }] }
function feed(engine: LocalAdaptiveDecisionEngine, input: TrainingDecisionInput, seconds: number, start = 0) {
  return Array.from({ length: seconds + 1 }, (_, t) => engine.decide(structuredClone(input), (start + t) * 1000))
}

describe('local engine: retained 25 scenarios, explicit engineering expectations', () => {
  for (const scenario of DECISION_SCENARIOS) {
    it(`${scenario.id}: ${scenario.name}`, () => {
      const { decision, decisions } = replayLocalScenario(scenario.id)
      expect(decision.strategy).toBe(LOCAL_EXPECTATIONS[scenario.id])
      for (const d of decisions) {
        expect(d.source).toBe('local')
        expect(d.modelAnswer).toBeUndefined()
        expect(d.local?.reasons.length).toBeGreaterThan(0)
        expect(Object.keys(d.local!.strategyScores)).toEqual([...STRATEGIES])
        expect(Object.values(d.local!.strategyScores).every(score => Number.isFinite(score) && score >= 0 && score <= 100)).toBe(true)
        expect(d.latencyMs).toBeGreaterThanOrEqual(0)
      }
    })
  }
})

describe('multi-feature policy, memory and safety', () => {
  it('equal repeat counts yield different strategies for different quality and histories', () => {
    const low = feed(new LocalAdaptiveDecisionEngine(), repeated, 5).at(-1)!
    const high = feed(new LocalAdaptiveDecisionEngine(), { ...repeated, score: 96 }, 5).at(-1)!
    expect(low.strategy).toBe('SWITCH_CUE')
    expect(high.strategy).toBe('CONTINUE_STANDARD')
    const ineffective = feed(new LocalAdaptiveDecisionEngine(), repeated, 24).at(-1)!
    expect(ineffective.strategy).toBe('SHOW_DECOMPOSITION')
    expect(ineffective.local!.features.ineffectiveInterventions).toBeGreaterThan(0)
  })
  it('responds to score improvement during cooldown without treating the policy score as confidence', () => {
    const engine = new LocalAdaptiveDecisionEngine()
    expect(feed(engine, repeated, 5).at(-1)!.strategy).toBe('SWITCH_CUE')
    const improved = feed(engine, { ...repeated, score: 88 }, 6, 6).at(-1)!
    expect(improved.strategy).toBe('CONTINUE_STANDARD')
    expect(improved.local!.features.trend).toBe('improving')
    expect(improved.local!.reasons.join('')).toContain('改善')
    expect(improved.modelAnswer).toBeUndefined()
  })
  it('compares matching phases rather than interpreting cyclic score changes as improvement', () => {
    const engine = new LocalAdaptiveDecisionEngine()
    let last
    for (let t = 0; t <= 12; t++) last = engine.decide({ ...repeated, phase: t % 2 ? 'BOTTOM' : 'STANDING', score: t % 2 ? 40 : 90 }, t * 1000)
    expect(last!.local!.features.scoreTrend).toBe(0)
    expect(last!.local!.features.trend).toBe('steady')
  })
  it('retains ineffective intervention memory across intermittent return phases but displays standard while no issue is present', () => {
    const engine = new LocalAdaptiveDecisionEngine()
    const results = Array.from({ length: 31 }, (_, t) => engine.decide({ ...repeated, errors: t % 3 === 0 ? [] : repeated.errors }, t * 1000))
    expect(results.some(d => d.strategy === 'SWITCH_CUE')).toBe(true)
    expect(results.some(d => d.strategy === 'SHOW_DECOMPOSITION')).toBe(true)
    expect(results.at(-1)!.strategy).toBe('CONTINUE_STANDARD')
    expect(results.at(-1)!.local!.features.previousStrategy).toBe('SHOW_DECOMPOSITION')
  })
  it('deduplicates frame calls and retains the 30 second sliding window', () => {
    const engine = new LocalAdaptiveDecisionEngine()
    for (let frame = 0; frame < 100; frame++) engine.decide(NORMAL_INPUT, frame)
    expect(engine.decide(NORMAL_INPUT, 100).local!.features.reliableSamples).toBe(1)
    expect(feed(engine, NORMAL_INPUT, 100, 1).at(-1)!.local!.features.reliableSamples).toBeLessThanOrEqual(31)
  })
  it('uses hysteresis for small candidate score differences and imposes a minimum intervention hold', () => {
    const borderline = feed(new LocalAdaptiveDecisionEngine(), { ...repeated, score: 96 }, 5)
    expect(borderline.some(d => d.local?.selection === 'hysteresis')).toBe(true)
    const engine = new LocalAdaptiveDecisionEngine()
    const decisions = feed(engine, repeated, 24)
    const switched = decisions.findIndex(d => d.strategy === 'SWITCH_CUE')
    const split = decisions.findIndex(d => d.strategy === 'SHOW_DECOMPOSITION')
    expect(switched).toBeGreaterThanOrEqual(0)
    expect(split - switched).toBeGreaterThanOrEqual(LOCAL_POLICY.holdMs / 1000)
  })
  it('does not inherit an ineffective cue from another error or exercise', () => {
    const engine = new LocalAdaptiveDecisionEngine()
    feed(engine, repeated, 20)
    const changedIssue = engine.decide({ ...repeated, errors: [{ code: 'TOO_FAST', severity: .2 }] }, 21000)
    expect(changedIssue.local!.features.ineffectiveInterventions).toBe(0)
    const changedExercise = engine.decide({ ...repeated, exerciseId: 'lateral_raise', phase: 'TOP' }, 22000)
    expect(changedExercise.local!.features.reliableSamples).toBe(1)
    expect(changedExercise.strategy).toBe('CONTINUE_STANDARD')
  })
  it.each([
    { poseValid: false }, { poseReliability: .4 }, { score: null }, { trainingState: 'PAUSED' },
    { completion: 1 }, { errors: [{ code: 'KNEE_VALGUS', severity: .2 }] }, { errors: [{ code: 'TORSO_LEAN', severity: .9 }] },
  ])('immediately falls back for %j', patch => {
    const engine = new LocalAdaptiveDecisionEngine()
    feed(engine, repeated, 5)
    const result = engine.decide({ ...repeated, ...patch } as TrainingDecisionInput, 5001)
    expect(result.strategy).toBe('CONTINUE_STANDARD')
    expect(result.safetyFallback).toBe(true)
  })
  it('rejects malformed data and backward time instead of interrupting training', () => {
    const engine = new LocalAdaptiveDecisionEngine()
    expect(engine.decide({ ...NORMAL_INPUT, score: NaN }).safetyFallback).toBe(true)
    engine.decide(NORMAL_INPUT, 5000)
    expect(engine.decide(NORMAL_INPUT, 1000).safetyFallback).toBe(true)
    expect(engine.decide(null as unknown as TrainingDecisionInput).strategy).toBe('CONTINUE_STANDARD')
  })
  it('rest recommendations require prior ineffective decomposition, active duration and a resting phase', () => {
    const { input, frames } = replayLocalScenario('pause')
    const engine = new LocalAdaptiveDecisionEngine()
    const decisions = frames.map(f => engine.decide(f.input, f.at))
    expect(decisions.at(-1)!.strategy).toBe('SUGGEST_PAUSE')
    expect(decisions.some(d => d.strategy === 'SHOW_DECOMPOSITION')).toBe(true)
    expect(engine.decide({ ...input, phase: 'DESCENDING' }, frames.at(-1)!.at + 1).strategy).toBe('CONTINUE_STANDARD')
    for (const s of STRATEGIES) expect(guardLocalStrategy({ ...input, poseValid: false }, s)).toBe('CONTINUE_STANDARD')
    expect(guardLocalStrategy({ ...input, history: { ...input.history, activeSeconds: 10 } }, 'SUGGEST_PAUSE')).toBe('CONTINUE_STANDARD')
  })
  it('does not count unreliable/paused time as training duration or repeated failures', () => {
    const observer = new TrainingDecisionObserver()
    const observation = { ...NORMAL_INPUT, completedReps: 0 }
    observer.observe(observation, 0)
    observer.observe(observation, 1000)
    observer.observe({ ...observation, trainingState: 'PAUSED' }, 2000)
    observer.observe({ ...observation, trainingState: 'PAUSED' }, 30000)
    const resumed = observer.observe(observation, 31000)
    expect(resumed.history.activeSeconds).toBe(1)
    expect(resumed.history.stableSeconds).toBe(0)
  })
  it('works with fetch disabled and never invokes an external transport', () => {
    const fetcher = vi.fn(() => { throw new Error('network disabled') })
    vi.stubGlobal('fetch', fetcher)
    try { expect(replayLocalScenario('decomposition').decision.strategy).toBe('SHOW_DECOMPOSITION'); expect(fetcher).not.toHaveBeenCalled() }
    finally { vi.unstubAllGlobals() }
  })
})
