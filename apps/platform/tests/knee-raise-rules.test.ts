import { describe, expect, it } from 'vitest'
import { evaluateKneeRaiseRules } from '../src/features/exercises/kneeRaise/rules'
import type { KneeRaiseStateSnapshot } from '../src/features/exercises/kneeRaise/stateMachine'
import type { KneeRaiseRepSummary, MotionErrorCode } from '../src/features/exercises/types'
import { kneeFeatures } from './helpers/fixtures'
const rep = (changes: Partial<KneeRaiseRepSummary> = {}): KneeRaiseRepSummary => ({ exerciseId:'knee_raise',repIndex:1,side:'left',startedAt:0,completedAt:1200,durationMs:1200,startTime:0,topTime:500,endTime:1200,peakKneeHeight:0,hipShiftMax:0.05,maxTorsoLean:3,amplitudeScore:100,stabilityScore:100,alternationScore:100,symmetryScore:100,tempoScore:100,overallScore:100,errors:[],wrongSideSequence:false,incompleteReturn:false,...changes })
const state = (changes: Partial<KneeRaiseStateSnapshot> = {}): KneeRaiseStateSnapshot => ({ phase:'LEFT_TOP',repCount:0,cycleCount:0,currentSide:'left',repStartedAt:0,topEnteredAt:500,peakKneeHeight:0,hipShiftMax:0.05,maxTorsoLean:3,wrongSideSequence:false,incompleteReturn:false,baselineReady:true,...changes })
const codes = (s: Partial<KneeRaiseStateSnapshot>={}, f: Parameters<typeof kneeFeatures>[0]={}): MotionErrorCode[] => evaluateKneeRaiseRules(kneeFeatures(f),state(s)).errors.map(e=>e.code)
describe('Knee Raise rules',()=>{
  it('accepts correct left and right tops',()=>{expect(codes()).toEqual([]);expect(codes({phase:'RIGHT_TOP',currentSide:'right',peakKneeHeight:0})).toEqual([])})
  it('detects side-specific low knees',()=>{expect(codes({peakKneeHeight:-0.25})).toContain('KNEE_TOO_LOW_L');expect(codes({phase:'RIGHT_TOP',currentSide:'right',peakKneeHeight:-0.25})).toContain('KNEE_TOO_LOW_R')})
  it('detects body sway',()=>expect(codes({hipShiftMax:0.3,maxTorsoLean:12})).toContain('BODY_SWAY'))
  it('detects wrong sequence and too fast on a completed rep',()=>{const r=rep({wrongSideSequence:true,durationMs:700,completedAt:700});expect(codes({phase:'COMPLETE',completedRep:r,wrongSideSequence:true})).toEqual(expect.arrayContaining(['WRONG_SIDE_SEQUENCE','TOO_FAST']))})
  it('detects left/right peak gap',()=>expect(codes({lastLeftPeak:0.05,lastRightPeak:-0.2})).toContain('LEFT_RIGHT_HEIGHT_GAP'))
  it('detects incomplete return with highest movement priority',()=>{const result=evaluateKneeRaiseRules(kneeFeatures(),state({incompleteReturn:true,peakKneeHeight:-0.3}));expect(result.errors.map(e=>e.code).slice(0,2)).toEqual(['INCOMPLETE_RETURN','KNEE_TOO_LOW_L'])})
  it('gates errors and score on low confidence / out of frame',()=>{expect(codes({}, {confidence:0.2})).toEqual(['POSE_LOW_CONFIDENCE']);expect(evaluateKneeRaiseRules(kneeFeatures({bodyInFrame:false}),state()).currentScore).toBe(0)})
})
