import { describe, expect, it } from 'vitest'
import { routineDigest, warmUpDigest } from '../src/features/aiCoach/digests'
import { answerIntent, matchQuestion } from '../src/features/aiCoach/intents'
import type { CoachPageContext } from '../src/features/aiCoach/types'
import { buildWarmUpCoachContext, warmUpGuide } from '../src/features/coachContext/liveCoachContexts'
import { analyzeTraining } from '../src/features/analysis'
import { getExerciseDefinition } from '../src/features/exercises/registry'
import type { ExerciseId, RuleResult } from '../src/features/exercises/types'
import { buildRoutineReport } from '../src/features/routines/report/routineReport'
import { explainWarmUpExercise, explainWarmUpSession, warmUpCriterionForCode } from '../src/features/scoring'
import { MemoryTrainingSessionRepository } from '../src/features/training/MemoryTrainingSessionRepository'
import { TrainingSession } from '../src/features/training/TrainingSession'
import { FIRST_SESSION, FULL_IMPROVEMENT, THEME_MERGE_AND_CAPS, at, makeSession } from './analysis-fixtures'
import { routineRecord } from './helpers/routineFixtures'

const SCORED: ExerciseId[] = ['overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise']

describe('Scoring v2 warm-up: the explanation decomposes the score the report shows', () => {
  for (const session of [FIRST_SESSION, FULL_IMPROVEMENT.current, THEME_MERGE_AND_CAPS]) {
    it(`${session.id}: exercise scores match analysis-v1 and the weighted components add up`, () => {
      const analysis = analyzeTraining(session, [])
      const explanation = explainWarmUpSession(session)
      for (const exerciseId of SCORED) {
        const shown = analysis.exercises.find((item) => item.exerciseId === exerciseId)?.score ?? null
        const explained = explanation.exercises.find((item) => item.exerciseId === exerciseId)
        expect(explained?.score, exerciseId).toBe(shown)
        if (shown === null || !explained) continue
        expect(explained.components.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 9)
        expect(Math.abs((explained.weightedSum as number) - shown), exerciseId).toBeLessThanOrEqual(1)
        expect(explained.components.every((item) => item.criterion.scoring === 'SCORED')).toBe(true)
      }
    })
  }

  it('names the biggest deduction with the repetition, the measured value, the target and the basis', () => {
    const session = makeSession({ id: 'bent', startedAt: at(3), exercises: { overhead_raise: { raw: () => ({ minElbowL: 90, minElbowR: 95, topElbowL: 118, topElbowR: 124 }) } } })
    const overhead = explainWarmUpExercise(session, 'overhead_raise')
    const top = overhead.deductions[0]
    expect(top.criterion.id).toBe('wu.overhead_raise.elbow')
    expect(top.score).toBe(20)
    expect(top.lostPoints).toBe(20)
    expect(top.worst[0]).toMatchObject({ repNumber: 1, observedText: '118°', targetText: '≥ 150°', phase: '顶部 / 近顶部' })
    expect(top.criterion.thresholdBasis).toContain('engineering-v1')
  })

  it('explains 肩部环绕 from its recorded guidance summary and never scores it', () => {
    const session = new TrainingSession(1000, new MemoryTrainingSessionRepository(), ['shoulder_rotation', 'overhead_raise'])
    const result = (amplitude: number, lean: number): RuleResult => ({
      exerciseId: 'shoulder_rotation', phase: 'ROTATING', confidence: 0.9, currentScore: 0, errors: lean > 10 ? [{ code: 'TORSO_LEAN', severity: 0.7, message: '保持躯干直立稳定' }] : [],
      metrics: {
        amplitude: { value: amplitude, score: Math.min(100, (amplitude / 35) * 100), valid: true, unit: '°' },
        coordination: { value: 0.8, score: 80, valid: true, unit: '' },
        continuity: { value: 0.9, score: 90, valid: true, unit: '' },
        stability: { value: lean, score: Math.max(0, 100 - lean * 10), valid: true, unit: '°' },
      },
    })
    session.record(result(30, 4), { phase: 'ROTATING', repCount: 0 })
    session.record(result(40, 12), { phase: 'ROTATING', repCount: 0 })
    session.record({ ...result(0, 0), phase: 'READY' }, { phase: 'READY', repCount: 0 })
    const snapshot = session.snapshot()
    const summary = snapshot.exercises[0].guidanceSummary
    expect(summary).toMatchObject({ samples: 2, errorFrames: { TORSO_LEAN: 1 } })
    expect(summary?.metrics.amplitude.value).toBe(35)
    const explanation = explainWarmUpExercise(snapshot, 'shoulder_rotation')
    expect(explanation.evaluationMode).toBe('guidance')
    expect(explanation.score).toBeNull()
    expect(explanation.guidance.find((item) => item.criterion.id === 'wu.shoulder_rotation.range')).toMatchObject({ valueText: '35°', meets: true })
    expect(explanation.guidance.find((item) => item.criterion.id === 'wu.shoulder_rotation.torso')).toMatchObject({ valueText: '8°', meets: true })
    // The repetition list and analysis-v1 are untouched by the guidance summary.
    expect(snapshot.exercises[0].repetitions).toEqual([])
  })

  it('keeps squat requirements the camera cannot see as references, and cites the official squat guidance', () => {
    const squat = explainWarmUpExercise(FIRST_SESSION, 'squat')
    expect(squat.references.map((item) => item.name)).toEqual(['腰背挺直、骨盆中立', '脚尖略外开（不超过 30°）', '收紧核心'])
    expect(squat.references.every((item) => item.observable === 'NOT_OBSERVABLE' && item.weight === 0)).toBe(true)
    expect(squat.officialSources).toEqual(['《深蹲并非越“深”越好》', '《下蹲动作加强肌肉力量》'])
    expect(squat.components.find((item) => item.criterion.id === 'wu.squat.knee_track')?.criterion.name).toBe('膝部轨迹')
    expect(squat.components.find((item) => item.criterion.id === 'wu.squat.knee_track')?.criterion.description).toContain('没有明显向内偏移')
  })

  it('reports the lateral-raise elbow check without weighting it', () => {
    const session = makeSession({ id: 'lateral-elbow', startedAt: at(4), exercises: { lateral_raise: { raw: (index) => (index < 2 ? { minElbowL: 138 } : undefined) } } })
    const lateral = explainWarmUpExercise(session, 'lateral_raise')
    const elbow = lateral.advisory.find((item) => item.criterion.id === 'wu.lateral_raise.elbow')
    expect(elbow).toMatchObject({ evaluatedReps: 6, affectedReps: 2 })
    expect(elbow?.criterion.weight).toBe(0)
    expect(lateral.components.some((item) => item.criterion.id === 'wu.lateral_raise.elbow')).toBe(false)
  })

  it('maps live correction codes to the criterion they come from', () => {
    expect(warmUpCriterionForCode('overhead_raise', 'ELBOW_TOO_BENT_L')?.id).toBe('wu.overhead_raise.elbow')
    expect(warmUpCriterionForCode('squat', 'KNEE_VALGUS')?.id).toBe('wu.squat.knee_track')
    expect(warmUpCriterionForCode('squat', 'POSE_LOW_CONFIDENCE')).toBeUndefined()
  })
})

describe('Scoring v2 AI Coach: “为什么是这个分数？” is answered from scoring evidence', () => {
  it('recognises the question on a report', () => {
    const digest = warmUpDigest(analyzeTraining(FIRST_SESSION, []), FIRST_SESSION)
    const context: CoachPageContext = { page: 'report', digest }
    expect(matchQuestion('为什么我只有 78 分？', context)).toEqual({ kind: 'intent', id: 'why-score' })
    expect(matchQuestion('哪里扣分了', context)).toEqual({ kind: 'intent', id: 'why-score' })
  })

  it('explains a warm-up score by its components, the deduction evidence and the basis', () => {
    const session = makeSession({ id: 'coach-bent', startedAt: at(5), exercises: { overhead_raise: { raw: () => ({ minElbowL: 90, minElbowR: 95, topElbowL: 118, topElbowR: 124 }) } } })
    const analysis = analyzeTraining(session, [])
    const answer = answerIntent('why-score', { page: 'report', digest: warmUpDigest(analysis, session) })
    expect(answer.text).toContain(`综合评分 ${analysis.overall.score} 分`)
    expect(answer.text).toContain('主要扣分在「双臂上举 · 上举时手肘弯曲」')
    expect(answer.text).toContain('顶部有效帧肘角（较低侧） 118°，满分要求 ≥ 150°')
    expect(answer.text).toContain('识别到的关节角度和位置')
    expect(answer.text).toContain('FormPilot 工程标定')
    expect(answer.text).not.toContain('继续努力')
    expect(answer.facts?.map((item) => item.label)).toContain('双臂上举')
  })

  it('keeps similarity and technique apart for a routine, and declines for a custom action', () => {
    const report = buildRoutineReport(routineRecord())!
    const routineAnswer = answerIntent('why-score', { page: 'report', digest: routineDigest(report) })
    expect(routineAnswer.text).toContain('跟练相似度')
    expect(routineAnswer.text).toContain('视觉接近程度')
    expect(routineDigest(report).scoreExplanation?.summary).toContain('评分说明上线之前')
    const custom = { ...routineDigest(report), kind: 'custom' as const, scoreExplanation: null }
    expect(answerIntent('why-score', { page: 'report', digest: custom }).text).toContain('不打分')
  })

  it('names the checked requirement behind a live warm-up correction', () => {
    const definition = getExerciseDefinition('squat')
    const context: CoachPageContext = {
      page: 'training',
      live: buildWarmUpCoachContext({ definition, position: { index: 4, total: 6 }, freeTraining: false, courseState: 'ACTIVE', progress: 2, target: 6, targetUnit: '次', score: 80, feedback: { id: 'f', timestamp: 0, kind: 'correction', exerciseId: 'squat', code: 'KNEE_VALGUS', message: '注意膝盖方向，不要向内夹', severity: 0.5 } }),
      guide: warmUpGuide(definition, '次'),
    }
    expect(answerIntent('why-corrected', context).text).toContain('对应检查项「膝部轨迹」')
  })
})
