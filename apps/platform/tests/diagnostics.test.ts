import { describe, expect, it } from 'vitest'
import { PerformanceTracker } from '../src/features/diagnostics/PerformanceTracker'
import { SessionDiagnosticsRecorder } from '../src/features/diagnostics/SessionDiagnosticsRecorder'
import type { KneeRaiseStateSnapshot } from '../src/features/exercises/kneeRaise/stateMachine'
import { features, kneeFeatures, ruleResult, snapshot, squatFeatures } from './helpers/fixtures'

describe('diagnostics infrastructure', () => {
  it('exports derived frame and repetition data without video', () => {
    const recorder = new SessionDiagnosticsRecorder()
    const rep = {
      exerciseId: 'lateral_raise' as const, repIndex: 1, startedAt: 0, completedAt: 3000, durationMs: 3000,
      topHoldMs: 400, peakShoulderL: 90, peakShoulderR: 88, minElbowL: 165, minElbowR: 164,
      maxSymmetryDiff: 4, maxTorsoLean: 3,
    }
    recorder.record(features({ timestamp: 3000 }), snapshot({ phase: 'COMPLETE', repCount: 1, completedRep: rep }), ruleResult())
    const exported = recorder.export({ cameraFps: 30, inferenceFps: 28, averageInferenceMs: 18, p95InferenceMs: 24, uiFps: 10, droppedFrames: 1, skippedFrames: 2, sampleCount: 30, inputResolution: '1280×720' }, {
      specVersion: 'exercise-rules-v1.0',
      thresholdVersion: 'engineering-v1',
      dataSource: 'camera',
      captureSource: 'live',
    })
    expect(exported.privacy).toBe('derived-pose-metrics-only-no-video')
    expect(exported.dataSource).toBe('camera')
    expect(exported.thresholdVersion).toBe('engineering-v1')
    expect(exported.frames[0]).toMatchObject({ leftShoulderAngle: 90, poseConfidence: 0.99 })
    expect(exported.repetitions[0]).toMatchObject({ peakShoulderLeft: 90, finalRepScore: 100 })
    expect(JSON.stringify(exported)).not.toContain('landmarks')
  })

  it('records squat-specific diagnostic fields without requiring them on other exercises', () => {
    const recorder = new SessionDiagnosticsRecorder()
    const squatRep = {
      exerciseId: 'squat' as const, repIndex: 1, startedAt: 0, completedAt: 4000, durationMs: 4000,
      maxTorsoLean: 3, bottomTime: 1600, maxHipDrop: 0.34, minKneeSpreadRatio: 0.96,
      maxKneeHeightDiff: 0.02, depthScore: 90, stabilityScore: 88, symmetryScore: 91,
      completionScore: 100, tempoScore: 100, overallScore: 92, errors: [],
    }
    recorder.record(squatFeatures({ timestamp: 4000, hipDrop: 0.34, baselineReady: true, standingHipY: 0.52 }), {
      phase: 'COMPLETE', repCount: 1, completedRep: squatRep,
    }, { ...ruleResult(), exerciseId: 'squat', phase: 'COMPLETE' })
    const exported = recorder.export({ cameraFps: 30, inferenceFps: 28, averageInferenceMs: 18, p95InferenceMs: 24, uiFps: 10, droppedFrames: 0, skippedFrames: 0, sampleCount: 10, inputResolution: '1280×720' }, {
      specVersion: 'exercise-rules-v1.0',
      thresholdVersion: 'engineering-v1',
      dataSource: 'demo_image',
      captureSource: 'demo',
    })
    expect(exported.frames[0].hipDrop).toBeCloseTo(0.34)
    expect(exported.frames[0].kneeSpreadRatio).toBeCloseTo(0.94)
    expect(exported.repetitions[0]).toMatchObject({ maxHipDrop: 0.34, bottomTime: 1600 })
    expect(exported.thresholdVersion).toBe('engineering-v1')
  })

  it('calculates average and p95 inference timing', () => {
    const tracker = new PerformanceTracker()
    ;[10, 20, 30, 40].forEach((duration, index) => tracker.recordInference(index * 10, duration, true))
    const result = tracker.snapshot(40)
    expect(result.averageInferenceMs).toBe(25)
    expect(result.p95InferenceMs).toBe(40)
    expect(result.sampleCount).toBe(4)
  })

  it('records Knee Raise side, cycle, velocity and completed-rep scoring fields', () => {
    const recorder = new SessionDiagnosticsRecorder()
    const kneeRep = { exerciseId:'knee_raise' as const, repIndex:2, side:'right' as const, startedAt:1000, completedAt:2300,
      durationMs:1300,startTime:1000,topTime:1600,endTime:2300,peakKneeHeight:0.02,hipShiftMax:0.08,maxTorsoLean:4,
      amplitudeScore:100,stabilityScore:92,alternationScore:100,symmetryScore:95,tempoScore:100,overallScore:97,
      errors:[],wrongSideSequence:false,incompleteReturn:false }
    const kneeState: KneeRaiseStateSnapshot = {phase:'COMPLETE',repCount:2,completedRep:kneeRep,cycleCount:1,currentSide:'right',lastCompletedSide:'right',
      peakKneeHeight:0.02,hipShiftMax:0.08,maxTorsoLean:4,wrongSideSequence:false,incompleteReturn:false,baselineReady:true}
    recorder.record(kneeFeatures({timestamp:2300,leftKneeHeight:-0.7,rightKneeHeight:-0.7,leftKneeVelocity:-0.1,rightKneeVelocity:-0.2,hipHorizontalShift:0.04}),
      kneeState,
      {...ruleResult(),exerciseId:'knee_raise',phase:'COMPLETE'})
    const exported=recorder.export({cameraFps:30,inferenceFps:30,averageInferenceMs:18,p95InferenceMs:25,uiFps:60,droppedFrames:0,skippedFrames:0,sampleCount:50,inputResolution:'1280×720'},
      {specVersion:'exercise-rules-v1.0',thresholdVersion:'engineering-v1',dataSource:'demo_image_sequence',captureSource:'demo'})
    expect(exported.frames[0]).toMatchObject({rightKneeHeight:-0.7,rightKneeVelocity:-0.2,hipShift:0.04,currentSide:'right',lastCompletedSide:'right',cycleCount:1})
    expect(exported.repetitions[0]).toMatchObject({side:'right',topTime:1600,peakKneeHeight:0.02,alternationScore:100})
    expect(exported.dataSource).toBe('demo_image_sequence')
  })
})
