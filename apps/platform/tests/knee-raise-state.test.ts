import { describe, expect, it } from 'vitest'
import { KNEE_RAISE_V1 } from '../src/features/exercises/kneeRaise/config'
import { KneeRaiseStateMachine } from '../src/features/exercises/kneeRaise/stateMachine'
import { kneeFeatures } from './helpers/fixtures'
const config = { ...KNEE_RAISE_V1, phasePersistenceFrames: 1 }
function left(machine: KneeRaiseStateMachine, start = 0) {
  machine.update(kneeFeatures({ timestamp:start, leftKneeHeight:-0.2, leftKneeVelocity:1 }))
  machine.update(kneeFeatures({ timestamp:start+400, leftKneeHeight:-0.08, leftKneeVelocity:0 }))
  machine.update(kneeFeatures({ timestamp:start+700, leftKneeHeight:-0.15, leftKneeVelocity:-1 }))
  return machine.update(kneeFeatures({ timestamp:start+1200 }))
}
function right(machine: KneeRaiseStateMachine, start = 0) {
  machine.update(kneeFeatures({ timestamp:start, rightKneeHeight:-0.2, rightKneeVelocity:1 }))
  machine.update(kneeFeatures({ timestamp:start+400, rightKneeHeight:-0.08, rightKneeVelocity:0 }))
  machine.update(kneeFeatures({ timestamp:start+700, rightKneeHeight:-0.15, rightKneeVelocity:-1 }))
  return machine.update(kneeFeatures({ timestamp:start+1200 }))
}
describe('KneeRaiseStateMachine', () => {
  it('walks the complete left phase chain and counts only after CENTER', () => { const m=new KneeRaiseStateMachine(config); expect(m.update(kneeFeatures({leftKneeHeight:-0.2,leftKneeVelocity:1})).phase).toBe('LEFT_RAISING'); expect(m.update(kneeFeatures({timestamp:400,leftKneeHeight:-0.08,leftKneeVelocity:0})).phase).toBe('LEFT_TOP'); expect(m.update(kneeFeatures({timestamp:700,leftKneeHeight:-0.2,leftKneeVelocity:-1})).phase).toBe('LEFT_RETURNING'); expect(m.getSnapshot().repCount).toBe(0); expect(m.update(kneeFeatures({timestamp:1200}))).toMatchObject({phase:'COMPLETE',repCount:1}) })
  it('walks the right phase chain', () => { const s=right(new KneeRaiseStateMachine(config)); expect(s).toMatchObject({phase:'COMPLETE',repCount:1,lastCompletedSide:'right'}) })
  it('counts a left-right pair as one cycle', () => { const m=new KneeRaiseStateMachine(config); left(m); right(m,1500); expect(m.getSnapshot()).toMatchObject({repCount:2,cycleCount:1,lastCompletedSide:'right'}) })
  it('flags LEFT to LEFT but does not deadlock', () => { const m=new KneeRaiseStateMachine(config); left(m); const second=left(m,1500); expect(second.completedRep?.wrongSideSequence).toBe(true); expect(second.repCount).toBe(2) })
  it('does not count jitter or an incomplete return', () => { const m=new KneeRaiseStateMachine(config); m.update(kneeFeatures({leftKneeHeight:-0.34,leftKneeVelocity:0.1})); expect(m.getSnapshot().repCount).toBe(0); m.update(kneeFeatures({timestamp:200,leftKneeHeight:-0.2,leftKneeVelocity:1})); m.update(kneeFeatures({timestamp:500,leftKneeHeight:-0.08,leftKneeVelocity:0})); m.update(kneeFeatures({timestamp:700,leftKneeHeight:-0.2,leftKneeVelocity:-1})); m.update(kneeFeatures({timestamp:900,leftKneeHeight:-0.2,rightKneeHeight:-0.2,rightKneeVelocity:1})); expect(m.getSnapshot()).toMatchObject({repCount:0,incompleteReturn:true}) })
  it('freezes through visibility interruption and resumes', () => { const m=new KneeRaiseStateMachine(config); m.update(kneeFeatures({leftKneeHeight:-0.2,leftKneeVelocity:1})); expect(m.update(kneeFeatures({timestamp:200,confidence:0.2})).phase).toBe('LEFT_RAISING'); expect(m.update(kneeFeatures({timestamp:400,leftKneeHeight:-0.08,leftKneeVelocity:0})).phase).toBe('LEFT_TOP') })
  it('waits for baseline and supports reset', () => { const m=new KneeRaiseStateMachine(config); m.update(kneeFeatures({baselineReady:false,leftKneeHeight:-0.1,leftKneeVelocity:1})); expect(m.getSnapshot().repCount).toBe(0); left(m); m.reset(); expect(m.getSnapshot()).toMatchObject({phase:'CENTER',repCount:0,cycleCount:0,baselineReady:false}) })
})
