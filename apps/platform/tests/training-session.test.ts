import { describe, expect, it } from 'vitest'
import { TrainingSession } from '../src/features/training/TrainingSession'
import type { TrainingSessionRepository } from '../src/features/training/TrainingSessionRepository'
import type { TrainingSessionState } from '../src/features/training/types'
import { ruleResult, snapshot } from './helpers/fixtures'

const rep = {
  exerciseId: 'lateral_raise' as const,
  repIndex: 1,
  startedAt: 0,
  completedAt: 3000,
  durationMs: 3000,
  topHoldMs: 400,
  peakShoulderL: 90,
  peakShoulderR: 90,
  minElbowL: 170,
  minElbowR: 170,
  maxSymmetryDiff: 4,
  maxTorsoLean: 2,
}

describe('TrainingSession', () => {
  it('tracks lifecycle and deduplicates the same completed repetition', () => {
    const session = new TrainingSession(100)
    expect(session.start().status).toBe('active')
    expect(session.togglePause().status).toBe('paused')
    expect(session.togglePause().status).toBe('active')
    const state = snapshot({ phase: 'COMPLETE', repCount: 1, completedRep: rep })
    session.record(ruleResult(), state)
    session.record(ruleResult(), state)
    expect(session.snapshot().exercises[0].repetitions).toHaveLength(1)
    expect(session.finish(4000)).toMatchObject({ status: 'completed', endedAt: 4000 })
  })

  it('stores two exercise results through the repository abstraction', () => {
    const saved: TrainingSessionState[] = []
    const repository: TrainingSessionRepository = {
      save: (value) => { saved.push(structuredClone(value)); return true },
      get: (id) => saved.find((item) => item.id === id),
      list: () => structuredClone(saved),
    }
    const session = new TrainingSession(100, repository)
    session.start()
    session.record(ruleResult(), snapshot({ phase: 'COMPLETE', repCount: 1, completedRep: rep }))
    session.switchExercise('step_jack', 2000)
    const stepRep = {
      exerciseId: 'step_jack' as const,
      repIndex: 1,
      startedAt: 0,
      completedAt: 1300,
      durationMs: 1300,
      maxTorsoLean: 2,
      side: 'left' as const,
      peakOpenRatio: 1.7,
      peakMeanShoulderAngle: 145,
      maxArmAngleDiff: 5,
      syncGapMs: 100,
      wrongSideSequence: false,
      incompleteReturn: false,
    }
    session.record({ ...ruleResult(), exerciseId: 'step_jack', metrics: {
      amplitude: { value: 1.7, score: 100, valid: true }, coordination: { value: 0.1, score: 100, valid: true },
      stability: { value: 2, score: 100, valid: true }, tempo: { value: 1.3, score: 100, valid: true }, completion: { value: 1, score: 100, valid: true },
    } }, { phase: 'CENTER', repCount: 1, completedRep: stepRep })
    const final = session.finish(4000)
    expect(final.exercises.map((item) => [item.exerciseId, item.repetitions.length])).toEqual([['lateral_raise', 1], ['step_jack', 1]])
    expect(final.exercises.every((item) => item.overallScore > 0)).toBe(true)
    expect(saved.at(-1)?.status).toBe('completed')
  })

  it('persists Phase 5 course fields, exact order, feedback totals, recurring errors, and excludes guidance from scoring', () => {
    const order = ['shoulder_rotation','overhead_raise','lateral_raise','step_jack','squat','knee_raise'] as const
    const session = new TrainingSession(100, undefined, [...order], 'synthetic')
    session.start()
    session.completeGuidanceExercise('shoulder_rotation', 1100)
    session.switchExercise('lateral_raise', 1200)
    const error = { code:'TORSO_LEAN' as const, severity:.7, message:'保持躯干直立' }
    const feedback = { id:'feedback-1', timestamp:1300, kind:'correction' as const, exerciseId:'lateral_raise' as const, code:'TORSO_LEAN' as const, message:'保持躯干直立', severity:.7 }
    const scored = { ...ruleResult([error]), currentScore:80 }
    session.record(scored, snapshot({ phase:'COMPLETE', repCount:1, completedRep:rep }), feedback)
    session.record(scored, snapshot({ phase:'COMPLETE', repCount:2, completedRep:{ ...rep, repIndex:2, startedAt:3100, completedAt:6100 } }), { ...feedback, id:'feedback-2', timestamp:6100 })
    const final = session.finish(7100, 'completed')

    expect(final).toMatchObject({
      schemaVersion:2, source:'synthetic', status:'completed', courseStatus:'completed', totalDurationMs:7000,
      totalFeedbackCount:2, courseOverallScore:80, topRecurringErrors:['TORSO_LEAN'], exerciseOrder:[...order],
    })
    expect(final.courseId).toBeTruthy()
    expect(final.courseVersion).toBeTruthy()
    expect(final.exercises.find((item) => item.exerciseId === 'shoulder_rotation')).toMatchObject({ evaluationMode:'guidance', completed:true })
  })

  it('persists an early course end as incomplete', () => {
    const session = new TrainingSession(100)
    session.start()
    expect(session.finish(500, 'incomplete')).toMatchObject({ status:'completed', courseStatus:'incomplete', totalDurationMs:400 })
  })
})
