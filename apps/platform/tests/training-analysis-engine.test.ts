import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_CONFIG_V1, ANALYSIS_VERSION, NON_REPORTABLE_ISSUES, REPORT_ISSUE_TAXONOMY, analyzeTraining, isSignificant, issueTrend,
  kneeRaisePairs, maxAffectedForCompliantTarget, maxAffectedForImprovement, maxAffectedWithoutSignificance, plannedUnits, scoreTrend, significanceOf,
} from '../src/features/analysis'
import type { IssueAnalysis, TrainingAnalysis } from '../src/features/analysis'
import type { MotionErrorCode } from '../src/features/exercises/types'
import {
  DEMO_SESSION, DETERMINISM, FAST_SESSION, FIRST_SESSION, FULL_IMPROVEMENT, FULL_REGRESSION, INVALID_REPS, INVALID_REPS_FOUR,
  KNEE_RAISE_PAIRING, LEGACY_FAST_SUSPECTED, LEGACY_SESSION, LOW_MIN_ELBOW_TOP_OK, MISSING_TOP_ELBOW, NEW_ISSUE, PARTIAL_SESSION,
  PERSISTENT_ISSUE, POSE_QUALITY_ONLY, RESOLVED_ISSUE, STANDALONE_SESSION, STEP_JACK_FIRST_REP_AND_SYNC_GATE, THEME_MERGE_AND_CAPS,
  at, makeSession,
} from './analysis-fixtures'

const R = (affected: number, evaluable: number) => ({ affected, evaluable })

function issue(result: TrainingAnalysis, canonicalId: string): IssueAnalysis {
  const found = result.exercises.flatMap((item) => item.issues).find((item) => item.canonicalId === canonicalId)
  if (!found) throw new Error(`missing issue ${canonicalId}`)
  return found
}
function exercise(result: TrainingAnalysis, exerciseId: string) {
  const found = result.exercises.find((item) => item.exerciseId === exerciseId)
  if (!found) throw new Error(`missing exercise ${exerciseId}`)
  return found
}
function dimension(result: TrainingAnalysis, id: string) {
  const found = result.capability.dimensions.find((item) => item.dimension === id)
  if (!found) throw new Error(`missing dimension ${id}`)
  return found
}
const OLDER = () => makeSession({ id: 'older', startedAt: at(0) })

/** Every user-facing string in the analysis output. */
function userText(result: TrainingAnalysis): string[] {
  return [
    ...result.summary.map((item) => item.text),
    ...result.priorityIssues.flatMap((item) => [item.text, item.reportLabel, item.cue]),
    ...result.nextFocus.flatMap((item) => [item.text, item.cue, item.target?.text ?? '']),
    ...result.strengths.map((item) => item.text),
    ...result.improvements.map((item) => item.text),
    ...result.exercises.flatMap((item) => [item.takeaway ?? '', item.withinExerciseImprovement?.text ?? '', ...item.issues.flatMap((entry) => [entry.reportLabel, entry.cue])]),
    ...result.dataQuality.notes,
    result.comparison.reasonText ?? '',
    result.guidance.text,
  ]
}

const ALL_FIXTURE_RUNS: Array<[string, () => TrainingAnalysis]> = [
  ['FIRST_SESSION', () => analyzeTraining(FIRST_SESSION, [])],
  ['FULL_IMPROVEMENT', () => analyzeTraining(FULL_IMPROVEMENT.current, FULL_IMPROVEMENT.history)],
  ['FULL_REGRESSION', () => analyzeTraining(FULL_REGRESSION.current, FULL_REGRESSION.history)],
  ['PERSISTENT_ISSUE', () => analyzeTraining(PERSISTENT_ISSUE.current, PERSISTENT_ISSUE.history)],
  ['RESOLVED_ISSUE', () => analyzeTraining(RESOLVED_ISSUE.current, RESOLVED_ISSUE.history)],
  ['NEW_ISSUE', () => analyzeTraining(NEW_ISSUE.current, NEW_ISSUE.history)],
  ['PARTIAL_SESSION', () => analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history)],
  ['INVALID_REPS', () => analyzeTraining(INVALID_REPS, [])],
  ['POSE_QUALITY_ONLY', () => analyzeTraining(POSE_QUALITY_ONLY, [])],
  ['LEGACY_SESSION', () => analyzeTraining(LEGACY_SESSION, [OLDER()])],
  ['FAST_SESSION', () => analyzeTraining(FAST_SESSION, [OLDER()])],
  ['MISSING_TOP_ELBOW', () => analyzeTraining(MISSING_TOP_ELBOW, [])],
  ['THEME_MERGE_AND_CAPS', () => analyzeTraining(THEME_MERGE_AND_CAPS, [])],
  ['STEP_JACK_GATES', () => analyzeTraining(STEP_JACK_FIRST_REP_AND_SYNC_GATE, [])],
]

describe('analysis-v1 taxonomy (8F-1A §6)', () => {
  it('has exactly the 32 frozen reportable entries', () => {
    expect(REPORT_ISSUE_TAXONOMY).toHaveLength(32)
    const ids = REPORT_ISSUE_TAXONOMY.map((item) => item.canonicalId)
    expect(new Set(ids).size).toBe(32)
    expect(ids).toEqual(expect.arrayContaining([
      'knee_raise.return_to_center', 'step_jack.limb_sync', 'step_jack.arm_symmetry',
      'overhead_raise.elbow_extension.left', 'overhead_raise.elbow_extension.right',
      'lateral_raise.arm_height.left', 'lateral_raise.arm_height.right', 'knee_raise.knee_height.left', 'knee_raise.knee_height.right',
    ]))
    expect(REPORT_ISSUE_TAXONOMY.every((item) => item.reportable && item.trendable)).toBe(true)
  })

  it('keeps the frozen ReportIssueDefinition schema', () => {
    const keys = ['bodyRegion', 'canonicalId', 'cue', 'dimension', 'evidenceSource', 'exerciseId', 'groupId', 'reportLabel', 'reportable',
      'runtimeCodes', 'side', 'sideModel', 'technicalPriorityWeight', 'themeId', 'trendable'].sort()
    for (const item of REPORT_ISSUE_TAXONOMY) {
      expect(Object.keys(item).sort()).toEqual(keys)
      expect(item.groupId).toBe(item.side ? item.canonicalId.replace(/\.(left|right)$/, '') : item.canonicalId)
      expect(item.sideModel === 'SIDE_SPECIFIC').toBe(item.side !== null)
    }
    expect(REPORT_ISSUE_TAXONOMY.find((item) => item.canonicalId === 'step_jack.step_width')?.sideModel).toBe('REP_SIDE_BREAKDOWN')
  })

  it('splits ARM_LEG_UNSYNCED into limb_sync and arm_symmetry instead of one report issue', () => {
    const entries = REPORT_ISSUE_TAXONOMY.filter((item) => item.runtimeCodes.includes('ARM_LEG_UNSYNCED'))
    expect(entries.map((item) => item.canonicalId).sort()).toEqual(['step_jack.arm_symmetry', 'step_jack.limb_sync'])
    expect(entries.find((item) => item.canonicalId === 'step_jack.limb_sync')).toMatchObject({ technicalPriorityWeight: 1, dimension: 'COORDINATION', evidenceSource: 'derived', themeId: null })
    expect(entries.find((item) => item.canonicalId === 'step_jack.arm_symmetry')).toMatchObject({ technicalPriorityWeight: 2, themeId: 'ARM_SYMMETRY' })
  })

  it('uses the frozen 1/2/3 technical priority weights', () => {
    const byWeight = (weight: number) => REPORT_ISSUE_TAXONOMY.filter((item) => item.technicalPriorityWeight === weight).map((item) => item.canonicalId).sort()
    expect(byWeight(3)).toEqual(['squat.knee_alignment', 'squat.torso_lean'])
    expect(byWeight(1)).toEqual([
      'knee_raise.alternation', 'knee_raise.return_to_center', 'knee_raise.too_fast', 'lateral_raise.too_fast', 'overhead_raise.too_fast',
      'squat.too_fast', 'step_jack.alternation', 'step_jack.limb_sync', 'step_jack.too_fast',
    ])
    expect(byWeight(2)).toHaveLength(32 - 2 - 9)
    expect(new Set(REPORT_ISSUE_TAXONOMY.map((item) => item.technicalPriorityWeight))).toEqual(new Set([1, 2, 3]))
  })

  it('assigns alternation and return-to-center to FORM and uses only the frozen theme ids', () => {
    for (const id of ['step_jack.alternation', 'knee_raise.alternation', 'knee_raise.return_to_center', 'squat.knee_alignment']) {
      expect(REPORT_ISSUE_TAXONOMY.find((item) => item.canonicalId === id)?.dimension).toBe('FORM')
    }
    const themes = new Set(REPORT_ISSUE_TAXONOMY.map((item) => item.themeId))
    expect([...themes].every((item) => item === null || ['TORSO_STABILITY', 'ELBOW_EXTENSION', 'ARM_SYMMETRY', 'TEMPO_TOO_FAST', 'ALTERNATION'].includes(item))).toBe(true)
  })

  it('accounts for every runtime code and never whitelists pose-quality or guidance codes', () => {
    const all: MotionErrorCode[] = ['ARM_TOO_LOW_L', 'ARM_TOO_LOW_R', 'ELBOW_TOO_BENT_L', 'ELBOW_TOO_BENT_R', 'ASYMMETRY', 'TORSO_LEAN', 'TOO_FAST',
      'INCOMPLETE_REP', 'POSE_LOW_CONFIDENCE', 'BODY_OUT_OF_FRAME', 'STEP_TOO_SMALL', 'ARM_TOO_LOW', 'ARM_LEG_UNSYNCED', 'WRONG_SIDE_SEQUENCE',
      'BODY_SWAY', 'INCOMPLETE_RETURN', 'DEPTH_INSUFFICIENT', 'KNEE_VALGUS', 'LEFT_RIGHT_ASYMMETRY', 'TORSO_LATERAL_LEAN', 'KNEE_TOO_LOW_L',
      'KNEE_TOO_LOW_R', 'LEFT_RIGHT_HEIGHT_GAP', 'MOTION_TOO_SMALL', 'ARMS_UNSYNCED', 'MOTION_PAUSED', 'ARMS_TOO_LOW']
    const covered = new Set<string>([
      ...REPORT_ISSUE_TAXONOMY.flatMap((item) => item.runtimeCodes),
      ...NON_REPORTABLE_ISSUES.flatMap((item) => item.runtimeCodes),
      ...ANALYSIS_CONFIG_V1.poseQualityCodes,
    ])
    expect(all.filter((code) => !covered.has(code))).toEqual([])
    const reportable = REPORT_ISSUE_TAXONOMY.flatMap((item) => item.runtimeCodes)
    expect(reportable).not.toContain('BODY_OUT_OF_FRAME')
    expect(reportable).not.toContain('POSE_LOW_CONFIDENCE')
    expect(REPORT_ISSUE_TAXONOMY.some((item) => (item.exerciseId as string) === 'shoulder_rotation')).toBe(false)
    expect(NON_REPORTABLE_ISSUES.every((item) => !item.reportable && !item.trendable)).toBe(true)
  })
})

describe('analysis-v1 significance and trends (8F-1A §11-§13)', () => {
  it('uses integer significance thresholds', () => {
    expect(isSignificant(R(1, 6))).toBe(false)
    expect(isSignificant(R(2, 6))).toBe(true)
    expect(isSignificant(R(2, 5))).toBe(true)
    expect(isSignificant(R(2, 7))).toBe(false)
    expect(isSignificant(R(3, 12))).toBe(false)
    expect(isSignificant(R(4, 12))).toBe(true)
    expect(isSignificant(R(3, 3))).toBe(false)
    expect(significanceOf(R(3, 3))).toBe('INSUFFICIENT_EVIDENCE')
    expect(significanceOf(null)).toBe('INSUFFICIENT_EVIDENCE')
  })

  it.each([
    [R(2, 6), R(1, 6), null],
    [R(3, 6), R(1, 6), 'IMPROVED'],
    [R(4, 6), R(3, 6), 'PERSISTENT'],
    [R(3, 6), R(0, 6), 'RESOLVED'],
    [R(2, 6), R(0, 3), 'INSUFFICIENT_DATA'],
    [R(0, 6), R(2, 6), 'NEW'],
    [R(1, 6), R(2, 6), 'PERSISTENT'],
    [R(1, 6), R(3, 6), 'WORSENED'],
    [R(6, 12), R(4, 12), 'PERSISTENT'],
    [R(3, 12), R(0, 12), null],
    [R(0, 12), R(3, 12), null],
    [R(2, 7), R(0, 7), null],
    [R(0, 4), R(0, 3), null],
  ] as const)('%o → %o is %s', (previous, current, expected) => {
    expect(issueTrend(previous, current)).toBe(expected)
  })

  it('applies inclusive deadbands on integer scores', () => {
    expect(scoreTrend(83, 82, 5)).toBe('STABLE')
    expect(scoreTrend(85, 80, 5)).toBe('IMPROVED')
    expect(scoreTrend(76, 80, 5)).toBe('STABLE')
    expect(scoreTrend(75, 80, 5)).toBe('DECLINED')
    expect(scoreTrend(82, 80, 3)).toBe('STABLE')
    expect(scoreTrend(77, 80, 3)).toBe('DECLINED')
  })
})

describe('analysis-v1 next-focus target math (8F-1E)', () => {
  it('keeps the exact IMPROVED/RESOLVED calculation and applies the easier compliant boundary', () => {
    expect(6 - maxAffectedForImprovement(4, 6, 6)).toBe(4)
    expect(12 - maxAffectedForImprovement(6, 12, 12)).toBe(9)
    expect(6 - maxAffectedForCompliantTarget(2, 6, 6)).toBe(5)
    expect(5 - maxAffectedForCompliantTarget(2, 5, 5)).toBe(4)
    expect(12 - maxAffectedForCompliantTarget(4, 12, 12)).toBe(9)
    expect(6 - maxAffectedForCompliantTarget(4, 6, 6)).toBe(4)
    expect(12 - maxAffectedForCompliantTarget(6, 12, 12)).toBe(9)
    expect(maxAffectedWithoutSignificance(5)).toBe(1)
    expect(maxAffectedWithoutSignificance(6)).toBe(1)
    expect(maxAffectedWithoutSignificance(12)).toBe(3)
    expect(plannedUnits('lateral_raise.arm_height.left')).toBe(6)
    expect(plannedUnits('step_jack.step_width')).toBe(12)
    expect(plannedUnits('step_jack.alternation')).toBe(11)
    expect(plannedUnits('knee_raise.knee_height.left')).toBe(5)
    expect(plannedUnits('knee_raise.alternation')).toBe(9)
    expect(plannedUnits('knee_raise.height_gap')).toBe(5)
    expect(plannedUnits('knee_raise.return_to_center')).toBe(10)
  })

  it('reaching the target exactly is judged IMPROVED (or RESOLVED) next time; one more affected is not', () => {
    for (let n = 4; n <= 12; n += 1) {
      for (let a = 2; a <= n; a += 1) {
        if (!isSignificant(R(a, n))) continue
        for (const planned of [5, 6, 9, 10, 11, 12]) {
          const maxAffected = maxAffectedForImprovement(a, n, planned)
          expect(['IMPROVED', 'RESOLVED']).toContain(issueTrend(R(a, n), R(maxAffected, planned)))
          if (maxAffected + 1 <= planned) expect(['IMPROVED', 'RESOLVED']).not.toContain(issueTrend(R(a, n), R(maxAffected + 1, planned)))
        }
      }
    }
  })
})

describe('analysis-v1 golden fixtures (8F-1A §26)', () => {
  it('1 FIRST_SESSION: no comparison, recomputed overall, lateral left arm is the priority with a 4-of-6 target', () => {
    const result = analyzeTraining(FIRST_SESSION, [])
    expect(result.analysisVersion).toBe(ANALYSIS_VERSION)
    expect(result.comparison).toMatchObject({ level: 'NONE', reason: 'NO_PREVIOUS_SESSION', commonExerciseIds: [], overallDeltaAllowed: false })
    const scores = result.exercises.map((item) => item.score as number)
    expect(result.overall).toMatchObject({ scope: 'FULL_COURSE', score: Math.round(scores.reduce((sum, value) => sum + value, 0) / 5), trend: null, delta: null })
    expect(result.overall.score).not.toBe(FIRST_SESSION.courseOverallScore)
    expect(result.priorityIssues[0]).toMatchObject({ kind: 'ISSUE', id: 'lateral_raise.arm_height.left', members: [{ stats: R(4, 6) }] })
    expect(result.nextFocus[0].target).toMatchObject({ compliantAtLeast: 4, outOf: 6, unit: '次' })
    expect(result.nextFocus[0].text).toBe('侧平举：把左臂抬到与肩同高。下次目标：6 次中至少 4 次做到。')
    expect(result.exercises.flatMap((item) => item.issues).every((item) => item.comparison === null)).toBe(true)
    expect(result.strengths.some((item) => item.kind.startsWith('HISTORICAL'))).toBe(false)
    expect(result.improvements).toEqual([])
  })

  it('2 FULL_IMPROVEMENT: IMPROVED and RESOLVED issues, overall IMPROVED, historical strength and improvement sentence', () => {
    const result = analyzeTraining(FULL_IMPROVEMENT.current, FULL_IMPROVEMENT.history)
    expect(result.comparison).toMatchObject({ level: 'FULL', reason: null, overallDeltaAllowed: true })
    expect(issue(result, 'lateral_raise.arm_height.left').comparison?.trend).toBe('IMPROVED')
    expect(issue(result, 'squat.depth').comparison?.trend).toBe('RESOLVED')
    expect(result.overall.trend).toBe('IMPROVED')
    expect(result.overall.delta).toBeGreaterThanOrEqual(3)
    expect(exercise(result, 'lateral_raise').scoreTrend).toBe('IMPROVED')
    const stable = result.exercises.filter((item) => (item.scoreDelta ?? 0) > 0 && (item.scoreDelta ?? 0) < 5)
    expect(stable.length).toBeGreaterThan(0)
    expect(stable.every((item) => item.scoreTrend === 'STABLE')).toBe(true)
    expect(result.strengths[0].kind).toBe('HISTORICAL_RESOLVED')
    expect(result.summary[0].text).toContain(`比上次提高 ${result.overall.delta} 分`)
    expect(result.summary.find((item) => item.slot === 'IMPROVEMENT')?.text).toContain('本次未再出现')
  })

  it('3 FULL_REGRESSION: WORSENED ranks first, overall DECLINED is stated, small drop stays STABLE', () => {
    const result = analyzeTraining(FULL_REGRESSION.current, FULL_REGRESSION.history)
    expect(issue(result, 'overhead_raise.arm_height').comparison?.trend).toBe('WORSENED')
    expect(issue(result, 'squat.knee_alignment').comparison?.trend).toBe('NEW')
    expect(result.priorityIssues[0].id).toBe('overhead_raise.arm_height')
    expect(result.priorityIssues[0].priority).toBeCloseTo(2 * (4 / 6) * 1.5, 6)
    expect(result.priorityIssues[1].id).toBe('squat.knee_alignment')
    expect(result.overall.trend).toBe('DECLINED')
    expect(result.summary[0].text).toBe(`本次完成全部 6 个动作，综合评分 ${result.overall.score} 分，比上次降低 ${Math.abs(result.overall.delta as number)} 分。`)
    expect(result.summary.some((item) => item.slot === 'PRIORITY' && item.text.includes('双臂上举'))).toBe(true)
    expect(exercise(result, 'knee_raise')).toMatchObject({ scoreDelta: -3, scoreTrend: 'STABLE' })
    expect(result.strengths.some((item) => item.exerciseIds.includes('overhead_raise') || item.exerciseIds.includes('squat'))).toBe(false)
  })

  it('4 PERSISTENT_ISSUE: PERSISTENT (×1.25) and IMPROVED-but-significant (×0.75) ranked by the formula', () => {
    const result = analyzeTraining(PERSISTENT_ISSUE.current, PERSISTENT_ISSUE.history)
    const depth = issue(result, 'squat.depth')
    const arm = issue(result, 'lateral_raise.arm_height.left')
    expect(depth).toMatchObject({ significance: 'SIGNIFICANT', comparison: { trend: 'PERSISTENT', previous: R(4, 6) } })
    expect(depth.technicalPriority).toBeCloseTo(2 * 0.5 * 1.25, 6)
    expect(arm).toMatchObject({ significance: 'SIGNIFICANT', comparison: { trend: 'IMPROVED', previous: R(4, 6) } })
    expect(arm.technicalPriority).toBeCloseTo(2 * (2 / 6) * 0.75, 6)
    expect(result.priorityIssues.map((item) => item.id)).toEqual(['squat.depth', 'lateral_raise.arm_height.left'])
  })

  it('5 RESOLVED_ISSUE: RESOLVED, RESOLVED (0/5) and INSUFFICIENT_DATA (0/3); resolved issues never enter priority', () => {
    const result = analyzeTraining(RESOLVED_ISSUE.current, RESOLVED_ISSUE.history)
    expect(issue(result, 'squat.depth').comparison).toMatchObject({ trend: 'RESOLVED', previous: R(3, 6) })
    expect(issue(result, 'knee_raise.knee_height.left')).toMatchObject({ stats: R(0, 5), comparison: { trend: 'RESOLVED', previous: R(2, 5) } })
    expect(issue(result, 'overhead_raise.elbow_extension.left')).toMatchObject({ stats: R(0, 3), missingEvidenceReps: 3, comparison: { trend: 'INSUFFICIENT_DATA', previous: R(2, 6) } })
    expect(result.priorityIssues).toEqual([])
    expect(result.strengths[0].kind).toBe('HISTORICAL_RESOLVED')
    expect(result.summary.find((item) => item.slot === 'IMPROVEMENT')?.text).toBe('徒手深蹲：下蹲深度不足，上次 6 次中 3 次，本次未再出现。')
    expect(result.dataQuality.comparisonLimitations).toContain('ISSUE_PREVIOUS_INSUFFICIENT')
  })

  it('6 NEW_ISSUE: NEW, WORSENED, PERSISTENT and null', () => {
    const result = analyzeTraining(NEW_ISSUE.current, NEW_ISSUE.history)
    expect(issue(result, 'squat.depth').comparison).toMatchObject({ trend: 'NEW', previous: R(0, 6) })
    expect(issue(result, 'overhead_raise.arm_height').comparison).toMatchObject({ trend: 'WORSENED', previous: R(1, 6) })
    expect(issue(result, 'lateral_raise.torso_lean').comparison).toMatchObject({ trend: 'PERSISTENT', previous: R(1, 6) })
    expect(issue(result, 'squat.lateral_balance')).toMatchObject({ stats: R(1, 6), comparison: { trend: null, previous: R(2, 6), countDelta: -1 } })
  })

  it('7 PARTIAL_SESSION: PARTIAL over completed common exercises only, no overall delta, capability on the common scope', () => {
    const result = analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history)
    expect(result.comparison).toMatchObject({
      level: 'PARTIAL', reason: 'CURRENT_NOT_FULL_SCOPE', overallDeltaAllowed: false,
      commonExerciseIds: ['overhead_raise', 'lateral_raise', 'step_jack'],
    })
    expect(result.comparison.reasonText).toBe('本次有动作未完成或有效次数不足，仅比较双方都完成的 3 个动作，不比较综合评分。')
    expect(result.overall).toMatchObject({ scope: 'COMPLETED_EXERCISES', previousScore: null, delta: null, trend: null })
    expect(exercise(result, 'squat')).toMatchObject({ completion: { status: 'incomplete', progress: 3 }, previousScore: null, scoreDelta: null })
    for (const item of result.capability.dimensions) {
      expect(item.comparison?.commonExerciseIds).toEqual(['overhead_raise', 'lateral_raise', 'step_jack'])
    }
    expect(result.dataQuality.comparisonLimitations).toEqual(expect.arrayContaining(['NO_OVERALL_DELTA_PARTIAL', 'EXERCISE_NOT_COMMON']))
    expect(result.summary.map((item) => item.text).join('')).not.toContain('比上次')

    const one = analyzeTraining(PARTIAL_SESSION.oneCommon, PARTIAL_SESSION.history)
    expect(one.comparison).toMatchObject({ level: 'NONE', reason: 'INSUFFICIENT_COMMON_EXERCISES' })
  })

  it('8 INVALID_REPS: invalid reps never count as 0, denominators exclude them, 4 invalid removes the score', () => {
    const result = analyzeTraining(INVALID_REPS, [])
    const overhead = exercise(result, 'overhead_raise')
    expect(overhead.reps).toEqual({ recorded: 6, valid: 3, partial: 0, invalid: 3, analyzed: 3 })
    const record = INVALID_REPS.exercises.find((item) => item.exerciseId === 'overhead_raise')!
    const validScores = [0, 2, 4].map((index) => record.repetitions[index].score)
    expect(overhead.score).toBe(Math.round(validScores.reduce((sum, value) => sum + value, 0) / 3))
    expect(overhead.score).not.toBe(record.overallScore)
    expect(issue(result, 'overhead_raise.arm_symmetry')).toMatchObject({ stats: R(2, 3), significance: 'INSUFFICIENT_EVIDENCE' })
    expect(overhead.takeaway).toBe('有效识别次数不足（3 次），本动作暂不分析问题。')
    expect(result.dataQuality.poseQuality).toMatchObject({ outOfFramePrompts: 0, lowConfidencePrompts: 0, outOfFrameInvalidReps: 1, lowConfidenceInvalidReps: 1 })

    const four = analyzeTraining(INVALID_REPS_FOUR, [])
    expect(exercise(four, 'overhead_raise').score).toBeNull()
    expect(four.overall.scope).not.toBe('FULL_COURSE')
    expect(four.overall.score).toBeNull()
    expect(four.summary[0].text).toBe('本次完成全部 6 个动作，部分动作有效识别次数不足，暂不给出综合评分。')
  })

  it('9 POSE_QUALITY_ONLY: pose prompts only reach dataQuality', () => {
    const result = analyzeTraining(POSE_QUALITY_ONLY, [])
    expect(result.priorityIssues).toEqual([])
    expect(result.nextFocus).toEqual([])
    expect(result.exercises.flatMap((item) => item.issues).every((item) => (item.stats?.affected ?? 0) === 0)).toBe(true)
    expect(result.dataQuality.poseQuality).toMatchObject({ outOfFramePrompts: 7, lowConfidencePrompts: 3, outOfFrameInvalidReps: 0, lowConfidenceInvalidReps: 0, environmentHint: 'FRAMING' })
    expect(result.dataQuality.poseQuality.byExercise.find((item) => item.exerciseId === 'shoulder_rotation')).toMatchObject({ outOfFramePrompts: 3, lowConfidencePrompts: 1 })
    expect(result.dataQuality.reps.invalid).toBe(0)
    expect(result.summary.find((item) => item.slot === 'NO_PRIORITY')?.text).toBe('本次没有需要优先纠正的问题。')
  })

  it('10 LEGACY_SESSION: never comparable, elbow never inferred from minElbow, FORM null for overhead', () => {
    const asCurrent = analyzeTraining(LEGACY_SESSION, [OLDER()])
    expect(asCurrent.comparison).toMatchObject({ level: 'NONE', reason: 'CURRENT_RULES_UNVERSIONED' })
    expect(asCurrent.comparison.excluded).toEqual([])
    expect(asCurrent.mode).toBe('unknown')
    expect(asCurrent.rulesVersion).toBeNull()
    for (const side of ['left', 'right']) {
      expect(issue(asCurrent, `overhead_raise.elbow_extension.${side}`)).toMatchObject({ stats: null, missingEvidenceReps: 6, significance: 'INSUFFICIENT_EVIDENCE' })
    }
    expect(exercise(asCurrent, 'overhead_raise').capabilityContribution.FORM).toMatchObject({ value: null, unavailableReason: 'EVIDENCE_MISSING' })
    expect(asCurrent.dataQuality.missingEvidence.every((item) => item.reason === 'LEGACY_SESSION_NO_TOP_ELBOW')).toBe(true)
    expect(asCurrent.dataQuality.sessionFlags).toEqual(expect.arrayContaining(['LEGACY_RULES_UNVERSIONED', 'MODE_UNKNOWN']))
    expect(asCurrent.summary.find((item) => item.slot === 'NO_PRIORITY')).toBeUndefined()
    expect(asCurrent.summary.find((item) => item.slot === 'LIMITED_DATA')?.text).toBe('双臂上举：缺少可判断的手肘伸展数据，当前证据不足。')

    const asPrevious = analyzeTraining(FIRST_SESSION, [{ ...LEGACY_SESSION, startedAt: at(0) }])
    expect(asPrevious.comparison).toMatchObject({ level: 'NONE', reason: 'NO_ELIGIBLE_PREVIOUS' })
    expect(asPrevious.comparison.excluded[0].reasons).toEqual(expect.arrayContaining(['RULES_UNVERSIONED', 'MODE_UNKNOWN']))

    expect(analyzeTraining(LEGACY_FAST_SUSPECTED, []).dataQuality.sessionFlags).toContain('LEGACY_FAST_SUSPECTED')
    expect(analyzeTraining(LEGACY_SESSION, []).dataQuality.sessionFlags).not.toContain('LEGACY_FAST_SUSPECTED')
  })

  it('11 FAST_SESSION: one rep per exercise, never comparable, every exercise incomplete, no significant issue', () => {
    const asCurrent = analyzeTraining(FAST_SESSION, [OLDER()])
    expect(asCurrent.comparison).toMatchObject({ level: 'NONE', reason: 'CURRENT_FAST_MODE' })
    expect(asCurrent.exercises.every((item) => item.completion.status === 'incomplete')).toBe(true)
    expect(asCurrent.exercises.flatMap((item) => item.issues).some((item) => item.significance === 'SIGNIFICANT')).toBe(false)
    expect(asCurrent.overall.scope).toBe('UNAVAILABLE')
    expect(asCurrent.summary.map((item) => item.slot)).toEqual(['OVERALL', 'LIMITED_DATA'])
    const asPrevious = analyzeTraining(makeSession({ id: 'later', startedAt: at(5) }), [FAST_SESSION])
    expect(asPrevious.comparison.excluded).toEqual([{ sessionId: 'fast', reasons: ['FAST_MODE'] }])
  })

  it('12 MISSING_TOP_ELBOW: partial reps keep the score but never fall back to minElbow', () => {
    const result = analyzeTraining(MISSING_TOP_ELBOW, [])
    const overhead = exercise(result, 'overhead_raise')
    expect(overhead.reps).toMatchObject({ valid: 3, partial: 3, invalid: 0, analyzed: 6 })
    expect(overhead.score).not.toBeNull()
    for (const side of ['left', 'right']) {
      expect(issue(result, `overhead_raise.elbow_extension.${side}`)).toMatchObject({ stats: R(3, 3), missingEvidenceReps: 3, significance: 'INSUFFICIENT_EVIDENCE' })
    }
    expect(result.dataQuality.missingEvidence).toEqual([
      { exerciseId: 'overhead_raise', canonicalId: 'overhead_raise.elbow_extension.left', reps: 3, reason: 'TOP_ELBOW_NOT_CAPTURED' },
      { exerciseId: 'overhead_raise', canonicalId: 'overhead_raise.elbow_extension.right', reps: 3, reason: 'TOP_ELBOW_NOT_CAPTURED' },
    ])
    expect(overhead.capabilityContribution.FORM).toEqual({ value: null, evaluableReps: 3, unavailableReason: 'INSUFFICIENT_EVALUABLE_REPS' })
    expect(overhead.takeaway).toBe('手肘伸展仅有 3 次可判断，当前证据不足。')
    expect(result.summary.find((item) => item.slot === 'NO_PRIORITY')).toBeUndefined()
    expect(result.summary.find((item) => item.slot === 'LIMITED_DATA')?.text).toBe('双臂上举：手肘伸展仅有 3 次可判断，当前证据不足。')

    const topOk = analyzeTraining(LOW_MIN_ELBOW_TOP_OK, [])
    expect(issue(topOk, 'overhead_raise.elbow_extension.left').stats).toEqual(R(0, 6))
    expect(issue(topOk, 'overhead_raise.elbow_extension.right').stats).toEqual(R(0, 6))
  })

  it('FORM requires 4 evaluable units while continuous capability items still require 3', () => {
    const three = analyzeTraining(makeSession({
      id: 'form-three', startedAt: at(2),
      exercises: { lateral_raise: { poseInvalid: { 3: 'BODY_OUT_OF_FRAME', 4: 'BODY_OUT_OF_FRAME', 5: 'BODY_OUT_OF_FRAME' } } },
    }), [])
    expect(exercise(three, 'lateral_raise').capabilityContribution.FORM)
      .toEqual({ value: null, evaluableReps: 3, unavailableReason: 'INSUFFICIENT_EVALUABLE_REPS' })
    expect(exercise(three, 'lateral_raise').capabilityContribution.AMPLITUDE.value).not.toBeNull()

    const four = analyzeTraining(makeSession({
      id: 'form-four', startedAt: at(3),
      exercises: { lateral_raise: { poseInvalid: { 4: 'BODY_OUT_OF_FRAME', 5: 'BODY_OUT_OF_FRAME' } } },
    }), [])
    expect(exercise(four, 'lateral_raise').capabilityContribution.FORM)
      .toEqual({ value: 100, evaluableReps: 4, unavailableReason: null })
  })
})

describe('analysis-v1 supplementary fixtures', () => {
  it('step jack: first recorded rep never counts for alternation; sync is only evaluable past both thresholds', () => {
    const result = analyzeTraining(STEP_JACK_FIRST_REP_AND_SYNC_GATE, [])
    expect(issue(result, 'step_jack.alternation').stats).toEqual(R(0, 11))
    expect(issue(result, 'step_jack.limb_sync').stats).toEqual(R(0, 6))
    expect(issue(result, 'step_jack.arm_height').stats).toEqual(R(6, 12))
    expect(exercise(result, 'step_jack').capabilityContribution.COORDINATION.evaluableReps).toBe(6)
    expect(issue(result, 'step_jack.step_width').sideBreakdown).toEqual({ left: R(0, 6), right: R(0, 6) })
  })

  it('knee raise: non-overlapping left/right pairs counted in 组', () => {
    const record = KNEE_RAISE_PAIRING.exercises.find((item) => item.exerciseId === 'knee_raise')!
    const analyzed = record.repetitions.map((result, index) => ({ index, result, validity: 'VALID' as const }))
    expect(kneeRaisePairs(analyzed).map(([left, right]) => [left.index, right.index])).toEqual([[0, 1], [3, 4], [5, 6], [7, 8]])
    const result = analyzeTraining(KNEE_RAISE_PAIRING, [])
    expect(issue(result, 'knee_raise.height_gap')).toMatchObject({ stats: R(0, 4), unit: '组' })
    expect(issue(result, 'knee_raise.alternation').stats).toEqual(R(2, 9))
  })

  it('theme merge: one cross-exercise torso entry, members keep their own ratios; both elbows merge bilaterally', () => {
    const result = analyzeTraining(THEME_MERGE_AND_CAPS, [])
    const theme = result.priorityIssues.find((item) => item.kind === 'THEME')!
    expect(theme).toMatchObject({ id: 'theme:TORSO_STABILITY', exerciseIds: ['lateral_raise', 'step_jack', 'squat'] })
    expect(theme.members.map((item) => [item.canonicalId, item.stats])).toEqual([
      ['lateral_raise.torso_lean', R(4, 6)], ['step_jack.body_sway', R(5, 12)], ['squat.torso_lean', R(4, 6)],
    ])
    expect(result.priorityIssues.filter((item) => item.reportLabel.includes('侧倾'))).toHaveLength(1)
    const pair = result.priorityIssues.find((item) => item.kind === 'SIDE_PAIR')!
    expect(pair).toMatchObject({ id: 'overhead_raise.elbow_extension', reportLabel: '举到顶部时左右肘均未伸直', cue: '举到头顶时把两侧手肘都伸直', bodyRegion: 'both_arms' })
    expect(pair.members.map((item) => item.stats)).toEqual([R(4, 6), R(4, 6)])
    expect(pair.text).not.toMatch(/8\/12|12 次中 8 次/)
    expect(pair.cue).not.toMatch(/左肘|右肘|左臂|右臂/)
  })

  it('demo and standalone sessions are never compared', () => {
    expect(analyzeTraining(DEMO_SESSION, [OLDER()]).comparison.reason).toBe('CURRENT_NOT_LIVE')
    expect(analyzeTraining(STANDALONE_SESSION, [OLDER()]).comparison.reason).toBe('CURRENT_NOT_COURSE_FLOW')
    const withDemoPrevious = analyzeTraining(makeSession({ id: 'now', startedAt: at(4) }), [DEMO_SESSION, STANDALONE_SESSION])
    expect(withDemoPrevious.comparison.reason).toBe('NO_ELIGIBLE_PREVIOUS')
    expect(withDemoPrevious.comparison.excluded).toEqual([
      { sessionId: 'standalone', reasons: ['NOT_COURSE_FLOW'] },
      { sessionId: 'demo', reasons: ['NOT_LIVE'] },
    ])
  })

  it('is deterministic, does not mutate inputs, ignores history order and breaks startedAt ties by id (descending)', () => {
    const before = JSON.stringify([DETERMINISM.current, DETERMINISM.history])
    const first = analyzeTraining(DETERMINISM.current, DETERMINISM.history)
    const second = analyzeTraining(DETERMINISM.current, [...DETERMINISM.history].reverse())
    expect(second).toEqual(first)
    expect(JSON.stringify([DETERMINISM.current, DETERMINISM.history])).toBe(before)
    expect(first.comparison.previousSessionId).toBe('det-b')
  })
})

describe('analysis-v1 output hygiene', () => {
  it.each(ALL_FIXTURE_RUNS)('%s: no engineering terms, absolute claims or banned coaching phrases in user text', (_name, run) => {
    const text = userText(run()).join('\n')
    for (const banned of ['重算总分', '显著性', '提升阈值', '同等可评估样本', 'analysis-v1', 'TOP', '标准', '完美', '做得非常好', '继续努力', '保持状态',
      '加强训练', '多加练习', '风险', '受伤', 'canonical', 'BODY_OUT_OF_FRAME', 'POSE_LOW_CONFIDENCE', '节奏稳定', 'undefined', 'null', 'NaN']) {
      expect(text).not.toContain(banned)
    }
  })

  it.each(ALL_FIXTURE_RUNS)('%s: summary has 2–4 sentences, each with evidence refs; no optional keys', (_name, run) => {
    const result = run()
    expect(result.summary.length).toBeGreaterThanOrEqual(2)
    expect(result.summary.length).toBeLessThanOrEqual(4)
    expect(result.summary.every((item) => item.evidenceRefs.length > 0)).toBe(true)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(result.exercises.map((item) => item.exerciseId)).toEqual(['overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise'])
    expect(result.priorityIssues.length).toBeLessThanOrEqual(3)
    expect(result.strengths.length).toBeLessThanOrEqual(2)
    expect(result.nextFocus.length).toBeLessThanOrEqual(2)
  })

  it.each(ALL_FIXTURE_RUNS)('%s: never contradicts itself (no strength for an exercise or dimension with a significant issue)', (_name, run) => {
    const result = run()
    const significant = result.exercises.flatMap((item) => item.issues).filter((item) => item.significance === 'SIGNIFICANT')
    for (const strength of result.strengths) {
      if (strength.kind === 'EXERCISE_STRENGTH') expect(significant.some((item) => item.exerciseId === strength.exerciseIds[0])).toBe(false)
      if (strength.kind === 'CAPABILITY_STRENGTH') expect(significant.some((item) => item.dimension === strength.dimension)).toBe(false)
    }
  })

  it('never reports shoulder rotation as an issue, contributor or priority', () => {
    const session = makeSession({ id: 'guidance', startedAt: at(1), shoulderPrompts: { TORSO_LEAN: 4, MOTION_TOO_SMALL: 3 } })
    const result = analyzeTraining(session, [])
    expect(result.exercises.some((item) => (item.exerciseId as string) === 'shoulder_rotation')).toBe(false)
    expect(result.capability.dimensions.every((item) => item.contributors.every((entry) => (entry.exerciseId as string) !== 'shoulder_rotation'))).toBe(true)
    expect(issue(result, 'overhead_raise.torso_lean').reminderCount).toBe(0)
    expect(result.guidance).toEqual({ exerciseId: 'shoulder_rotation', status: 'completed', targetSeconds: 15, text: '热身引导完成' })
  })

  it('keeps dimension helpers consistent with the golden fixture', () => {
    const result = analyzeTraining(FIRST_SESSION, [])
    expect(dimension(result, 'FORM').value).toBe(100)
    expect(result.capability.radarAvailable).toBe(true)
  })
})
