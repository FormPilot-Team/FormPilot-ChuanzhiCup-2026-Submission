import { describe, expect, it } from 'vitest'
import { ANALYSIS_CONFIG_V1, REPORT_ISSUE_TAXONOMY, analyzeTraining, issueTrend, isSignificant } from '../src/features/analysis'
import type { IssueAnalysis, TrainingAnalysis } from '../src/features/analysis'
import type { TrainingSessionState } from '../src/features/training/types'
import { FIRST_SESSION, LEGACY_SESSION, PARTIAL_SESSION, THEME_MERGE_AND_CAPS, at, atIndexes, makeSession } from './analysis-fixtures'

/**
 * 8F-1C adversarial cases (A1–A20, B1–B12) turned into regressions. Each case was a wrong or misleading output of
 * the 8F-1B engine; the assertions pin the frozen 8F-1A behaviour instead.
 */
const R = (affected: number, evaluable: number) => ({ affected, evaluable })
const OLDER = () => makeSession({ id: 'older', startedAt: at(0) })

function issue(result: TrainingAnalysis, canonicalId: string): IssueAnalysis {
  const found = result.exercises.flatMap((item) => item.issues).find((item) => item.canonicalId === canonicalId)
  if (!found) throw new Error(`missing issue ${canonicalId}`)
  return found
}
const exercise = (result: TrainingAnalysis, id: string) => result.exercises.find((item) => item.exerciseId === id)!
const dimension = (result: TrainingAnalysis, id: string) => result.capability.dimensions.find((item) => item.dimension === id)!
const mean = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)

/**
 * Lower-scoring but issue-free raw values (every value stays below its issue threshold), used to move the overall
 * score across its deadband without creating issues.
 */
const WEAKER = {
  overhead_raise: { raw: () => ({ maxSymmetryDiff: 11, maxTorsoLean: 9 }) },
  lateral_raise: { raw: () => ({ maxTorsoLean: 9, maxSymmetryDiff: 13 }) },
  step_jack: { raw: () => ({ syncGapMs: 380, maxTorsoLean: 10 }) },
  squat: { raw: () => ({ maxTorsoLean: 9, maxKneeHeightDiff: 0.07 }) },
  knee_raise: { raw: () => ({ hipShiftMax: 0.17, maxTorsoLean: 9 }) },
}

function weakerSession(id: string, startedAt: number, extra: Parameters<typeof makeSession>[0]['exercises'] = {}): TrainingSessionState {
  return makeSession({ id, startedAt, exercises: { ...WEAKER, ...extra } })
}

describe('8F-1C adversarial regressions (A)', () => {
  it('A1 issue trends require significance on the relevant side', () => {
    expect(issueTrend(R(1, 6), R(2, 6))).toBe('PERSISTENT')
    expect(issueTrend(R(2, 7), R(0, 7))).toBeNull()
    expect(issueTrend(R(3, 12), R(0, 12))).toBeNull()
    expect(issueTrend(R(0, 12), R(3, 12))).toBeNull()
    expect(issueTrend(R(0, 4), R(0, 3))).toBeNull()
    expect([R(1, 6), R(2, 6), R(2, 5), R(3, 12), R(4, 12), R(3, 3)].map(isSignificant)).toEqual([false, true, true, false, true, false])
  })

  it('A2 step jack: arms never reach the threshold → sync fallback is not evidence (issue and COORDINATION)', () => {
    const session = makeSession({ id: 'a2', startedAt: at(2), exercises: { step_jack: { raw: () => ({ peakMeanShoulderAngle: 110 }) } } })
    const record = session.exercises.find((item) => item.exerciseId === 'step_jack')!
    expect(record.repetitions.every((item) => item.rep.exerciseId === 'step_jack' && item.rep.syncGapMs === item.rep.durationMs)).toBe(true)
    const result = analyzeTraining(session, [])
    expect(issue(result, 'step_jack.limb_sync')).toMatchObject({ stats: null, significance: 'INSUFFICIENT_EVIDENCE', technicalPriority: null })
    expect(result.priorityIssues.flatMap((item) => item.canonicalIds)).not.toContain('step_jack.limb_sync')
    expect(result.priorityIssues[0].id).toBe('step_jack.arm_height')
    expect(exercise(result, 'step_jack').capabilityContribution.COORDINATION).toMatchObject({ value: null, evaluableReps: 0, unavailableReason: 'INSUFFICIENT_EVALUABLE_REPS' })
    expect(dimension(result, 'COORDINATION').contributors.map((item) => item.exerciseId)).not.toContain('step_jack')
  })

  it('A3 a standalone (EXERCISE_ORDER) current session is never compared with a course session', () => {
    const standalone = makeSession({
      id: 'a3', startedAt: at(3), exerciseOrder: ['lateral_raise', 'step_jack', 'squat', 'knee_raise'],
      include: ['lateral_raise', 'step_jack', 'squat', 'knee_raise'], courseStatus: 'completed',
    })
    const result = analyzeTraining(standalone, [FIRST_SESSION])
    expect(result.comparison).toMatchObject({ level: 'NONE', reason: 'CURRENT_NOT_COURSE_FLOW', commonExerciseIds: [] })
    expect(result.exercises.every((item) => item.previousScore === null && item.issues.every((entry) => entry.comparison === null))).toBe(true)
  })

  it('A4 UNSUPPORTED rulesVersion: scores, completion and data quality only; no technical analysis at all', () => {
    const session = makeSession({
      id: 'a4', startedAt: at(2), rulesVersion: { spec: 'exercise-rules-v1.0', threshold: 'calibration-v1' },
      exercises: { squat: { raw: atIndexes([0, 2, 3, 5], { maxHipDrop: 0.22 }) } },
    })
    const result = analyzeTraining(session, [OLDER()])
    expect(result.dataQuality.rulesSupport).toBe('UNSUPPORTED')
    expect(result.dataQuality.sessionFlags).toContain('RULES_UNSUPPORTED')
    expect(result.comparison.reason).toBe('CURRENT_RULES_UNSUPPORTED')
    expect(result.overall.score).not.toBeNull()
    expect(result.exercises.every((item) => item.score !== null && item.completion.status === 'completed')).toBe(true)
    expect(result.exercises.every((item) => item.issues.length === 0 && item.sideBalance.length === 0)).toBe(true)
    expect(result.exercises.every((item) => item.takeaway === null && item.withinExerciseImprovement === null && item.tempo.direction === null)).toBe(true)
    expect(result.exercises.every((item) => Object.values(item.capabilityContribution).every((entry) => entry.value === null && entry.unavailableReason === 'RULES_UNSUPPORTED'))).toBe(true)
    expect(result.priorityIssues).toEqual([])
    expect(result.capability).toEqual({ available: false, unavailableReason: 'RULES_UNSUPPORTED', radarAvailable: false, dimensions: [] })
    expect(result.strengths).toEqual([])
    expect(result.improvements).toEqual([])
    expect(result.nextFocus).toEqual([])
    expect(result.summary.map((item) => item.slot)).toEqual(['OVERALL', 'LIMITED_DATA'])
    expect(result.summary.map((item) => item.text).join('')).not.toContain('没有需要优先纠正')
  })

  it('A5 knee raise pairs never overlap: one low rep in 7 is 1 of 3 pairs, not a significant issue', () => {
    const session = makeSession({ id: 'a5', startedAt: at(2), exercises: { knee_raise: { reps: 7, raw: atIndexes([3], { peakKneeHeight: -0.3 }) } } })
    const result = analyzeTraining(session, [])
    expect(issue(result, 'knee_raise.height_gap')).toMatchObject({ stats: R(1, 3), unit: '组', significance: 'INSUFFICIENT_EVIDENCE' })
    expect(result.priorityIssues.flatMap((item) => item.canonicalIds)).not.toContain('knee_raise.height_gap')
  })

  it('A6 both sides significant → bilateral label, bilateral cue, separate member ratios', () => {
    const session = makeSession({ id: 'a6', startedAt: at(2), exercises: { lateral_raise: { raw: atIndexes([0, 2, 3, 5], { peakShoulderL: 72, peakShoulderR: 74, maxSymmetryDiff: 4 }) } } })
    const result = analyzeTraining(session, [])
    const pair = result.priorityIssues[0]
    expect(pair).toMatchObject({ kind: 'SIDE_PAIR', id: 'lateral_raise.arm_height', reportLabel: '左右臂抬高均不足', cue: '把两侧手臂都抬到与肩同高', bodyRegion: 'both_arms' })
    expect(pair.members.map((item) => [item.side, item.stats])).toEqual([['left', R(4, 6)], ['right', R(4, 6)]])
    expect(pair.text).toBe('侧平举，左右臂抬高均不足（左侧 6 次中 4 次，右侧 6 次中 4 次）')
    expect(result.nextFocus[0].text).toBe('侧平举：把两侧手臂都抬到与肩同高。下次目标：左右两侧各 6 次中至少 4 次做到。')
    expect(JSON.stringify(result.priorityIssues)).not.toMatch(/8\/12|12 次中 8 次/)
  })

  it('A7 different issues of one exercise are never theme-merged (step width and arm height stay separate)', () => {
    const session = makeSession({
      id: 'a7', startedAt: at(2),
      exercises: { step_jack: { raw: (index) => (index < 4 ? { peakOpenRatio: 1.4 } : index >= 6 && index < 10 ? { peakMeanShoulderAngle: 120 } : undefined) } },
    })
    const result = analyzeTraining(session, [])
    expect(result.priorityIssues.map((item) => [item.kind, item.id, item.members.map((member) => member.stats)])).toEqual([
      ['ISSUE', 'step_jack.arm_height', [R(4, 12)]],
      ['ISSUE', 'step_jack.step_width', [R(4, 12)]],
    ])
  })

  it('A8 contradiction guard: an exercise with a significant issue never becomes an exercise strength', () => {
    const session = makeSession({ id: 'a8', startedAt: at(2), exercises: { squat: { raw: atIndexes([0, 2, 3, 5], { maxHipDrop: 0.28 }) } } })
    const result = analyzeTraining(session, [])
    const squat = exercise(result, 'squat')
    expect(issue(result, 'squat.depth').significance).toBe('SIGNIFICANT')
    expect(squat.score).toBeGreaterThanOrEqual(85)
    expect(squat.consistency?.minRepScore).toBeGreaterThanOrEqual(75)
    expect(result.priorityIssues.some((item) => item.exerciseIds.includes('squat'))).toBe(true)
    expect(result.strengths.some((item) => item.exerciseIds.includes('squat'))).toBe(false)
  })

  it('A9 FORM uses only the frozen checks: squat depth 6/6 does not lower squat FORM', () => {
    const result = analyzeTraining(makeSession({ id: 'a9', startedAt: at(2), exercises: { squat: { raw: () => ({ maxHipDrop: 0.22 }) } } }), [])
    expect(issue(result, 'squat.depth').stats).toEqual(R(6, 6))
    expect(exercise(result, 'squat').capabilityContribution.FORM).toEqual({ value: 100, evaluableReps: 6, unavailableReason: null })
  })

  it('A10 non-finite raw fields (NaN → JSON null) make the rep INVALID instead of a false elbow issue', () => {
    const built = makeSession({ id: 'a10', startedAt: at(2) })
    built.exercises.find((item) => item.exerciseId === 'lateral_raise')!.repetitions.forEach((item, index) => {
      if (index < 3 && item.rep.exerciseId === 'lateral_raise') item.rep.minElbowL = Number.NaN
    })
    const persisted = JSON.parse(JSON.stringify(built)) as TrainingSessionState
    const lateral = persisted.exercises.find((item) => item.exerciseId === 'lateral_raise')!
    expect((lateral.repetitions[0].rep as unknown as Record<string, unknown>).minElbowL).toBeNull()
    for (const session of [built, persisted]) {
      const result = analyzeTraining(session, [])
      expect(exercise(result, 'lateral_raise').reps).toMatchObject({ valid: 3, invalid: 3 })
      expect(issue(result, 'lateral_raise.elbow_extension.left')).toMatchObject({ stats: R(0, 3), significance: 'INSUFFICIENT_EVIDENCE' })
    }
  })

  it('A11 an incomplete or unscorable current exercise is never a common (comparable) exercise', () => {
    const partial = analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history)
    expect(partial.comparison.commonExerciseIds).not.toContain('squat')
    expect(exercise(partial, 'squat')).toMatchObject({ score: expect.any(Number), previousScore: null, scoreDelta: null, scoreTrend: null })
    expect(issue(partial, 'squat.depth').comparison).toBeNull()

    const unscorable = makeSession({ id: 'a11', startedAt: at(2), exercises: { squat: { poseInvalid: { 0: 'BODY_OUT_OF_FRAME', 1: 'BODY_OUT_OF_FRAME', 2: 'BODY_OUT_OF_FRAME', 3: 'BODY_OUT_OF_FRAME' } } } })
    const result = analyzeTraining(unscorable, [FIRST_SESSION])
    expect(exercise(result, 'squat')).toMatchObject({ completion: { status: 'completed' }, score: null })
    expect(result.comparison).toMatchObject({ level: 'PARTIAL', reason: 'CURRENT_NOT_FULL_SCOPE' })
    expect(result.comparison.commonExerciseIds).toEqual(['overhead_raise', 'lateral_raise', 'step_jack', 'knee_raise'])
  })

  it('A12 frozen weights: squat knee alignment 4/6 (3 × 4/6) outranks overhead too-fast 6/6 (1 × 1)', () => {
    const session = makeSession({
      id: 'a12', startedAt: at(2),
      exercises: { squat: { raw: atIndexes([0, 2, 3, 5], { minKneeSpreadRatio: 0.6 }) }, overhead_raise: { raw: () => ({ durationMs: 1500 }) } },
    })
    const result = analyzeTraining(session, [])
    expect(result.priorityIssues.map((item) => [item.id, item.priority])).toEqual([
      ['squat.knee_alignment', 2],
      ['overhead_raise.too_fast', 1],
    ])
  })

  it('A13 overhead elbow is TOP-phase only: low minElbow never fills in for a missing or passing topElbow', () => {
    const passing = analyzeTraining(makeSession({ id: 'a13a', startedAt: at(2), exercises: { overhead_raise: { raw: () => ({ minElbowL: 90, minElbowR: 90, topElbowL: 150, topElbowR: 136 }) } } }), [])
    expect(issue(passing, 'overhead_raise.elbow_extension.left').stats).toEqual(R(0, 6))
    expect(issue(passing, 'overhead_raise.elbow_extension.right').stats).toEqual(R(0, 6))

    const missing = analyzeTraining(makeSession({ id: 'a13b', startedAt: at(2), exercises: { overhead_raise: { raw: () => ({ minElbowL: 90, minElbowR: 90, omitTopElbow: true }) } } }), [])
    expect(issue(missing, 'overhead_raise.elbow_extension.left')).toMatchObject({ stats: null, missingEvidenceReps: 6 })
    expect(exercise(missing, 'overhead_raise').score).not.toBeNull()
    expect(issue(missing, 'overhead_raise.arm_height').stats?.evaluable).toBe(6)

    const mixed = analyzeTraining(makeSession({
      id: 'a13c', startedAt: at(2),
      exercises: { overhead_raise: { raw: (index) => (index < 3 ? { omitTopElbow: true, minElbowL: 90 } : { topElbowL: 120 }) } },
    }), [])
    expect(issue(mixed, 'overhead_raise.elbow_extension.left')).toMatchObject({ stats: R(3, 3), significance: 'INSUFFICIENT_EVIDENCE', missingEvidenceReps: 3 })
  })

  it('A14 an improved overall score never swallows the priority sentence', () => {
    const depth = { raw: atIndexes([0, 2, 3, 5], { maxHipDrop: 0.22 }) }
    const result = analyzeTraining(
      makeSession({ id: 'a14', startedAt: at(2), exercises: { squat: depth } }),
      [weakerSession('a14-before', at(1), { squat: { raw: (index) => ({ maxTorsoLean: 9, ...([0, 2, 3, 5].includes(index) ? { maxHipDrop: 0.22 } : {}) }) } })],
    )
    expect(result.overall.trend).toBe('IMPROVED')
    expect(issue(result, 'squat.depth').comparison?.trend).toBe('PERSISTENT')
    const priority = result.summary.find((item) => item.slot === 'PRIORITY')
    expect(priority?.text).toBe('本次最需要关注：徒手深蹲，下蹲深度不足（6 次中 4 次）。')
    expect(result.summary[0].text).toContain('比上次提高')
  })

  it('A15 ineligible previous sessions are excluded with every reason', () => {
    const legacy = { ...LEGACY_SESSION, id: 'legacy-prev', startedAt: at(1) }
    const fast = makeSession({ id: 'fast-prev', startedAt: at(1.1), mode: 'fast' })
    const synthetic = makeSession({ id: 'synthetic-prev', startedAt: at(1.2), source: 'synthetic' })
    const unfinished = makeSession({ id: 'open-prev', startedAt: at(1.3), status: 'active' })
    const standalone = makeSession({ id: 'standalone-prev', startedAt: at(1.4), exerciseOrder: ['lateral_raise', 'step_jack', 'squat', 'knee_raise'] })
    const mismatch = makeSession({ id: 'calibration-prev', startedAt: at(1.5), rulesVersion: { spec: 'exercise-rules-v1.0', threshold: 'calibration-v1' } })
    const result = analyzeTraining(makeSession({ id: 'a15', startedAt: at(2) }), [legacy, fast, synthetic, unfinished, standalone, mismatch])
    expect(result.comparison).toMatchObject({ level: 'NONE', reason: 'NO_ELIGIBLE_PREVIOUS' })
    expect(Object.fromEntries(result.comparison.excluded.map((item) => [item.sessionId, item.reasons]))).toEqual({
      'calibration-prev': ['RULES_MISMATCH'],
      'standalone-prev': ['NOT_COURSE_FLOW'],
      'open-prev': ['NOT_FINALIZED'],
      'synthetic-prev': ['NOT_LIVE'],
      'fast-prev': ['FAST_MODE'],
      'legacy-prev': ['MODE_UNKNOWN', 'RULES_UNVERSIONED'],
    })
  })

  it('A16 tempo direction needs a real majority: [2s,2s,6s,6s,4s,4s] squat is null, not APPROPRIATE', () => {
    const durations = [2000, 2000, 6000, 6000, 4000, 4000]
    const result = analyzeTraining(makeSession({ id: 'a16', startedAt: at(2), exercises: { squat: { raw: (index) => ({ durationMs: durations[index] }) } } }), [])
    expect(exercise(result, 'squat').tempo).toEqual({ direction: null, fast: 2, slow: 2, inBand: 2, bandMs: [3000, 5000] })
  })

  it('A17 knee COORDINATION is pair height consistency only: can reach 0, and alternation stays in FORM', () => {
    const gap = analyzeTraining(makeSession({ id: 'a17', startedAt: at(2), exercises: { knee_raise: { raw: (index) => ({ peakKneeHeight: index % 2 === 0 ? 0 : -0.4 }) } } }), [])
    expect(exercise(gap, 'knee_raise').capabilityContribution.COORDINATION).toEqual({ value: 0, evaluableReps: 5, unavailableReason: null })
    expect(issue(gap, 'knee_raise.height_gap').stats).toEqual(R(5, 5))

    const sides = ['left', 'left', 'right', 'right', 'left', 'left', 'right', 'right', 'left', 'left'] as const
    const doubled = analyzeTraining(makeSession({
      id: 'a17b', startedAt: at(2),
      exercises: { knee_raise: { raw: (index) => ({ side: sides[index], wrongSideSequence: index > 0 && sides[index] === sides[index - 1] }) } },
    }), [])
    const knee = exercise(doubled, 'knee_raise')
    expect(knee.capabilityContribution.COORDINATION).toEqual({ value: 100, evaluableReps: 4, unavailableReason: null })
    expect(issue(doubled, 'knee_raise.alternation').stats).toEqual(R(5, 9))
    expect(knee.capabilityContribution.FORM.value).toBe(Math.round(100 * ((9 - 5) / 9 + 10 / 10) / 2))
  })

  it('A18 not-started / incomplete exercises report why they are unavailable; guidance is tracked separately', () => {
    const result = analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history)
    const knee = exercise(result, 'knee_raise')
    expect(knee.completion.status).toBe('not_started')
    expect(knee.takeaway).toBeNull()
    expect(Object.values(knee.capabilityContribution).every((item) => item.unavailableReason === 'EXERCISE_NOT_COMPLETED')).toBe(true)
    expect(Object.values(exercise(result, 'squat').capabilityContribution).every((item) => item.value === null && item.unavailableReason === 'EXERCISE_NOT_COMPLETED')).toBe(true)
    const noWarmup = analyzeTraining(makeSession({ id: 'a18', startedAt: at(2), include: ['overhead_raise', 'lateral_raise', 'step_jack', 'squat', 'knee_raise'], courseStatus: 'incomplete' }), [])
    expect(noWarmup.guidance).toMatchObject({ status: 'not_started', text: '热身引导未开始' })
    expect(noWarmup.dataQuality.guidance).toEqual({ exerciseId: 'shoulder_rotation', status: 'not_started', scored: false })
  })

  it('A19 taxonomy inventory matches the freeze', () => {
    expect(REPORT_ISSUE_TAXONOMY).toHaveLength(32)
    expect(REPORT_ISSUE_TAXONOMY.some((item) => item.canonicalId === 'knee_raise.return_to_center' && item.runtimeCodes.includes('INCOMPLETE_RETURN'))).toBe(true)
    expect(REPORT_ISSUE_TAXONOMY.filter((item) => item.runtimeCodes.includes('ARM_LEG_UNSYNCED'))).toHaveLength(2)
  })

  it('A20 within-session and pair texts name the exercise and the right unit', () => {
    const within = analyzeTraining(makeSession({ id: 'a20', startedAt: at(2), exercises: { overhead_raise: { raw: atIndexes([0, 1, 2], { maxSymmetryDiff: 16 }) } } }), [])
    expect(exercise(within, 'overhead_raise').withinExerciseImprovement?.text).toBe('双臂上举：双臂高度不一致，前 3 次中 3 次，后 3 次中 0 次。')
    const pairs = analyzeTraining(makeSession({ id: 'a20b', startedAt: at(2), exercises: { knee_raise: { raw: (index) => ({ peakKneeHeight: index % 2 === 0 ? -0.02 : -0.2 }) } } }), [])
    const entry = pairs.priorityIssues.find((item) => item.id === 'knee_raise.height_gap')!
    expect(entry.text).toBe('交替提膝，左右提膝高度差较大（5 组中 5 组）')
    const focus = pairs.nextFocus.find((item) => item.canonicalIds.includes('knee_raise.height_gap'))
    expect(focus?.target).toMatchObject({ outOf: 5, compliantAtLeast: 2, unit: '组' })
    expect(focus?.target?.text).toBe('下次目标：5 组中至少 2 组做到。')
  })
})

describe('8F-1C adversarial regressions (B)', () => {
  it('B1 knee alternation (次) and height gap (组) are separate entries with their own units', () => {
    const result = analyzeTraining(makeSession({
      id: 'b1', startedAt: at(2),
      exercises: { knee_raise: { raw: (index) => ({ peakKneeHeight: index % 2 === 0 ? -0.02 : -0.25, wrongSideSequence: index >= 1 && index <= 4 }) } },
    }), [])
    expect(issue(result, 'knee_raise.alternation')).toMatchObject({ stats: R(4, 9), unit: '次', significance: 'SIGNIFICANT' })
    expect(issue(result, 'knee_raise.height_gap')).toMatchObject({ stats: R(5, 5), unit: '组', significance: 'SIGNIFICANT' })
    expect(result.priorityIssues.every((item) => item.kind === 'ISSUE' && item.members.length === 1)).toBe(true)
    expect(result.priorityIssues.filter((item) => item.exerciseIds.includes('knee_raise')).length).toBeLessThanOrEqual(ANALYSIS_CONFIG_V1.priority.maxPerExercise)
  })

  it('B2 a PARTIAL comparison only uses exercises completed with a score on both sides', () => {
    const result = analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history)
    expect(result.comparison.commonExerciseIds).toEqual(['overhead_raise', 'lateral_raise', 'step_jack'])
    expect(result.overall.delta).toBeNull()
  })

  it('B3 a real legacy session reports the missing rules version, not the missing mode', () => {
    const result = analyzeTraining(LEGACY_SESSION, [OLDER()])
    expect(result.comparison.reason).toBe('CURRENT_RULES_UNVERSIONED')
    expect(result.comparison.reasonText).toBe('本次记录来自旧版本，无法确认评分规则，暂不比较。')
    expect(exercise(result, 'overhead_raise').capabilityContribution.FORM.value).toBeNull()
  })

  it('B4 no capability strength while that dimension has a significant issue', () => {
    const result = analyzeTraining(makeSession({ id: 'b4', startedAt: at(2), exercises: { squat: { raw: atIndexes([0, 2, 3, 5], { maxHipDrop: 0.28 }) } } }), [])
    const amplitude = dimension(result, 'AMPLITUDE')
    expect(issue(result, 'squat.depth').significance).toBe('SIGNIFICANT')
    expect(amplitude.value).toBeGreaterThanOrEqual(85)
    expect(amplitude.contributors.every((item) => item.value >= 75)).toBe(true)
    expect(result.strengths.some((item) => item.kind === 'CAPABILITY_STRENGTH' && item.dimension === 'AMPLITUDE')).toBe(false)
  })

  it('B5 torso instability everywhere: one theme entry, no exercise or STABILITY strength for affected exercises', () => {
    const lean = { raw: atIndexes([0, 2, 3, 5], { maxTorsoLean: 15 }) }
    const result = analyzeTraining(makeSession({
      id: 'b5', startedAt: at(2),
      exercises: { overhead_raise: lean, lateral_raise: lean, squat: lean, step_jack: { raw: atIndexes([0, 2, 4, 6, 8], { maxTorsoLean: 15 }) } },
    }), [])
    const theme = result.priorityIssues.filter((item) => item.kind === 'THEME')
    expect(theme).toHaveLength(1)
    expect(theme[0].exerciseIds).toEqual(['overhead_raise', 'lateral_raise', 'step_jack', 'squat'])
    const affected = new Set(theme[0].exerciseIds as string[])
    expect(result.strengths.some((item) => item.kind === 'EXERCISE_STRENGTH' && affected.has(item.exerciseIds[0]))).toBe(false)
    expect(result.strengths.some((item) => item.dimension === 'STABILITY')).toBe(false)
  })

  it('B6 IMPROVED keeps its 0.75 factor (never clamped back to 1)', () => {
    const result = analyzeTraining(
      makeSession({ id: 'b6', startedAt: at(2), exercises: { squat: { raw: atIndexes([0, 2, 3, 5], { maxHipDrop: 0.22 }) } } }),
      [makeSession({ id: 'b6-before', startedAt: at(1), exercises: { squat: { raw: () => ({ maxHipDrop: 0.22 }) } } })],
    )
    const depth = issue(result, 'squat.depth')
    expect(depth.comparison?.trend).toBe('IMPROVED')
    expect(depth.withinSession).toEqual({ firstHalf: R(2, 3), secondHalf: R(2, 3) })
    expect(depth.technicalPriority).toBeCloseTo(2 * (4 / 6) * 0.75, 6)
  })

  it('B7 weak-capability fallback: threshold 75, names a specific exercise, body region and method', () => {
    expect(ANALYSIS_CONFIG_V1.capability.weakThreshold).toBe(75)
    const slow = analyzeTraining(makeSession({
      id: 'b7', startedAt: at(2),
      exercises: {
        overhead_raise: { raw: () => ({ durationMs: 5800 }) }, lateral_raise: { raw: () => ({ durationMs: 5800 }) },
        step_jack: { raw: () => ({ durationMs: 2800 }) }, squat: { raw: () => ({ durationMs: 6800 }) }, knee_raise: { raw: () => ({ durationMs: 2600 }) },
      },
    }), [])
    expect(slow.priorityIssues).toEqual([])
    expect(dimension(slow, 'TEMPO').value).toBeLessThan(75)
    expect(slow.nextFocus).toEqual([{
      rank: 1, source: 'WEAK_CAPABILITY', exerciseIds: ['overhead_raise'], canonicalIds: ['overhead_raise.too_fast'], bodyRegion: 'both_arms',
      cue: '动作不要拖太久，每次上举加下放用 2–4 秒',
      target: { compliantAtLeast: 4, outOf: 6, unit: '次', text: '下次目标：6 次中至少 4 次在 2–4 秒内完成。' },
      text: '双臂上举：动作不要拖太久，每次上举加下放用 2–4 秒。下次目标：6 次中至少 4 次在 2–4 秒内完成。',
    }])

    const lean = (value: number) => ({ raw: () => ({ maxTorsoLean: value }) })
    const unsteady = analyzeTraining(makeSession({
      id: 'b7b', startedAt: at(2),
      exercises: {
        overhead_raise: { raw: (index) => ({ maxTorsoLean: index === 0 ? 11 : 9 }) },
        lateral_raise: lean(9), step_jack: lean(9), squat: lean(9), knee_raise: lean(9),
      },
    }), [])
    const stability = dimension(unsteady, 'STABILITY').value as number
    expect(stability).toBeGreaterThanOrEqual(65)
    expect(stability).toBeLessThan(75)
    expect(unsteady.nextFocus).toHaveLength(1)
    expect(unsteady.nextFocus[0]).toMatchObject({
      source: 'WEAK_CAPABILITY', exerciseIds: ['overhead_raise'], bodyRegion: 'core', target: null,
      text: '双臂上举：收紧核心，上举时躯干保持直立。',
    })
  })

  it('B8 capability comparison re-aggregates BOTH sides over the same common contributors', () => {
    const current = makeSession({ id: 'b8', startedAt: at(2), exercises: { knee_raise: { raw: () => ({ peakKneeHeight: -0.3 }) } } })
    const previous = makeSession({ id: 'b8-before', startedAt: at(1), courseStatus: 'incomplete', include: ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack'], exercises: { overhead_raise: { raw: () => ({ peakShoulderL: 151, peakShoulderR: 150 }) } } })
    const result = analyzeTraining(current, [previous])
    expect(result.comparison).toMatchObject({ level: 'PARTIAL', reason: 'NO_FULL_SCOPE_PREVIOUS', commonExerciseIds: ['overhead_raise', 'lateral_raise', 'step_jack'] })
    const amplitude = dimension(result, 'AMPLITUDE')
    const values = Object.fromEntries(amplitude.contributors.map((item) => [item.exerciseId, item.value]))
    expect(amplitude.contributors).toHaveLength(5)
    expect(amplitude.value).toBe(mean(Object.values(values)))
    expect(amplitude.comparison?.commonExerciseIds).toEqual(['overhead_raise', 'lateral_raise', 'step_jack'])
    expect(amplitude.comparison?.current).toBe(mean([values.overhead_raise, values.lateral_raise, values.step_jack]))
    expect(amplitude.comparison?.delta).toBe((amplitude.comparison?.current ?? 0) - (amplitude.comparison?.previous ?? 0))
    expect(amplitude.comparison?.current).not.toBe(amplitude.value)
  })

  it('B9 PARTIAL summaries never talk about an overall change', () => {
    const result = analyzeTraining(PARTIAL_SESSION.current, PARTIAL_SESSION.history)
    expect(result.summary[0].text).toBe('本次训练未完成，已完成 3 个计分动作，平均 ' + result.overall.score + ' 分。')
    expect(result.summary.map((item) => item.text).join('')).not.toMatch(/比上次|与上次/)
  })

  it('B10 pose prompts during a scored exercise stay in data quality only', () => {
    const result = analyzeTraining(makeSession({ id: 'b10', startedAt: at(2), exercises: { lateral_raise: { prompts: { BODY_OUT_OF_FRAME: 5 } } } }), [])
    expect(result.priorityIssues).toEqual([])
    expect(result.nextFocus).toEqual([])
    expect(result.summary.map((item) => item.text).join('')).not.toMatch(/入镜|识别不清/)
    expect(result.dataQuality.poseQuality).toMatchObject({ outOfFramePrompts: 5, environmentHint: 'FRAMING' })
    expect(result.dataQuality.notes).toContain('本次有 5 次身体未完整入镜提示。')
  })

  it('B11 shoulder-rotation corrections never leak into scored issues or reminder counts', () => {
    const result = analyzeTraining(makeSession({ id: 'b11', startedAt: at(2), shoulderPrompts: { TORSO_LEAN: 3, MOTION_TOO_SMALL: 3 } }), [])
    expect(issue(result, 'overhead_raise.torso_lean').reminderCount).toBe(0)
    expect(issue(result, 'lateral_raise.torso_lean').reminderCount).toBe(0)
    expect(result.priorityIssues).toEqual([])
  })

  it('B12 real-shaped step jack (12 reps, arms low on 6): sync judged only on the 6 gated reps', () => {
    const result = analyzeTraining(makeSession({ id: 'b12', startedAt: at(2), exercises: { step_jack: { raw: atIndexes([0, 1, 2, 3, 4, 5], { peakMeanShoulderAngle: 115 }) } } }), [])
    expect(issue(result, 'step_jack.limb_sync').stats).toEqual(R(0, 6))
    expect(issue(result, 'step_jack.arm_height').stats).toEqual(R(6, 12))
    expect(result.priorityIssues.map((item) => item.id)).toEqual(['step_jack.arm_height'])
  })
})

describe('strength sources (8F-1A §18)', () => {
  it('issue-free strength: themes with ≥3 member exercises, each evaluable ≥4, zero affected; max 2 items', () => {
    // Every exercise has a significant AMPLITUDE issue (no exercise strength); STABILITY/COORDINATION/TEMPO stay below 85
    // and squat knee alignment blocks FORM, so only the issue-free themes can qualify.
    const result = analyzeTraining(makeSession({
      id: 'issue-free', startedAt: at(2),
      exercises: {
        overhead_raise: { raw: (index) => ({ maxTorsoLean: 9, maxSymmetryDiff: 11, durationMs: 4500, ...([0, 2, 3, 5].includes(index) ? { peakShoulderL: 140, peakShoulderR: 141 } : {}) }) },
        lateral_raise: { raw: (index) => ({ maxTorsoLean: 9, maxSymmetryDiff: 13, durationMs: 4500, ...([0, 2, 3, 5].includes(index) ? { peakShoulderL: 74 } : {}) }) },
        step_jack: { raw: (index) => ({ maxTorsoLean: 9, syncGapMs: 380, durationMs: 2100, ...(index < 4 ? { peakOpenRatio: 1.4, syncGapMs: 2100 } : {}) }) },
        squat: { raw: (index) => ({ maxTorsoLean: 9, maxKneeHeightDiff: 0.07, durationMs: 5700, ...([0, 2, 3, 5].includes(index) ? { maxHipDrop: 0.22, minKneeSpreadRatio: 0.6 } : {}) }) },
        knee_raise: { raw: (index) => ({ maxTorsoLean: 9, durationMs: 1900, ...([0, 2, 4].includes(index) ? { peakKneeHeight: -0.2 } : {}) }) },
      },
    }), [])
    expect(result.exercises.every((item) => item.issues.some((entry) => entry.dimension === 'AMPLITUDE' && entry.significance === 'SIGNIFICANT'))).toBe(true)
    expect(result.strengths.map((item) => [item.kind, item.id, item.text])).toEqual([
      ['ISSUE_FREE_STRENGTH', 'issue-free:TORSO_STABILITY', '5 个动作共 40 次可评估动作中均未检测到身体侧倾或晃动。'],
      ['ISSUE_FREE_STRENGTH', 'issue-free:ARM_SYMMETRY', '3 个动作共 24 次可评估动作中均未检测到双臂高度不一致。'],
    ])
  })

  it('historical strengths come first: RESOLVED, then score improvements of at least 5', () => {
    const result = analyzeTraining(
      makeSession({ id: 'hist', startedAt: at(2) }),
      [weakerSession('hist-before', at(1), { squat: { raw: (index) => ({ maxTorsoLean: 9, ...([0, 2, 4].includes(index) ? { maxHipDrop: 0.2 } : {}) }) } })],
    )
    expect(result.strengths[0]).toMatchObject({ kind: 'HISTORICAL_RESOLVED', canonicalIds: ['squat.depth'] })
    expect(result.strengths[1].kind).toBe('HISTORICAL_SCORE_IMPROVED')
    expect(result.strengths[1].exerciseIds).not.toEqual(['squat'])
    expect(result.strengths[1].evidence).toMatchObject({ type: 'SCORE_CHANGE', delta: expect.any(Number) })
    expect((result.strengths[1].evidence as { delta: number }).delta).toBeGreaterThanOrEqual(5)
  })

  it('capability strength wording states the lowest contributor instead of an absolute claim', () => {
    const result = analyzeTraining(THEME_MERGE_AND_CAPS, [])
    expect(result.strengths.find((item) => item.kind === 'CAPABILITY_STRENGTH')?.text).toBe('节奏：100 分，参与计算的 5 个动作中最低 100 分。')
  })
})

describe('summary decline and theme sanity on shared fixtures', () => {
  it('limited-data wording distinguishes exercises that never started', () => {
    const result = analyzeTraining(PARTIAL_SESSION.oneCommon, PARTIAL_SESSION.history)
    expect(result.summary.map((item) => item.text).slice(0, 2)).toEqual([
      `本次训练未完成，已完成 1 个计分动作，得分 ${result.overall.score} 分。`,
      '本次有动作未开始或有效识别次数不足，分析范围有限。',
    ])
  })

  it('a declined overall is stated even when strengths exist', () => {
    const result = analyzeTraining(weakerSession('decline', at(2)), [makeSession({ id: 'decline-before', startedAt: at(1) })])
    expect(result.strengths.length).toBeGreaterThan(0)
    expect(result.overall.trend).toBe('DECLINED')
    expect(result.summary[0].text).toContain(`比上次降低 ${Math.abs(result.overall.delta as number)} 分`)
  })

  it('theme fixture never shows the same torso label three times', () => {
    const result = analyzeTraining(THEME_MERGE_AND_CAPS, [])
    const labels = result.priorityIssues.map((item) => item.reportLabel)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
