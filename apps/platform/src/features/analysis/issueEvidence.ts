import { KNEE_RAISE_V1 } from '../exercises/kneeRaise/config'
import { LATERAL_RAISE_V1 } from '../exercises/lateralRaise/config'
import { OVERHEAD_RAISE_V1 } from '../exercises/overheadRaise/config'
import { SQUAT_V1 } from '../exercises/squat/config'
import { STEP_JACK_V1 } from '../exercises/stepJack/config'
import type { ExerciseSessionResult, RepetitionResult } from '../training/types'
import { analyzedRepetitions } from './repetitionValidity'
import type { ReportIssueDefinition } from './issueTaxonomy'
import type { Incidence } from './types'

export interface IssueEvidenceResult {
  incidence: Incidence
  affectedSequence: boolean[]
  evidenceRefs: string[]
  missingEvidenceCount: number
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function repRef(exercise: ExerciseSessionResult, result: RepetitionResult): string {
  return `rep:${exercise.exerciseId}:${result.rep.repIndex}`
}

function evaluate(definition: ReportIssueDefinition, result: RepetitionResult): boolean | null {
  const rep = result.rep
  switch (`${definition.exerciseId}:${definition.code}`) {
    case 'overhead_raise:ARMS_TOO_LOW': return rep.exerciseId === 'overhead_raise' ? Math.min(rep.peakShoulderL, rep.peakShoulderR) < OVERHEAD_RAISE_V1.topMinAngle : null
    case 'overhead_raise:ELBOW_TOO_BENT_L': return rep.exerciseId === 'overhead_raise' && finite(rep.topElbowL) ? rep.topElbowL < OVERHEAD_RAISE_V1.elbowCorrectionAngle : null
    case 'overhead_raise:ELBOW_TOO_BENT_R': return rep.exerciseId === 'overhead_raise' && finite(rep.topElbowR) ? rep.topElbowR < OVERHEAD_RAISE_V1.elbowCorrectionAngle : null
    case 'overhead_raise:ASYMMETRY': return rep.exerciseId === 'overhead_raise' ? rep.maxSymmetryDiff > OVERHEAD_RAISE_V1.symmetryMaxDiff : null
    case 'overhead_raise:TORSO_LEAN': return rep.exerciseId === 'overhead_raise' ? rep.maxTorsoLean > OVERHEAD_RAISE_V1.torsoLeanMax : null
    case 'overhead_raise:TOO_FAST': return rep.exerciseId === 'overhead_raise' ? rep.durationMs < OVERHEAD_RAISE_V1.repDurationMinMs : null

    case 'lateral_raise:ARM_TOO_LOW_L': return rep.exerciseId === 'lateral_raise' ? rep.peakShoulderL < LATERAL_RAISE_V1.topMinAngle : null
    case 'lateral_raise:ARM_TOO_LOW_R': return rep.exerciseId === 'lateral_raise' ? rep.peakShoulderR < LATERAL_RAISE_V1.topMinAngle : null
    case 'lateral_raise:ELBOW_TOO_BENT_L': return rep.exerciseId === 'lateral_raise' ? rep.minElbowL < LATERAL_RAISE_V1.elbowMinAngle : null
    case 'lateral_raise:ELBOW_TOO_BENT_R': return rep.exerciseId === 'lateral_raise' ? rep.minElbowR < LATERAL_RAISE_V1.elbowMinAngle : null
    case 'lateral_raise:ASYMMETRY': return rep.exerciseId === 'lateral_raise' ? rep.maxSymmetryDiff > LATERAL_RAISE_V1.symmetryMaxDiff : null
    case 'lateral_raise:TORSO_LEAN': return rep.exerciseId === 'lateral_raise' ? rep.maxTorsoLean > LATERAL_RAISE_V1.torsoLeanMax : null
    case 'lateral_raise:TOO_FAST': return rep.exerciseId === 'lateral_raise' ? rep.durationMs < LATERAL_RAISE_V1.repDurationMinMs : null

    case 'step_jack:STEP_TOO_SMALL': return rep.exerciseId === 'step_jack' ? rep.peakOpenRatio < STEP_JACK_V1.openMinRatio : null
    case 'step_jack:ARM_LEG_UNSYNCED': return rep.exerciseId === 'step_jack' ? rep.syncGapMs > STEP_JACK_V1.syncAcceptableMs || rep.maxArmAngleDiff > STEP_JACK_V1.armSymmetryMaxDiff : null
    case 'step_jack:ARM_TOO_LOW': return rep.exerciseId === 'step_jack' ? rep.peakMeanShoulderAngle < STEP_JACK_V1.armTopMinAngle : null
    case 'step_jack:BODY_SWAY': return rep.exerciseId === 'step_jack' ? rep.maxTorsoLean > STEP_JACK_V1.torsoLeanMax : null
    case 'step_jack:WRONG_SIDE_SEQUENCE': return rep.exerciseId === 'step_jack' && rep.repIndex > 1 ? rep.wrongSideSequence : null
    case 'step_jack:TOO_FAST': return rep.exerciseId === 'step_jack' ? rep.durationMs < STEP_JACK_V1.repDurationMinMs : null

    case 'squat:DEPTH_INSUFFICIENT': return rep.exerciseId === 'squat' ? rep.maxHipDrop < SQUAT_V1.validDepthHipDrop : null
    case 'squat:KNEE_VALGUS': return rep.exerciseId === 'squat' ? rep.minKneeSpreadRatio < SQUAT_V1.kneeValgusMaxRatio : null
    case 'squat:LEFT_RIGHT_ASYMMETRY': return rep.exerciseId === 'squat' ? rep.maxKneeHeightDiff > SQUAT_V1.kneeHeightDiffMax : null
    case 'squat:TORSO_LATERAL_LEAN': return rep.exerciseId === 'squat' ? rep.maxTorsoLean > SQUAT_V1.torsoLeanMax : null
    case 'squat:TOO_FAST': return rep.exerciseId === 'squat' ? rep.durationMs < SQUAT_V1.repDurationMinMs : null

    case 'knee_raise:KNEE_TOO_LOW_L': return rep.exerciseId === 'knee_raise' && rep.side === 'left' ? rep.peakKneeHeight < KNEE_RAISE_V1.userTargetHeight : null
    case 'knee_raise:KNEE_TOO_LOW_R': return rep.exerciseId === 'knee_raise' && rep.side === 'right' ? rep.peakKneeHeight < KNEE_RAISE_V1.userTargetHeight : null
    case 'knee_raise:WRONG_SIDE_SEQUENCE': return rep.exerciseId === 'knee_raise' && rep.repIndex > 1 ? rep.wrongSideSequence : null
    case 'knee_raise:BODY_SWAY': return rep.exerciseId === 'knee_raise' ? rep.hipShiftMax > KNEE_RAISE_V1.hipShiftMax || rep.maxTorsoLean > KNEE_RAISE_V1.torsoLeanMax : null
    case 'knee_raise:TOO_FAST': return rep.exerciseId === 'knee_raise' ? rep.durationMs < KNEE_RAISE_V1.repDurationMinMs : null
    default: return null
  }
}

function kneeHeightPairs(exercise: ExerciseSessionResult): Array<{ affected: boolean; refs: string[] }> {
  const reps = analyzedRepetitions(exercise).filter((item) => item.rep.exerciseId === 'knee_raise')
  const pairs: Array<{ affected: boolean; refs: string[] }> = []
  for (let index = 1; index < reps.length; index += 1) {
    const previous = reps[index - 1]
    const current = reps[index]
    if (previous.rep.exerciseId !== 'knee_raise' || current.rep.exerciseId !== 'knee_raise' || previous.rep.side === current.rep.side) continue
    pairs.push({
      affected: Math.abs(previous.rep.peakKneeHeight - current.rep.peakKneeHeight) > KNEE_RAISE_V1.peakHeightGapMax,
      refs: [repRef(exercise, previous), repRef(exercise, current)],
    })
  }
  return pairs
}

export function collectIssueEvidence(exercise: ExerciseSessionResult, definition: ReportIssueDefinition): IssueEvidenceResult {
  if (definition.code === 'LEFT_RIGHT_HEIGHT_GAP' && definition.exerciseId === 'knee_raise') {
    const pairs = kneeHeightPairs(exercise)
    return {
      incidence: { affected: pairs.filter((item) => item.affected).length, evaluable: pairs.length },
      affectedSequence: pairs.map((item) => item.affected),
      evidenceRefs: pairs.filter((item) => item.affected).flatMap((item) => item.refs),
      missingEvidenceCount: 0,
    }
  }
  let missingEvidenceCount = 0
  const units = analyzedRepetitions(exercise).flatMap((result) => {
    const affected = evaluate(definition, result)
    if (affected === null) {
      if (definition.exerciseId === 'overhead_raise' && (definition.code === 'ELBOW_TOO_BENT_L' || definition.code === 'ELBOW_TOO_BENT_R')) missingEvidenceCount += 1
      return []
    }
    return [{ affected, ref: repRef(exercise, result) }]
  })
  return {
    incidence: { affected: units.filter((item) => item.affected).length, evaluable: units.length },
    affectedSequence: units.map((item) => item.affected),
    evidenceRefs: units.filter((item) => item.affected).map((item) => item.ref),
    missingEvidenceCount,
  }
}
