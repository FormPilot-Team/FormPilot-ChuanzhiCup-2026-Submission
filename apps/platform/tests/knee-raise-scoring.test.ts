import { describe, expect, it } from 'vitest'
import { calculateKneeRaiseMetrics, kneeRaiseAmplitudeScore, weightedKneeRaiseScore } from '../src/features/exercises/kneeRaise/scoring'
import type { KneeRaiseStateSnapshot } from '../src/features/exercises/kneeRaise/stateMachine'
const state = (changes: Partial<KneeRaiseStateSnapshot> = {}): KneeRaiseStateSnapshot => ({phase:'LEFT_TOP',repCount:0,cycleCount:0,currentSide:'left',repStartedAt:0,peakKneeHeight:-0.1,hipShiftMax:0,maxTorsoLean:0,wrongSideSequence:false,incompleteReturn:false,baselineReady:true,...changes})
describe('Knee Raise scoring',()=>{
  it('is continuous around the target without a threshold cliff',()=>{const below=kneeRaiseAmplitudeScore(-0.101);const above=kneeRaiseAmplitudeScore(-0.099);expect(above).toBeGreaterThan(below);expect(above-below).toBeLessThan(2)})
  it('uses a target plateau rather than unbounded reward',()=>expect(kneeRaiseAmplitudeScore(0.25)).toBe(kneeRaiseAmplitudeScore(0.05)))
  it('scores stability, alternation, symmetry, tempo and weighted total',()=>{const metrics=calculateKneeRaiseMetrics(state({lastLeftPeak:0,lastRightPeak:-0.05}),{leftKneeHeight:0,rightKneeHeight:-0.7,hipHorizontalShift:0.02,torsoLean:2,timestamp:1300});expect(Object.keys(metrics)).toEqual(['amplitude','stability','alternation','symmetry','tempo']);expect(weightedKneeRaiseScore(metrics)).toBeGreaterThan(80)})
  it('penalizes sway, sequence, asymmetry and fast tempo independently',()=>{const metrics=calculateKneeRaiseMetrics(state({hipShiftMax:0.3,maxTorsoLean:18,lastLeftPeak:0.1,lastRightPeak:-0.2,wrongSideSequence:true}),{leftKneeHeight:0.1,rightKneeHeight:-0.7,hipHorizontalShift:0.3,torsoLean:18,timestamp:500});expect(metrics.stability.score).toBeLessThan(30);expect(metrics.symmetry.score).toBe(0);expect(metrics.tempo.score).toBeLessThan(100)})
})
