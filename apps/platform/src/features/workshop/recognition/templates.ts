import type { LandmarkName } from '../../pose/types'
import type { FeatureTemplateId, PhaseThresholds, RecognitionProfile } from '../types'

/**
 * The workbench's recognition contracts (`需整合版本/自定义动作工作台`, sandboxRecognition/featureProfiles.ts and
 * types.ts), kept inside the workshop. Values are the workbench's engineering (not human-calibrated) thresholds in the
 * templates' own signal units. The warm-up exercises never read them.
 */

export interface SignalThresholds {
  moving: number
  peak: number
  returnThreshold: number
}

export const PROFILE_SIGNAL_THRESHOLDS: Readonly<Record<RecognitionProfile, SignalThresholds>> = Object.freeze({
  'upper-body': { moving: 0.16, peak: 0.38, returnThreshold: 0.11 },
  'hip-lateral': { moving: 0.13, peak: 0.28, returnThreshold: 0.11 },
  'hip-rotation': { moving: 0.16, peak: 0.28, returnThreshold: 0.11 },
  'lower-body': { moving: 0.16, peak: 0.46, returnThreshold: 0.11 },
  'full-body': { moving: 0.16, peak: 0.28, returnThreshold: 0.11 },
  mixed: { moving: 0.16, peak: 0.28, returnThreshold: 0.11 },
})

/** How a template counts: a pulse out and back, one full circle, a left/right switch, or a held pose. */
export type TemplateCounting = 'pulse' | 'orbit' | 'alternate' | 'hold'

export interface FeatureTemplate {
  id: FeatureTemplateId
  /** Landmark groups; each group needs at least one usable member (one side is often hidden). */
  qualityGroups: ReadonlyArray<ReadonlyArray<LandmarkName>>
  /** Landmarks that must stay inside the picture. */
  bounds: ReadonlyArray<LandmarkName>
  /** Template-own thresholds; `null` uses the region's profile thresholds. */
  thresholds: SignalThresholds | null
  /** 'difference': the signal is measured against the user's own neutral pose captured while ready. */
  baseline: { mode: 'none' | 'difference'; range: number }
  counting: TemplateCounting
  /** The template measures torso lean itself, so leaning is not an error. */
  torsoLeanIsSignal: boolean
}

const TORSO: ReadonlyArray<LandmarkName> = ['leftShoulder', 'rightShoulder']
const HIPS: ReadonlyArray<LandmarkName> = ['leftHip', 'rightHip']
const WRISTS: ReadonlyArray<LandmarkName> = ['leftWrist', 'rightWrist']
const KNEES: ReadonlyArray<LandmarkName> = ['leftKnee', 'rightKnee']
const ANKLES: ReadonlyArray<LandmarkName> = ['leftAnkle', 'rightAnkle']
const ELBOWS: ReadonlyArray<LandmarkName> = ['leftElbow', 'rightElbow']
const UPPER_BOUNDS: ReadonlyArray<LandmarkName> = [...TORSO, ...ELBOWS, ...WRISTS, ...HIPS]
const LOWER_BOUNDS: ReadonlyArray<LandmarkName> = [...TORSO, ...HIPS, ...KNEES, ...ANKLES]
const FULL_BOUNDS: ReadonlyArray<LandmarkName> = [...UPPER_BOUNDS, ...KNEES, ...ANKLES]

function template(id: FeatureTemplateId, spec: Omit<FeatureTemplate, 'id' | 'torsoLeanIsSignal'> & { torsoLeanIsSignal?: boolean }): FeatureTemplate {
  return { id, torsoLeanIsSignal: false, ...spec }
}

export const FEATURE_TEMPLATES: Readonly<Record<FeatureTemplateId, FeatureTemplate>> = Object.freeze({
  generic: template('generic', { qualityGroups: [TORSO, HIPS], bounds: FULL_BOUNDS, thresholds: null, baseline: { mode: 'none', range: 0.2 }, counting: 'pulse' }),
  'arm-raise': template('arm-raise', { qualityGroups: [TORSO, HIPS, WRISTS], bounds: UPPER_BOUNDS, thresholds: { moving: 0.08, peak: 0.22, returnThreshold: 0.06 }, baseline: { mode: 'none', range: 0.28 }, counting: 'pulse' }),
  'arm-circle': template('arm-circle', { qualityGroups: [TORSO, HIPS, WRISTS], bounds: UPPER_BOUNDS, thresholds: { moving: 0.06, peak: 0.16, returnThreshold: 0.045 }, baseline: { mode: 'none', range: 0.28 }, counting: 'orbit' }),
  'punch-horizontal': template('punch-horizontal', { qualityGroups: [TORSO, HIPS, WRISTS], bounds: UPPER_BOUNDS, thresholds: { moving: 0.045, peak: 0.1, returnThreshold: 0.03 }, baseline: { mode: 'difference', range: 0.5 }, counting: 'alternate' }),
  'squat-depth': template('squat-depth', { qualityGroups: [TORSO, HIPS, KNEES, ANKLES], bounds: LOWER_BOUNDS, thresholds: { moving: 0.08, peak: 0.2, returnThreshold: 0.06 }, baseline: { mode: 'difference', range: 0.35 }, counting: 'pulse', torsoLeanIsSignal: true }),
  'lunge-single-leg': template('lunge-single-leg', { qualityGroups: [TORSO, HIPS, KNEES, ANKLES], bounds: LOWER_BOUNDS, thresholds: { moving: 0.08, peak: 0.18, returnThreshold: 0.05 }, baseline: { mode: 'none', range: 0.35 }, counting: 'pulse', torsoLeanIsSignal: true }),
  'toe-raise': template('toe-raise', { qualityGroups: [TORSO, HIPS, KNEES, ANKLES], bounds: LOWER_BOUNDS, thresholds: { moving: 0.035, peak: 0.08, returnThreshold: 0.025 }, baseline: { mode: 'difference', range: 0.18 }, counting: 'pulse', torsoLeanIsSignal: true }),
  'seated-leg-raise': template('seated-leg-raise', { qualityGroups: [TORSO, HIPS, KNEES], bounds: [...TORSO, ...HIPS, ...KNEES], thresholds: { moving: 0.04, peak: 0.1, returnThreshold: 0.03 }, baseline: { mode: 'difference', range: 0.22 }, counting: 'pulse', torsoLeanIsSignal: true }),
  'core-flexion': template('core-flexion', { qualityGroups: [TORSO, HIPS, KNEES, ELBOWS], bounds: [...TORSO, ...HIPS, ...KNEES], thresholds: { moving: 0.08, peak: 0.16, returnThreshold: 0.05 }, baseline: { mode: 'none', range: 0.35 }, counting: 'pulse', torsoLeanIsSignal: true }),
  'plank-shoulder-tap': template('plank-shoulder-tap', { qualityGroups: [TORSO, HIPS, WRISTS], bounds: [...TORSO, ...WRISTS, ...HIPS], thresholds: { moving: 0.08, peak: 0.18, returnThreshold: 0.05 }, baseline: { mode: 'none', range: 0.3 }, counting: 'alternate', torsoLeanIsSignal: true }),
  'mountain-climber': template('mountain-climber', { qualityGroups: [TORSO, HIPS, KNEES], bounds: [...TORSO, ...HIPS, ...KNEES], thresholds: { moving: 0.04, peak: 0.11, returnThreshold: 0.03 }, baseline: { mode: 'none', range: 0.4 }, counting: 'pulse', torsoLeanIsSignal: true }),
  'stretch-hold': template('stretch-hold', { qualityGroups: [TORSO, HIPS], bounds: [...TORSO, ...HIPS], thresholds: { moving: 0.06, peak: 0.14, returnThreshold: 0.05 }, baseline: { mode: 'none', range: 0.2 }, counting: 'hold', torsoLeanIsSignal: true }),
})

/** Landmarks each region needs inside the picture (the workbench's framing contract per profile). */
export const PROFILE_BOUNDS: Readonly<Record<RecognitionProfile, ReadonlyArray<LandmarkName>>> = Object.freeze({
  'upper-body': UPPER_BOUNDS,
  'hip-lateral': [...TORSO, ...HIPS, ...ANKLES],
  'hip-rotation': UPPER_BOUNDS,
  'lower-body': LOWER_BOUNDS,
  'full-body': FULL_BOUNDS,
  mixed: FULL_BOUNDS,
})

/** A template's signal thresholds in its own units (the region's for `generic`). */
export function templateSignalThresholds(templateId: FeatureTemplateId, profile: RecognitionProfile): SignalThresholds {
  return FEATURE_TEMPLATES[templateId].thresholds ?? PROFILE_SIGNAL_THRESHOLDS[profile]
}

/** The same thresholds as progress units, where the template's peak is 100 %. */
export function templateProgressThresholds(templateId: FeatureTemplateId, profile: RecognitionProfile): PhaseThresholds {
  const signal = templateSignalThresholds(templateId, profile)
  return {
    moving: round2(signal.moving / signal.peak),
    peak: 1,
    returnThreshold: round2(signal.returnThreshold / signal.peak),
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
