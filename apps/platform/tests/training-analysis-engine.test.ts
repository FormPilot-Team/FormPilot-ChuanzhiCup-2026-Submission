import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_VERSION, REPORT_ISSUE_TAXONOMY, analyzeTraining, compareIssueTrend, compareScore, isSignificantIssue,
} from '../src/features/analysis'
import {
  DEMO_AND_STANDALONE, DETERMINISM, FAST_SESSION, FIRST_SESSION, FULL_IMPROVEMENT, FULL_REGRESSION,
  INVALID_REPS, KNEE_RAISE_PAIRING, LEGACY_SESSION, MISSING_TOP_ELBOW, NEW_ISSUE, PARTIAL_SESSION,
  PERSISTENT_ISSUE, POSE_QUALITY_ONLY, RESOLVED_ISSUE, STEP_JACK_FIRST_REP_AND_SYNC_GATE,
  THEME_MERGE_AND_CAPS, makeAnalysisSession,
} from './analysis-fixtures'

describe('analysis-v1 TrainingAnalysisEngine', () => {
  it('analyzes the first session without inventing a comparison', () => {
    const result = analyzeTraining(FIRST_SESSION, [])
    expect(result.version).toBe(ANALYSIS_VERSION)
    expect(result.comparison).toMatchObject({ level: 'NONE', unavailableReason: 'NO_HISTORY' })
    expect(result.overallScore).toBe(80)
  })

  it('recomputes full score improvements and regressions from repetitions', () => {
    const improved = analyzeTraining(FULL_IMPROVEMENT.current, FULL_IMPROVEMENT.history)
    const regressed = analyzeTraining(FULL_REGRESSION.current, FULL_REGRESSION.history)
    expect(improved.comparison.level).toBe('FULL')
    expect(improved.overallScore).toBe(90)
    expect(improved.previousOverallScore).toBe(80)
    expect(improved.overallTrend).toBe('IMPROVED')
    expect(regressed.overallTrend).toBe('REGRESSED')
  })

  it('applies frozen exercise, overall and capability deadbands inclusively', () => {
    expect(compareScore(83, 82, 5)).toBe('STABLE')
    expect(compareScore(85, 80, 5)).toBe('IMPROVED')
    expect(compareScore(77, 80, 3)).toBe('REGRESSED')
  })

  it('implements all frozen issue-trend examples', () => {
    expect(compareIssueTrend({ affected: 1, evaluable: 6 }, { affected: 2, evaluable: 6 })).toBeNull()
    expect(compareIssueTrend({ affected: 1, evaluable: 6 }, { affected: 3, evaluable: 6 })).toBe('IMPROVED')
    expect(compareIssueTrend({ affected: 3, evaluable: 6 }, { affected: 4, evaluable: 6 })).toBe('PERSISTENT')
    expect(compareIssueTrend({ affected: 0, evaluable: 6 }, { affected: 3, evaluable: 6 })).toBe('RESOLVED')
    expect(compareIssueTrend({ affected: 2, evaluable: 6 }, { affected: 0, evaluable: 6 })).toBe('NEW')
    expect(compareIssueTrend({ affected: 3, evaluable: 6 }, { affected: 1, evaluable: 6 })).toBe('WORSENED')
    expect(analyzeTraining(PERSISTENT_ISSUE.current, PERSISTENT_ISSUE.history).issues.find((item) => item.code === 'DEPTH_INSUFFICIENT')?.trend).toBe('PERSISTENT')
    expect(analyzeTraining(RESOLVED_ISSUE.current, RESOLVED_ISSUE.history).issues.find((item) => item.code === 'DEPTH_INSUFFICIENT')?.trend).toBe('RESOLVED')
    expect(analyzeTraining(NEW_ISSUE.current, NEW_ISSUE.history).issues.find((item) => item.code === 'DEPTH_INSUFFICIENT')?.trend).toBe('NEW')
  })

  it('uses integer cross multiplication at significance boundaries', () => {
    expect(isSignificantIssue({ affected: 2, evaluable: 6 })).toBe(true)
    expect(isSignificantIssue({ affected: 2, evaluable: 7 })).toBe(false)
    expect(isSignificantIssue({ affected: 1, evaluable: 4 })).toBe(false)
  })

  it('allows partial comparison for two common scored exercises and forbids overall delta', () => {
    const result = analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history)
    expect(result.comparison.level).toBe('PARTIAL')
    expect(result.comparison.commonExerciseIds).toEqual(['overhead_raise', 'lateral_raise'])
    expect(result.overallScore).toBeNull()
    expect(result.overallDelta).toBeNull()
  })

  it('re-aggregates capability comparison on the common contributor intersection', () => {
    const current = makeAnalysisSession({
      id: 'cap-current', startedAt: 2000, score: 90,
      exerciseIds: ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack', 'squat'],
    })
    const previous = makeAnalysisSession({
      id: 'cap-previous', startedAt: 1000, score: 70,
      exerciseIds: ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack'],
    })
    const result = analyzeTraining(current, [previous])
    const amplitude = result.capabilities.dimensions.find((item) => item.dimension === 'AMPLITUDE')
    expect(result.comparison.level).toBe('PARTIAL')
    expect(amplitude?.comparisonContributors).toEqual(['overhead_raise', 'lateral_raise', 'step_jack'])
    expect(amplitude?.previousValue).toBe(70)
    expect(amplitude?.delta).toBe(20)
  })

  it('excludes invalid repetitions instead of scoring them as zero', () => {
    const result = analyzeTraining(INVALID_REPS, [])
    const squat = result.exercises.find((item) => item.exerciseId === 'squat')
    expect(squat?.repetitionQuality.invalid).toBe(4)
    expect(squat?.score).toBeNull()
    expect(result.dataQuality.reps.invalid).toBe(4)
  })

  it('keeps pose quality entirely outside report issues', () => {
    const result = analyzeTraining(POSE_QUALITY_ONLY, [])
    expect(REPORT_ISSUE_TAXONOMY.some((item) => item.code === 'POSE_LOW_CONFIDENCE' || item.code === 'BODY_OUT_OF_FRAME')).toBe(false)
    expect(result.issues.some((item) => item.code === 'POSE_LOW_CONFIDENCE' || item.code === 'BODY_OUT_OF_FRAME')).toBe(false)
    expect(result.dataQuality.poseQualityEvents).toBeGreaterThan(0)
  })

  it('uses the complete frozen issue whitelist and never stored aggregates', () => {
    const result = analyzeTraining(FIRST_SESSION, [])
    expect(REPORT_ISSUE_TAXONOMY).toHaveLength(30)
    expect(FIRST_SESSION.courseOverallScore).toBe(1)
    expect(FIRST_SESSION.exercises.every((item) => item.overallScore <= 1)).toBe(true)
    expect(result.overallScore).toBe(80)
  })

  it('handles legacy, fast and demo records without historical fallback', () => {
    const history = [FIRST_SESSION]
    expect(analyzeTraining(LEGACY_SESSION, history).comparison.unavailableReason).toBe('CURRENT_RULES_LEGACY')
    expect(analyzeTraining(FAST_SESSION, history).comparison.unavailableReason).toBe('CURRENT_MODE_NOT_NORMAL')
    expect(analyzeTraining(DEMO_AND_STANDALONE, history).comparison.unavailableReason).toBe('CURRENT_NON_LIVE')
  })

  it('does not fall back when overhead TOP elbow evidence is missing', () => {
    const result = analyzeTraining(MISSING_TOP_ELBOW, [])
    const overhead = result.exercises.find((item) => item.exerciseId === 'overhead_raise')
    const elbow = overhead?.issues.find((item) => item.code === 'ELBOW_TOO_BENT_L')
    expect(overhead?.repetitionQuality.partial).toBe(6)
    expect(elbow?.incidence).toEqual({ affected: 0, evaluable: 0 })
    expect(result.capabilities.dimensions.find((item) => item.dimension === 'FORM')?.contributors.some((item) => item.exerciseId === 'overhead_raise')).toBe(false)
    expect(result.dataQuality.missingTopElbow).toBe(6)
  })

  it('gates first-rep sequence evidence and pairs knee raises', () => {
    const step = analyzeTraining(STEP_JACK_FIRST_REP_AND_SYNC_GATE, [])
    expect(step.issues.find((item) => item.code === 'WRONG_SIDE_SEQUENCE')?.incidence).toEqual({ affected: 0, evaluable: 5 })
    const knee = analyzeTraining(KNEE_RAISE_PAIRING, [])
    expect(knee.issues.find((item) => item.code === 'LEFT_RIGHT_HEIGHT_GAP')?.incidence.evaluable).toBe(9)
    expect(knee.capabilities.dimensions.find((item) => item.dimension === 'COORDINATION')?.contributors.some((item) => item.exerciseId === 'knee_raise')).toBe(true)
  })

  it('merges side themes and enforces priority caps', () => {
    const result = analyzeTraining(THEME_MERGE_AND_CAPS, [])
    expect(result.priorityIssues.length).toBeLessThanOrEqual(3)
    expect(result.priorityIssues.filter((item) => item.exerciseId === 'overhead_raise').length).toBeLessThanOrEqual(2)
    expect(result.priorityIssues.some((item) => item.mergedFrom.length === 2)).toBe(true)
    expect(result.nextFocus.length).toBeLessThanOrEqual(2)
  })

  it('emits at most one factual within-session statement per exercise', () => {
    const session = makeAnalysisSession({ id: 'within', startedAt: 2000, affected: {
      'squat:DEPTH_INSUFFICIENT': 3,
      'squat:KNEE_VALGUS': 3,
    } })
    const result = analyzeTraining(session, [])
    const squatInsights = result.withinSession.filter((item) => item.exerciseId === 'squat')
    expect(squatInsights).toHaveLength(1)
    expect(squatInsights[0].text).toContain('前 3 次中 3 次，后 3 次中 0 次')
    expect(squatInsights[0].text).not.toContain('越来越好')
  })

  it('keeps summaries within 2–4 sentences and attaches evidence to every sentence', () => {
    const result = analyzeTraining(FIRST_SESSION, [])
    expect(result.summary.length).toBeGreaterThanOrEqual(2)
    expect(result.summary.length).toBeLessThanOrEqual(4)
    expect(result.summary.every((item) => item.evidenceRefs.length > 0)).toBe(true)
  })

  it('is deterministic, immutable and history-order independent with stable ties', () => {
    const older = makeAnalysisSession({ id: 'z-session', startedAt: 1000, score: 70 })
    const tiedFirst = makeAnalysisSession({ id: 'a-session', startedAt: 1500, score: 75 })
    const tiedSecond = makeAnalysisSession({ id: 'b-session', startedAt: 1500, score: 76 })
    const history = [older, tiedSecond, tiedFirst]
    const beforeCurrent = structuredClone(DETERMINISM)
    const beforeHistory = structuredClone(history)
    const first = analyzeTraining(DETERMINISM, history)
    const second = analyzeTraining(DETERMINISM, [tiedFirst, older, tiedSecond])
    expect(first).toEqual(analyzeTraining(DETERMINISM, history))
    expect(first).toEqual(second)
    expect(first.comparison.previousSessionId).toBe('a-session')
    expect(DETERMINISM).toEqual(beforeCurrent)
    expect(history).toEqual(beforeHistory)
  })
})
