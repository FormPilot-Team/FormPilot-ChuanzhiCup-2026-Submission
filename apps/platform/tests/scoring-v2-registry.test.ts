import { describe, expect, it } from 'vitest'
import { KNEE_RAISE_SCORING } from '../src/features/exercises/kneeRaise/config'
import { calculateKneeRaiseMetrics } from '../src/features/exercises/kneeRaise/scoring'
import type { KneeRaiseStateSnapshot } from '../src/features/exercises/kneeRaise/stateMachine'
import { LATERAL_RAISE_SCORING } from '../src/features/exercises/lateralRaise/config'
import { calculateMetrics as calculateLateralMetrics } from '../src/features/exercises/lateralRaise/scoring'
import type { LateralRaiseStateSnapshot } from '../src/features/exercises/lateralRaise/stateMachine'
import { OVERHEAD_RAISE_SCORING } from '../src/features/exercises/overheadRaise/config'
import { calculateOverheadRaiseScoreComponents } from '../src/features/exercises/overheadRaise/scoring'
import { SQUAT_SCORING } from '../src/features/exercises/squat/config'
import { calculateSquatMetrics } from '../src/features/exercises/squat/scoring'
import type { SquatStateSnapshot } from '../src/features/exercises/squat/stateMachine'
import { STEP_JACK_SCORING } from '../src/features/exercises/stepJack/config'
import { calculateStepJackMetrics } from '../src/features/exercises/stepJack/scoring'
import type { StepJackStateSnapshot } from '../src/features/exercises/stepJack/stateMachine'
import type { ExerciseId, RuleMetrics } from '../src/features/exercises/types'
import type { StepJackFeatures } from '../src/features/motion/types'
import { ROUTINE_PROGRAMS } from '../src/features/routines/programs'
import { CRITERIA, SCORING_SOURCES, criteriaFor, criterionBasisText, getScoringSource, targetScore, type EvaluationCriterion } from '../src/features/scoring'

const OFFICIAL = new Set(['OFFICIAL_STANDARD', 'OFFICIAL_GUIDANCE', 'COMPETITION_RULE'])

describe('Scoring v2 registry: Gate A traceability', () => {
  it('has unique criterion ids and resolves every source id', () => {
    expect(new Set(CRITERIA.map((item) => item.id)).size).toBe(CRITERIA.length)
    expect(new Set(SCORING_SOURCES.map((item) => item.id)).size).toBe(SCORING_SOURCES.length)
    for (const criterion of CRITERIA) {
      expect(() => getScoringSource(criterion.sourceId), criterion.id).not.toThrow()
      for (const id of criterion.additionalSourceIds) expect(() => getScoringSource(id), `${criterion.id} → ${id}`).not.toThrow()
      expect(criterion.sourceTitle).toBe(getScoringSource(criterion.sourceId).title)
      expect(criterion.sourceType).toBe(getScoringSource(criterion.sourceId).type)
      expect(criterion.requirement.length, criterion.id).toBeGreaterThan(4)
    }
  })

  it('points every chapter-level criterion at a real chapter of its routine', () => {
    for (const criterion of CRITERIA.filter((item) => item.mode !== 'warm-up' && item.exercise !== '*')) {
      const program = ROUTINE_PROGRAMS.find((item) => item.id === criterion.mode)
      expect(program?.chapters.some((chapter) => chapter.id === criterion.exercise), criterion.id).toBe(true)
    }
  })

  it('gives every scored criterion a metric, a phase, a target, a weight, feedback and its threshold basis', () => {
    const scored = CRITERIA.filter((item) => item.scoring === 'SCORED')
    expect(scored.length).toBeGreaterThan(40)
    for (const criterion of scored) {
      expect(criterion.observable, criterion.id).not.toBe('NOT_OBSERVABLE')
      expect(criterion.measurement.kind, criterion.id).not.toBe('none')
      expect(criterion.metric, criterion.id).not.toBeNull()
      expect(criterion.landmarks.length, criterion.id).toBeGreaterThan(0)
      expect(criterion.phase, criterion.id).toBeTruthy()
      expect(criterion.target, criterion.id).not.toBeNull()
      expect(criterion.tolerance, criterion.id).toBeGreaterThan(0)
      expect(criterion.weight, criterion.id).toBeGreaterThan(0)
      expect(criterion.feedback.issue, criterion.id).toBeTruthy()
      expect(criterion.feedback.cue, criterion.id).toBeTruthy()
      expect(criterion.thresholdBasis, criterion.id).toBeTruthy()
    }
  })

  it('gives every eight-section form of 八段锦 two to five camera checks', () => {
    for (let form = 1; form <= 8; form += 1) {
      const measured = criteriaFor('baduanjin', `bdj-${form}`).filter((item) => item.scoring !== 'REFERENCE_ONLY')
      expect(measured.length, `bdj-${form}`).toBeGreaterThanOrEqual(form === 8 ? 1 : 2)
      expect(measured.length, `bdj-${form}`).toBeLessThanOrEqual(6)
      expect(measured.every((item) => item.feedback.cue && item.feedback.issue)).toBe(true)
    }
  })
})

describe('Scoring v2 registry: Gate C honesty', () => {
  it('never scores what the camera cannot observe', () => {
    for (const criterion of CRITERIA.filter((item) => item.observable === 'NOT_OBSERVABLE')) {
      expect(criterion.scoring, criterion.id).toBe('REFERENCE_ONLY')
      expect(criterion.weight, criterion.id).toBe(0)
      expect(criterion.measurement.kind, criterion.id).toBe('none')
      expect(criterion.limitations.length, criterion.id).toBeGreaterThan(0)
    }
    for (const criterion of CRITERIA.filter((item) => item.scoring !== 'SCORED')) expect(criterion.weight, criterion.id).toBe(0)
  })

  it('keeps evidence levels consistent with the kind of source', () => {
    for (const criterion of CRITERIA) {
      if (criterion.evidenceLevel === 'A') expect(OFFICIAL.has(criterion.sourceType), criterion.id).toBe(true)
      if (criterion.evidenceLevel === 'C') expect(criterion.sourceType, criterion.id).toBe('FORMPILOT_CALIBRATED')
      if (criterion.evidenceLevel === 'B') expect(['ACADEMIC_EVIDENCE', 'OFFICIAL_GUIDANCE'], criterion.id).toContain(criterion.sourceType)
    }
  })

  it('labels every number as FormPilot-calibrated and never as a national standard', () => {
    for (const criterion of CRITERIA) {
      expect(criterion.thresholdSource, criterion.id).toBe(criterion.target ? 'FORMPILOT_CALIBRATED' : 'NONE')
      if (criterion.target) expect(criterionBasisText(criterion).threshold, criterion.id).toContain('FormPilot')
    }
    // No national scoring standard exists for the six warm-up movements.
    expect(criteriaFor('warm-up', 'squat').concat(...(['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack', 'knee_raise'] as ExerciseId[]).map((id) => criteriaFor('warm-up', id)))
      .some((item) => item.sourceType === 'OFFICIAL_STANDARD')).toBe(false)
    // Routine thresholds are calibrated on the standard demonstration and say so.
    for (const criterion of CRITERIA.filter((item) => item.measurement.kind === 'pose-window')) expect(criterion.thresholdBasis, criterion.id).toContain('示范')
  })

  it('marks every source as verified online or as provided by the project', () => {
    for (const source of SCORING_SOURCES) {
      expect(['VERIFIED_ONLINE', 'PROJECT_PROVIDED']).toContain(source.verification)
      if (source.verification === 'PROJECT_PROVIDED') expect(source.contentChecked, source.id).toBe(false)
    }
    expect(getScoringSource('gsqc-bdj-errors-2018')).toMatchObject({ verification: 'VERIFIED_ONLINE', contentChecked: true, published: '2018-01-10' })
    expect(getScoringSource('tcacm-1676-2026-baduanjin')).toMatchObject({ identifier: 'T/CACM 1676—2026', verification: 'PROJECT_PROVIDED' })
  })
})

// ── Current score mapping: the warm-up criteria describe the real engineering-v1 scoring functions ────────────────

type Components = Record<string, number>

function overhead(values: Partial<Record<'peak' | 'elbow' | 'sym' | 'lean' | 'duration', number>>): Components {
  const v = { peak: 160, elbow: 160, sym: 0, lean: 0, duration: 3000, ...values }
  const c = calculateOverheadRaiseScoreComponents(v.peak, v.peak, v.elbow, v.elbow, v.sym, v.lean, v.duration)
  return { amplitude: c.amplitude, elbow: c.elbow, synchronization: c.synchronization, stability: c.stability, tempo: c.tempo }
}

function scores(metrics: RuleMetrics): Components {
  return Object.fromEntries(Object.entries(metrics).map(([key, metric]) => [key, metric.score]))
}

function lateral(values: Partial<Record<'peak' | 'sym' | 'lean' | 'duration', number>>): Components {
  const v = { peak: 90, sym: 0, lean: 0, duration: 3000, ...values }
  const rep = { exerciseId: 'lateral_raise', repIndex: 1, startedAt: 0, completedAt: v.duration, durationMs: v.duration, maxTorsoLean: v.lean, topHoldMs: 500, peakShoulderL: v.peak, peakShoulderR: v.peak, minElbowL: 170, minElbowR: 170, maxSymmetryDiff: v.sym }
  return scores(calculateLateralMetrics({ completedRep: rep } as unknown as LateralRaiseStateSnapshot, { shoulderL: 0, shoulderR: 0, symmetry: 0, torsoLean: 0, timestamp: 0 }))
}

function stepJack(values: Partial<Record<'ratio' | 'gap' | 'lean' | 'duration', number>>): Components {
  const v = { ratio: 2, gap: 0, lean: 0, duration: 1400, ...values }
  const rep = { exerciseId: 'step_jack', repIndex: 1, startedAt: 0, completedAt: v.duration, durationMs: v.duration, maxTorsoLean: v.lean, side: 'left', peakOpenRatio: v.ratio, peakMeanShoulderAngle: 170, maxArmAngleDiff: 0, syncGapMs: v.gap, wrongSideSequence: false, incompleteReturn: false }
  return scores(calculateStepJackMetrics({ completedRep: rep } as unknown as StepJackStateSnapshot, { openRatio: 1, meanShoulderAngle: 0, torsoLean: 0, timestamp: 0 } as unknown as StepJackFeatures))
}

function squat(values: Partial<Record<'drop' | 'spread' | 'height' | 'lean' | 'duration', number>>): Components {
  const v = { drop: 0.4, spread: 1.1, height: 0, lean: 0, duration: 4000, ...values }
  const rep = { exerciseId: 'squat', repIndex: 1, startedAt: 0, completedAt: v.duration, durationMs: v.duration, maxTorsoLean: v.lean, bottomTime: 0, maxHipDrop: v.drop, minKneeSpreadRatio: v.spread, maxKneeHeightDiff: v.height }
  return scores(calculateSquatMetrics({ phase: 'COMPLETE', completedRep: rep } as unknown as SquatStateSnapshot, { hipDrop: 0, kneeSpreadRatio: 1, kneeHeightDiff: 0, torsoLean: 0, timestamp: 0 }))
}

function kneeRaise(values: Partial<Record<'peak' | 'shift' | 'gap' | 'duration', number>>): Components {
  const v = { peak: 0.1, shift: 0, gap: 0, duration: 1300, ...values }
  const rep = { exerciseId: 'knee_raise', repIndex: 2, side: 'right', startedAt: 0, completedAt: v.duration, durationMs: v.duration, maxTorsoLean: 0, peakKneeHeight: v.peak, hipShiftMax: v.shift, wrongSideSequence: false, incompleteReturn: false }
  return scores(calculateKneeRaiseMetrics({ completedRep: rep, lastLeftPeak: 0, lastRightPeak: v.gap } as unknown as KneeRaiseStateSnapshot, { leftKneeHeight: 0, rightKneeHeight: 0, hipHorizontalShift: 0, torsoLean: 0, timestamp: 0 }))
}

/** Evaluates the real component score for one criterion's observed quantity. */
const COMPONENT_AT: Record<string, (value: number) => number> = {
  'wu.overhead_raise.arm_height': (value) => overhead({ peak: value }).amplitude,
  'wu.overhead_raise.elbow': (value) => overhead({ elbow: value }).elbow,
  'wu.overhead_raise.sync': (value) => overhead({ sym: value }).synchronization,
  'wu.overhead_raise.torso': (value) => overhead({ lean: value }).stability,
  'wu.overhead_raise.tempo': (value) => overhead({ duration: value * 1000 }).tempo,
  'wu.lateral_raise.arm_height': (value) => lateral({ peak: value }).amplitude,
  'wu.lateral_raise.symmetry': (value) => lateral({ sym: value }).symmetry,
  'wu.lateral_raise.torso': (value) => lateral({ lean: value }).stability,
  'wu.step_jack.coordination': (value) => stepJack({ gap: value }).coordination,
  'wu.step_jack.tempo': (value) => stepJack({ duration: value * 1000 }).tempo,
  'wu.step_jack.stability': (value) => stepJack({ lean: value }).stability,
  'wu.squat.depth': (value) => squat({ drop: value }).amplitude,
  'wu.squat.knee_track': (value) => squat({ spread: value }).symmetry,
  'wu.squat.tempo': (value) => squat({ duration: value * 1000 }).tempo,
  'wu.knee_raise.height': (value) => kneeRaise({ peak: value }).amplitude,
  'wu.knee_raise.symmetry': (value) => kneeRaise({ gap: value }).symmetry,
  'wu.knee_raise.tempo': (value) => kneeRaise({ duration: value * 1000 }).tempo,
}

/**
 * Components that blend two quantities; the criterion target names the main one. At the target the component is
 * full; at the main quantity's zero point only the other part's share remains.
 */
const COMBINED_AT: Record<string, { at: (value: number) => number; remainingShare: number }> = {
  'wu.lateral_raise.tempo': { at: (value) => lateral({ duration: value * 1000 }).tempo, remainingShare: 50 },
  'wu.step_jack.amplitude': { at: (value) => stepJack({ ratio: value }).amplitude, remainingShare: 50 },
  'wu.squat.balance': { at: (value) => squat({ height: value }).stability, remainingShare: SQUAT_SCORING.stabilityTorsoWeight * 100 },
  'wu.knee_raise.stability': { at: (value) => kneeRaise({ shift: value }).stability, remainingShare: 50 },
}

function repComponents(exerciseId: ExerciseId): EvaluationCriterion[] {
  return criteriaFor('warm-up', exerciseId).filter((item) => item.measurement.kind === 'rep-component')
}

describe('Scoring v2 registry: current warm-up score mapping', () => {
  it('maps every engineering-v1 score component to exactly one criterion with the same weight', () => {
    const weights: Array<[ExerciseId, Record<string, number>]> = [
      ['overhead_raise', OVERHEAD_RAISE_SCORING.weights], ['lateral_raise', LATERAL_RAISE_SCORING.weights],
      ['step_jack', STEP_JACK_SCORING.weights], ['squat', SQUAT_SCORING.weights], ['knee_raise', KNEE_RAISE_SCORING.weights],
    ]
    for (const [exerciseId, table] of weights) {
      const components = repComponents(exerciseId)
      expect(components.map((item) => item.measurement.kind === 'rep-component' && item.measurement.metricKey).sort(), exerciseId).toEqual(Object.keys(table).sort())
      for (const criterion of components) {
        if (criterion.measurement.kind !== 'rep-component') continue
        expect(criterion.measurement.componentWeight, criterion.id).toBe(table[criterion.measurement.metricKey])
        expect(criterion.weight, criterion.id).toBe(table[criterion.measurement.metricKey])
      }
      expect(Object.values(table).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 9)
    }
  })

  it('states targets at which the runtime component scores 100, and tolerances at which it scores 0', () => {
    const checked = Object.keys(COMPONENT_AT)
    for (const id of checked) {
      const criterion = CRITERIA.find((item) => item.id === id) as EvaluationCriterion
      const target = criterion.target
      const at = COMPONENT_AT[id]
      if (!target) throw new Error(`${id} has no target`)
      if (target.kind === 'between') {
        expect(Math.round(at(target.min)), `${id} @min`).toBe(100)
        expect(Math.round(at(target.max)), `${id} @max`).toBe(100)
        expect(Math.round(at(target.min - target.tolerance)), `${id} @min-tolerance`).toBe(0)
      } else {
        expect(Math.round(at(target.value)), `${id} @target`).toBe(100)
        expect(Math.round(at(target.zeroAt)), `${id} @zeroAt`).toBe(0)
      }
      expect(targetScore(target.kind === 'between' ? target.min : target.value, target)).toBe(100)
    }
    for (const [id, combined] of Object.entries(COMBINED_AT)) {
      const target = (CRITERIA.find((item) => item.id === id) as EvaluationCriterion).target
      if (!target) throw new Error(`${id} has no target`)
      const full = target.kind === 'between' ? target.min : target.value
      const zero = target.kind === 'between' ? target.min - target.tolerance : target.zeroAt
      expect(Math.round(combined.at(full)), `${id} @target`).toBe(100)
      expect(Math.round(combined.at(zero)), `${id} @zeroAt`).toBe(Math.round(combined.remainingShare))
    }
    // Every scored warm-up component with a numeric range is covered (completion / alternation are binary).
    const numeric = CRITERIA.filter((item) => item.mode === 'warm-up' && item.measurement.kind === 'rep-component' && !(item.target?.kind === 'atLeast' && item.target.value === 1))
    expect(numeric.map((item) => item.id).filter((id) => !checked.includes(id) && !(id in COMBINED_AT))).toEqual([])
  })
})
