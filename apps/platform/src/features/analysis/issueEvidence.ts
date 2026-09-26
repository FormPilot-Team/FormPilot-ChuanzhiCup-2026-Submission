import { KNEE_RAISE_V1 } from '../exercises/kneeRaise/config'
import { LATERAL_RAISE_V1 } from '../exercises/lateralRaise/config'
import { OVERHEAD_RAISE_V1 } from '../exercises/overheadRaise/config'
import { SQUAT_V1 } from '../exercises/squat/config'
import { STEP_JACK_V1 } from '../exercises/stepJack/config'
import type { KneeRaiseRepSummary, StepJackRepSummary } from '../exercises/types'
import type { RepetitionResult } from '../training/types'
import { finite } from './ratio'
import type { ReportIssueDefinition } from './types'

/** A VALID or PARTIAL repetition together with its position in `exercise.repetitions`. */
export interface AnalyzedRep {
  index: number
  result: RepetitionResult
  validity: 'VALID' | 'PARTIAL'
}

/** One evaluable unit: a repetition, or a left/right pair for knee_raise.height_gap. */
export interface EvidenceUnit {
  affected: boolean
  repIndexes: number[]
}

export interface IssueEvidence {
  units: EvidenceUnit[]
  missingEvidenceReps: number
  /** step_jack.step_width only (REP_SIDE_BREAKDOWN). */
  sideUnits: { left: EvidenceUnit[]; right: EvidenceUnit[] } | null
}

type Outcome = 'AFFECTED' | 'CLEAR' | 'NOT_EVALUABLE' | 'MISSING'

function flag(value: boolean): Outcome {
  return value ? 'AFFECTED' : 'CLEAR'
}

/**
 * The runtime falls back to syncGapMs = durationMs when either the arms or the step never reached their threshold,
 * so only reps that reached both thresholds say anything about limb synchronisation.
 */
export function stepJackSyncEvaluable(rep: StepJackRepSummary): boolean {
  return rep.peakMeanShoulderAngle >= STEP_JACK_V1.armTopMinAngle && rep.peakOpenRatio >= STEP_JACK_V1.openMinRatio
}

/**
 * 8F-1A §8 pairing: scan analyzed reps in order; two adjacent reps on different sides form one pair and are both
 * consumed; a same-side neighbour only advances the window by one. Pairs never overlap.
 */
export function kneeRaisePairs(analyzed: readonly AnalyzedRep[]): Array<[AnalyzedRep, AnalyzedRep]> {
  const pairs: Array<[AnalyzedRep, AnalyzedRep]> = []
  let cursor = 0
  while (cursor + 1 < analyzed.length) {
    const first = analyzed[cursor].result.rep as KneeRaiseRepSummary
    const second = analyzed[cursor + 1].result.rep as KneeRaiseRepSummary
    if (first.side !== second.side) {
      pairs.push([analyzed[cursor], analyzed[cursor + 1]])
      cursor += 2
    } else {
      cursor += 1
    }
  }
  return pairs
}

export function kneeRaisePairGap(pair: readonly [AnalyzedRep, AnalyzedRep]): number {
  return Math.abs((pair[0].result.rep as KneeRaiseRepSummary).peakKneeHeight - (pair[1].result.rep as KneeRaiseRepSummary).peakKneeHeight)
}

function evaluateRep(definition: ReportIssueDefinition, item: AnalyzedRep, legacy: boolean): Outcome {
  const rep = item.result.rep
  const firstRecorded = item.index === 0
  switch (definition.canonicalId) {
    case 'overhead_raise.arm_height':
      return rep.exerciseId === 'overhead_raise' ? flag(Math.min(rep.peakShoulderL, rep.peakShoulderR) < OVERHEAD_RAISE_V1.topMinAngle) : 'NOT_EVALUABLE'
    case 'overhead_raise.elbow_extension.left':
    case 'overhead_raise.elbow_extension.right': {
      if (rep.exerciseId !== 'overhead_raise') return 'NOT_EVALUABLE'
      // TOP-phase elbow only. Never fall back to minElbow, rep.errors or feedback events.
      const top = definition.side === 'left' ? rep.topElbowL : rep.topElbowR
      if (legacy || !finite(top)) return 'MISSING'
      return flag(top < OVERHEAD_RAISE_V1.elbowCorrectionAngle)
    }
    case 'overhead_raise.arm_symmetry':
      return rep.exerciseId === 'overhead_raise' ? flag(rep.maxSymmetryDiff > OVERHEAD_RAISE_V1.symmetryMaxDiff) : 'NOT_EVALUABLE'
    case 'overhead_raise.torso_lean':
      return rep.exerciseId === 'overhead_raise' ? flag(rep.maxTorsoLean > OVERHEAD_RAISE_V1.torsoLeanMax) : 'NOT_EVALUABLE'
    case 'overhead_raise.too_fast':
      return rep.exerciseId === 'overhead_raise' ? flag(rep.durationMs < OVERHEAD_RAISE_V1.repDurationMinMs) : 'NOT_EVALUABLE'

    case 'lateral_raise.arm_height.left':
      return rep.exerciseId === 'lateral_raise' ? flag(rep.peakShoulderL < LATERAL_RAISE_V1.topMinAngle) : 'NOT_EVALUABLE'
    case 'lateral_raise.arm_height.right':
      return rep.exerciseId === 'lateral_raise' ? flag(rep.peakShoulderR < LATERAL_RAISE_V1.topMinAngle) : 'NOT_EVALUABLE'
    case 'lateral_raise.elbow_extension.left':
      return rep.exerciseId === 'lateral_raise' ? flag(rep.minElbowL < LATERAL_RAISE_V1.elbowMinAngle) : 'NOT_EVALUABLE'
    case 'lateral_raise.elbow_extension.right':
      return rep.exerciseId === 'lateral_raise' ? flag(rep.minElbowR < LATERAL_RAISE_V1.elbowMinAngle) : 'NOT_EVALUABLE'
    case 'lateral_raise.arm_symmetry':
      return rep.exerciseId === 'lateral_raise' ? flag(rep.maxSymmetryDiff > LATERAL_RAISE_V1.symmetryMaxDiff) : 'NOT_EVALUABLE'
    case 'lateral_raise.torso_lean':
      return rep.exerciseId === 'lateral_raise' ? flag(rep.maxTorsoLean > LATERAL_RAISE_V1.torsoLeanMax) : 'NOT_EVALUABLE'
    case 'lateral_raise.too_fast':
      return rep.exerciseId === 'lateral_raise' ? flag(rep.durationMs < LATERAL_RAISE_V1.repDurationMinMs) : 'NOT_EVALUABLE'

    case 'step_jack.step_width':
      return rep.exerciseId === 'step_jack' ? flag(rep.peakOpenRatio < STEP_JACK_V1.openMinRatio) : 'NOT_EVALUABLE'
    case 'step_jack.arm_height':
      return rep.exerciseId === 'step_jack' ? flag(rep.peakMeanShoulderAngle < STEP_JACK_V1.armTopMinAngle) : 'NOT_EVALUABLE'
    case 'step_jack.limb_sync':
      if (rep.exerciseId !== 'step_jack' || !stepJackSyncEvaluable(rep)) return 'NOT_EVALUABLE'
      return flag(rep.syncGapMs > STEP_JACK_V1.syncAcceptableMs)
    case 'step_jack.arm_symmetry':
      return rep.exerciseId === 'step_jack' ? flag(rep.maxArmAngleDiff > STEP_JACK_V1.armSymmetryMaxDiff) : 'NOT_EVALUABLE'
    case 'step_jack.alternation':
      // The first recorded rep's flag only encodes the "expect left first" convention, not alternation.
      return rep.exerciseId === 'step_jack' && !firstRecorded ? flag(rep.wrongSideSequence) : 'NOT_EVALUABLE'
    case 'step_jack.body_sway':
      return rep.exerciseId === 'step_jack' ? flag(rep.maxTorsoLean > STEP_JACK_V1.torsoLeanMax) : 'NOT_EVALUABLE'
    case 'step_jack.too_fast':
      return rep.exerciseId === 'step_jack' ? flag(rep.durationMs < STEP_JACK_V1.repDurationMinMs) : 'NOT_EVALUABLE'

    case 'squat.depth':
      return rep.exerciseId === 'squat' ? flag(rep.maxHipDrop < SQUAT_V1.validDepthHipDrop) : 'NOT_EVALUABLE'
    case 'squat.knee_alignment':
      return rep.exerciseId === 'squat' ? flag(rep.minKneeSpreadRatio < SQUAT_V1.kneeValgusMaxRatio) : 'NOT_EVALUABLE'
    case 'squat.lateral_balance':
      return rep.exerciseId === 'squat' ? flag(rep.maxKneeHeightDiff > SQUAT_V1.kneeHeightDiffMax) : 'NOT_EVALUABLE'
    case 'squat.torso_lean':
      return rep.exerciseId === 'squat' ? flag(rep.maxTorsoLean > SQUAT_V1.torsoLeanMax) : 'NOT_EVALUABLE'
    case 'squat.too_fast':
      return rep.exerciseId === 'squat' ? flag(rep.durationMs < SQUAT_V1.repDurationMinMs) : 'NOT_EVALUABLE'

    case 'knee_raise.knee_height.left':
    case 'knee_raise.knee_height.right':
      return rep.exerciseId === 'knee_raise' && rep.side === definition.side ? flag(rep.peakKneeHeight < KNEE_RAISE_V1.userTargetHeight) : 'NOT_EVALUABLE'
    case 'knee_raise.body_sway':
      return rep.exerciseId === 'knee_raise'
        ? flag(rep.hipShiftMax > KNEE_RAISE_V1.hipShiftMax || rep.maxTorsoLean > KNEE_RAISE_V1.torsoLeanMax)
        : 'NOT_EVALUABLE'
    case 'knee_raise.alternation':
      // The first recorded rep is always false at runtime; it cannot express alternation.
      return rep.exerciseId === 'knee_raise' && !firstRecorded ? flag(rep.wrongSideSequence) : 'NOT_EVALUABLE'
    case 'knee_raise.return_to_center':
      return rep.exerciseId === 'knee_raise' ? flag(rep.incompleteReturn) : 'NOT_EVALUABLE'
    case 'knee_raise.too_fast':
      return rep.exerciseId === 'knee_raise' ? flag(rep.durationMs < KNEE_RAISE_V1.repDurationMinMs) : 'NOT_EVALUABLE'
    default:
      return 'NOT_EVALUABLE'
  }
}

export function collectIssueEvidence(
  definition: ReportIssueDefinition,
  analyzed: readonly AnalyzedRep[],
  options: { legacy: boolean },
): IssueEvidence {
  if (definition.canonicalId === 'knee_raise.height_gap') {
    return {
      units: kneeRaisePairs(analyzed).map((pair) => ({
        affected: kneeRaisePairGap(pair) > KNEE_RAISE_V1.peakHeightGapMax,
        repIndexes: [pair[0].index, pair[1].index],
      })),
      missingEvidenceReps: 0,
      sideUnits: null,
    }
  }
  const units: EvidenceUnit[] = []
  const left: EvidenceUnit[] = []
  const right: EvidenceUnit[] = []
  let missingEvidenceReps = 0
  for (const item of analyzed) {
    const outcome = evaluateRep(definition, item, options.legacy)
    if (outcome === 'MISSING') missingEvidenceReps += 1
    if (outcome !== 'AFFECTED' && outcome !== 'CLEAR') continue
    const unit = { affected: outcome === 'AFFECTED', repIndexes: [item.index] }
    units.push(unit)
    if (definition.sideModel === 'REP_SIDE_BREAKDOWN' && item.result.rep.exerciseId === 'step_jack') {
      ;(item.result.rep.side === 'left' ? left : right).push(unit)
    }
  }
  return {
    units,
    missingEvidenceReps,
    sideUnits: definition.sideModel === 'REP_SIDE_BREAKDOWN' ? { left, right } : null,
  }
}
