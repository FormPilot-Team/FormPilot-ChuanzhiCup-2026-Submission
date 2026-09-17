import { describe, expect, it } from 'vitest'
import { buildRecommendations } from '../src/features/report/recommendationRules'
import { buildTrainingReport } from '../src/features/report/TrainingReportBuilder'
import { createCompleteReportSession } from './helpers/reportFixture'

describe('report recommendation rules', () => {
  it('returns no more than three recommendations', () => {
    expect(buildTrainingReport(createCompleteReportSession()).recommendations).toHaveLength(3)
  })

  it('prioritizes confirmed recurring issues', () => {
    const recommendations = buildTrainingReport(createCompleteReportSession()).recommendations
    expect(recommendations.every((item) => item.sourceType === 'issue')).toBe(true)
    expect(recommendations[0].sourceError).toBe('ARM_TOO_LOW_R')
  })

  it('uses a specific depth recommendation', () => {
    const recommendation = buildTrainingReport(createCompleteReportSession()).recommendations.find((item) => item.sourceError === 'DEPTH_INSUFFICIENT')!
    expect(recommendation.text).toContain('下蹲深度')
  })

  it('uses a specific right-arm recommendation', () => {
    const recommendation = buildTrainingReport(createCompleteReportSession()).recommendations.find((item) => item.sourceError === 'ARM_TOO_LOW_R')!
    expect(recommendation.text).toContain('右臂高度')
  })

  it('falls back to the lowest capability when there are no issues', () => {
    const report = buildTrainingReport(createCompleteReportSession())
    report.capabilitySummary.find((item) => item.dimension === 'TEMPO')!.value = 60
    const recommendations = buildRecommendations([], report.capabilitySummary, report.scoredExercises)
    expect(recommendations[0].sourceType).toBe('capability')
  })

  it('falls back to the lowest exercise metric after capability advice', () => {
    const report = buildTrainingReport(createCompleteReportSession())
    const recommendations = buildRecommendations([], report.capabilitySummary, report.scoredExercises)
    expect(recommendations.some((item) => item.sourceType === 'exercise_metric')).toBe(true)
  })

  it('returns neutral guidance when no evidence is available', () => {
    const report = buildTrainingReport(createCompleteReportSession())
    report.capabilitySummary.forEach((item) => { item.value = null })
    report.scoredExercises.forEach((exercise) => exercise.metrics.forEach((metric) => { metric.value = null }))
    expect(buildRecommendations([], report.capabilitySummary, report.scoredExercises)).toEqual([
      expect.objectContaining({ sourceType: 'neutral' }),
    ])
  })

  it('numbers recommendation priorities deterministically', () => {
    expect(buildTrainingReport(createCompleteReportSession()).recommendations.map((item) => item.priority)).toEqual([1, 2, 3])
  })

  it.each([
    ['ARM_LEG_UNSYNCED', '手臂和侧步'] as const,
    ['KNEE_TOO_LOW_L', '左侧提膝幅度'] as const,
    ['BODY_SWAY', '身体稳定'] as const,
  ])('provides an evidence-matched template for %s', (errorCode, expectedText) => {
    const report = buildTrainingReport(createCompleteReportSession())
    const baseIssue = report.topIssues[0]
    const recommendations = buildRecommendations([{ ...baseIssue, id: errorCode, errorCode }], [], [])
    expect(recommendations[0].text).toContain(expectedText)
  })
})
