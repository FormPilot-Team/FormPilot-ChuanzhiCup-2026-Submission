import { describe, expect, it } from 'vitest'
import { aggregateCapabilities } from '../src/features/report/capabilityAggregation'
import { aggregateConfirmedIssues } from '../src/features/report/issueAggregation'
import { buildTrainingReport } from '../src/features/report/TrainingReportBuilder'
import { createCompleteReportSession, createIncompleteReportSession, correction } from './helpers/reportFixture'

describe('TrainingReportBuilder', () => {
  it('builds a report-v1 projection without mutating the session', () => {
    const session = createCompleteReportSession()
    const before = JSON.stringify(session)
    const report = buildTrainingReport(session)
    expect(report.reportVersion).toBe('report-v1')
    expect(JSON.stringify(session)).toBe(before)
  })

  it('uses the persisted course total for a complete course', () => {
    const report = buildTrainingReport(createCompleteReportSession())
    expect(report.overallScore).toBe(80)
    expect(report.overallScoreScope).toBe('complete_course')
    expect(report.metadata.scoreSource).toBe('session')
  })

  it('falls back to saved exercise scores when a complete course lacks a total', () => {
    const session = createCompleteReportSession()
    delete session.courseOverallScore
    const report = buildTrainingReport(session)
    expect(report.overallScore).toBe(80)
    expect(report.metadata.scoreSource).toBe('derived_from_saved_exercise_results')
  })

  it('excludes guidance from a complete-course fallback score', () => {
    const session = createCompleteReportSession()
    delete session.courseOverallScore
    session.exercises.find((item) => item.exerciseId === 'shoulder_rotation')!.overallScore = 10_000
    expect(buildTrainingReport(session).overallScore).toBe(80)
  })

  it('labels incomplete scoring as completed-action average', () => {
    const report = buildTrainingReport(createIncompleteReportSession())
    expect(report.overallScore).toBe(86)
    expect(report.overallScoreLabel).toBe('已完成动作平均分')
    expect(report.overallScoreScope).toBe('completed_scored_average')
    expect(report.overallScoreDescription).toContain('1 个计分动作')
  })

  it('does not use the persisted course total for an incomplete course', () => {
    const report = buildTrainingReport(createIncompleteReportSession())
    expect(report.overallScore).not.toBe(56)
  })

  it('returns unavailable scoring when no scored action is complete', () => {
    const session = createIncompleteReportSession()
    session.activeExerciseId = 'overhead_raise'
    session.exercises = session.exercises.slice(0, 2)
    session.exercises[1].completed = false
    session.exercises[1].repetitions = []
    const report = buildTrainingReport(session)
    expect(report.overallScore).toBeNull()
    expect(report.overallScoreScope).toBe('unavailable')
  })

  it('keeps shoulder rotation as guidance without a numeric score', () => {
    const guidance = buildTrainingReport(createCompleteReportSession()).guidanceExercises[0]
    expect(guidance.exerciseId).toBe('shoulder_rotation')
    expect(guidance.score).toBeNull()
    expect(guidance.metrics).toEqual([])
    expect(guidance.summaryText).toContain('不参与课程数值总分')
  })

  it('keeps five actions in the scored group', () => {
    expect(buildTrainingReport(createCompleteReportSession()).scoredExercises).toHaveLength(5)
  })

  it('uses cycles instead of raw repetitions for Step Jack progress', () => {
    const step = buildTrainingReport(createCompleteReportSession()).exerciseSummaries.find((item) => item.exerciseId === 'step_jack')!
    expect(step.repCount).toBe(12)
    expect(step.cycleCount).toBe(6)
    expect(step.progress).toBe(6)
  })

  it('preserves unavailable metrics as null instead of zero', () => {
    const session = createCompleteReportSession()
    delete session.exercises.find((item) => item.exerciseId === 'squat')!.metricAverages.amplitude
    const squat = buildTrainingReport(session).exerciseSummaries.find((item) => item.exerciseId === 'squat')!
    expect(squat.metrics.find((item) => item.key === 'amplitude')?.value).toBeNull()
  })

  it('marks absent exercises unavailable in an incomplete report', () => {
    const report = buildTrainingReport(createIncompleteReportSession())
    expect(report.exerciseSummaries.find((item) => item.exerciseId === 'knee_raise')?.completion).toBe('unavailable')
  })

  it('counts completed actions before the active action', () => {
    const report = buildTrainingReport(createIncompleteReportSession())
    expect(report.completion.completed).toBe(2)
    expect(report.completion.total).toBe(6)
  })

  it('derives duration when totalDurationMs is missing', () => {
    const session = createCompleteReportSession()
    delete session.totalDurationMs
    expect(buildTrainingReport(session).durationMs).toBe(360_000)
  })

  it('only aggregates confirmed correction events', () => {
    const session = createCompleteReportSession()
    const lateral = session.exercises.find((item) => item.exerciseId === 'lateral_raise')!
    lateral.feedbackEvents.push({ id: 'recovery-2', timestamp: 500, kind: 'recovery', exerciseId: 'lateral_raise', code: 'DEPTH_INSUFFICIENT', severity: 1, message: '恢复' })
    const issues = aggregateConfirmedIssues(session.exercises)
    expect(issues.find((item) => item.errorCode === 'ARM_TOO_LOW_R')?.count).toBe(4)
    expect(issues.find((item) => item.errorCode === 'DEPTH_INSUFFICIENT')?.count).toBe(3)
  })

  it('does not invent issues from topErrors without feedback evidence', () => {
    const session = createCompleteReportSession()
    session.exercises.forEach((exercise) => { exercise.feedbackEvents = []; exercise.topErrors = ['BODY_SWAY'] })
    expect(buildTrainingReport(session).topIssues).toEqual([])
  })

  it('groups the same exercise and error while preserving only an unambiguous side', () => {
    const session = createCompleteReportSession()
    const lateral = session.exercises.find((item) => item.exerciseId === 'lateral_raise')!
    lateral.feedbackEvents.push(correction('lateral_raise', 'ARM_TOO_LOW_R', 600, 'left'))
    const issues = aggregateConfirmedIssues(session.exercises).filter((item) => item.errorCode === 'ARM_TOO_LOW_R')
    expect(issues).toHaveLength(1)
    expect(issues[0].count).toBe(5)
    expect(issues[0].side).toBeUndefined()
  })

  it('sorts issues deterministically by frequency, severity, then timestamp', () => {
    const issues = buildTrainingReport(createCompleteReportSession()).topIssues
    expect(issues.map((item) => item.errorCode)).toEqual(['ARM_TOO_LOW_R', 'DEPTH_INSUFFICIENT', 'ARM_LEG_UNSYNCED'])
  })

  it('computes five named capability dimensions', () => {
    const capabilities = buildTrainingReport(createCompleteReportSession()).capabilitySummary
    expect(capabilities.map((item) => item.dimension)).toEqual(['AMPLITUDE', 'STABILITY', 'COORDINATION', 'TEMPO', 'CONTROL'])
  })

  it.each([
    ['AMPLITUDE', 77, 5] as const,
    ['STABILITY', 81, 5] as const,
    ['COORDINATION', 77, 5] as const,
    ['TEMPO', 75, 5] as const,
    ['CONTROL', 92, 3] as const,
  ])('aggregates %s from its explicit available contributions', (dimension, value, sampleCount) => {
    const capability = buildTrainingReport(createCompleteReportSession()).capabilitySummary.find((item) => item.dimension === dimension)!
    expect(capability.value).toBe(value)
    expect(capability.sampleCount).toBe(sampleCount)
  })

  it('averages multi-metric coordination within one exercise before the course mean', () => {
    const report = buildTrainingReport(createCompleteReportSession())
    const coordination = report.capabilitySummary.find((item) => item.dimension === 'COORDINATION')!
    const knee = coordination.contributions.find((item) => item.exerciseId === 'knee_raise')!
    expect(knee.value).toBe(76)
    expect(coordination.sampleCount).toBe(5)
  })

  it('excludes incomplete scored actions from capability aggregation', () => {
    const report = buildTrainingReport(createIncompleteReportSession())
    expect(report.capabilitySummary.every((item) => item.sampleCount <= 1)).toBe(true)
  })

  it('does not treat missing capability values as zero', () => {
    const report = buildTrainingReport(createCompleteReportSession())
    report.scoredExercises.forEach((exercise) => exercise.metrics.forEach((metric) => { metric.value = null }))
    expect(aggregateCapabilities(report.scoredExercises).every((item) => item.value === null)).toBe(true)
  })

  it('builds the same report for the same persisted input', () => {
    const session = createCompleteReportSession()
    expect(buildTrainingReport(session)).toEqual(buildTrainingReport(session))
  })
})
