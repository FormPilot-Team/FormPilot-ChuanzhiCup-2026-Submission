import { LATERAL_RAISE_V1 } from '../exercises/lateralRaise/config'
import { STEP_JACK_V1 } from '../exercises/stepJack/config'
import { SQUAT_V1 } from '../exercises/squat/config'
import { KNEE_RAISE_V1 } from '../exercises/kneeRaise/config'
import type { ExerciseReferenceProfile, PoseAnchorLandmarks } from './types'

const canonicalPoint = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 })

/** Internal visual/engineering reference. These are not detected landmarks or population norms. */
const SQUAT_BOTTOM_VISUAL_REFERENCE: PoseAnchorLandmarks = {
  nose: canonicalPoint(0.5, 0.23),
  leftShoulder: canonicalPoint(0.62, 0.35),
  rightShoulder: canonicalPoint(0.38, 0.35),
  leftElbow: canonicalPoint(0.68, 0.49),
  rightElbow: canonicalPoint(0.32, 0.49),
  leftWrist: canonicalPoint(0.54, 0.44),
  rightWrist: canonicalPoint(0.46, 0.44),
  leftHip: canonicalPoint(0.56, 0.62),
  rightHip: canonicalPoint(0.44, 0.62),
  leftKnee: canonicalPoint(0.67, 0.62),
  rightKnee: canonicalPoint(0.33, 0.62),
  leftAnkle: canonicalPoint(0.65, 0.82),
  rightAnkle: canonicalPoint(0.35, 0.82),
}

export const LATERAL_RAISE_REFERENCE: ExerciseReferenceProfile = {
  canonicalPoses: [
    {
      id: 'lateral_raise.START', exerciseId: 'lateral_raise', phase: 'START', side: 'center',
      metrics: [
        { key: 'shoulderAngle', target: 10, unit: 'degree' },
        { key: 'elbowAngle', target: 170, unit: 'degree' },
        { key: 'symmetryDiff', target: 0, unit: 'degree' },
        { key: 'torsoLean', target: 0, unit: 'degree' },
      ],
    },
    {
      id: 'lateral_raise.TOP', exerciseId: 'lateral_raise', phase: 'TOP', side: 'center',
      metrics: [
        { key: 'shoulderAngle', target: 90, unit: 'degree' },
        { key: 'elbowAngle', target: 170, unit: 'degree' },
        { key: 'symmetryDiff', target: 0, unit: 'degree' },
        { key: 'torsoLean', target: 0, unit: 'degree' },
      ],
    },
  ],
  userAcceptance: [{
    canonicalPoseId: 'lateral_raise.TOP',
    metrics: [
      { key: 'shoulderAngle', min: LATERAL_RAISE_V1.topMinAngle, max: LATERAL_RAISE_V1.topMaxAngle, unit: 'degree' },
      { key: 'elbowAngle', min: LATERAL_RAISE_V1.elbowMinAngle, unit: 'degree' },
      { key: 'symmetryDiff', max: LATERAL_RAISE_V1.symmetryMaxDiff, unit: 'degree' },
      { key: 'torsoLean', max: LATERAL_RAISE_V1.torsoLeanMax, unit: 'degree' },
    ],
  }],
  coachAssetAcceptance: [{
    canonicalPoseId: 'lateral_raise.TOP',
    metrics: [
      { key: 'shoulderAngle', min: 85, max: 95, unit: 'degree' },
      { key: 'elbowAngle', min: 160, max: 180, unit: 'degree' },
      { key: 'symmetryDiff', max: 5, unit: 'degree' },
      { key: 'torsoLean', max: 5, unit: 'degree' },
    ],
  }],
  coachPoseAnchorSrc: '/assets/coach-lateral-raise.pose.json',
}

const stepOpenMetrics = [
  { key: 'armAngle' as const, target: 145, unit: 'degree' as const },
  { key: 'armAngleDiff' as const, target: 0, unit: 'degree' as const },
  { key: 'openRatio' as const, target: 1.8, unit: 'ratio' as const },
  { key: 'torsoLean' as const, target: 0, unit: 'degree' as const },
]

export const STEP_JACK_REFERENCE: ExerciseReferenceProfile = {
  canonicalPoses: [
    {
      id: 'step_jack.CENTER', exerciseId: 'step_jack', phase: 'CENTER', side: 'center',
      metrics: [
        { key: 'armAngle', target: 10, unit: 'degree' },
        { key: 'openRatio', target: 1, unit: 'ratio' },
        { key: 'torsoLean', target: 0, unit: 'degree' },
      ],
    },
    { id: 'step_jack.LEFT_OPEN', exerciseId: 'step_jack', phase: 'LEFT_OPEN', side: 'left', metrics: stepOpenMetrics },
    { id: 'step_jack.RIGHT_OPEN', exerciseId: 'step_jack', phase: 'RIGHT_OPEN', side: 'right', metrics: stepOpenMetrics },
  ],
  userAcceptance: [
    {
      canonicalPoseId: 'step_jack.LEFT_OPEN',
      metrics: [
        { key: 'armAngle', min: STEP_JACK_V1.armTopMinAngle, unit: 'degree' },
        { key: 'armAngleDiff', max: STEP_JACK_V1.armSymmetryMaxDiff, unit: 'degree' },
        { key: 'openRatio', min: STEP_JACK_V1.openMinRatio, unit: 'ratio' },
        { key: 'torsoLean', max: STEP_JACK_V1.torsoLeanMax, unit: 'degree' },
      ],
    },
    {
      canonicalPoseId: 'step_jack.RIGHT_OPEN',
      metrics: [
        { key: 'armAngle', min: STEP_JACK_V1.armTopMinAngle, unit: 'degree' },
        { key: 'armAngleDiff', max: STEP_JACK_V1.armSymmetryMaxDiff, unit: 'degree' },
        { key: 'openRatio', min: STEP_JACK_V1.openMinRatio, unit: 'ratio' },
        { key: 'torsoLean', max: STEP_JACK_V1.torsoLeanMax, unit: 'degree' },
      ],
    },
  ],
  coachAssetAcceptance: [
    {
      canonicalPoseId: 'step_jack.LEFT_OPEN',
      metrics: [
        { key: 'armAngle', min: 140, max: 150, unit: 'degree' },
        { key: 'openRatio', min: 1.7, max: 1.9, unit: 'ratio' },
        { key: 'torsoLean', max: 5, unit: 'degree' },
      ],
    },
    {
      canonicalPoseId: 'step_jack.RIGHT_OPEN',
      metrics: [
        { key: 'armAngle', min: 140, max: 150, unit: 'degree' },
        { key: 'openRatio', min: 1.7, max: 1.9, unit: 'ratio' },
        { key: 'torsoLean', max: 5, unit: 'degree' },
      ],
    },
  ],
  coachPoseAnchorSrc: '/assets/coach-step-jack.pose.json',
}

export const SQUAT_REFERENCE: ExerciseReferenceProfile = {
  canonicalPoses: [
    {
      id: 'squat.STANDING', exerciseId: 'squat', phase: 'STANDING', side: 'center',
      metrics: [
        { key: 'hipDrop', target: 0, unit: 'ratio' },
        { key: 'hipKneeSeparation', target: 1, unit: 'ratio' },
        { key: 'kneeSpreadRatio', target: 1, unit: 'ratio' },
        { key: 'kneeHeightDiff', target: 0, unit: 'ratio' },
        { key: 'torsoLean', target: 0, unit: 'degree' },
      ],
    },
    {
      id: 'squat.BOTTOM', exerciseId: 'squat', phase: 'BOTTOM', side: 'center',
      metrics: [
        { key: 'hipDrop', target: 0.35, unit: 'ratio' },
        { key: 'hipKneeSeparation', target: 0, unit: 'ratio' },
        { key: 'kneeWidthShoulderRatio', target: 1.4, unit: 'ratio' },
        { key: 'ankleWidthShoulderRatio', target: 1.25, unit: 'ratio' },
        { key: 'kneeAnkleHorizontalOffset', target: 0.08, unit: 'ratio' },
        { key: 'kneeHeightDiff', target: 0, unit: 'ratio' },
        { key: 'torsoLean', target: 0, unit: 'degree' },
      ],
      landmarks: SQUAT_BOTTOM_VISUAL_REFERENCE,
    },
  ],
  userAcceptance: [{
    canonicalPoseId: 'squat.BOTTOM',
    metrics: [
      { key: 'hipDrop', min: SQUAT_V1.validDepthHipDrop, unit: 'ratio' },
      { key: 'kneeSpreadRatio', min: SQUAT_V1.kneeValgusMaxRatio, unit: 'ratio' },
      { key: 'kneeHeightDiff', max: SQUAT_V1.kneeHeightDiffMax, unit: 'ratio' },
      { key: 'torsoLean', max: SQUAT_V1.torsoLeanMax, unit: 'degree' },
    ],
  }],
  coachAssetAcceptance: [{
    canonicalPoseId: 'squat.BOTTOM',
    detectability: {
      minimumPoseConfidence: 0.95,
      minimumRequiredLandmarkVisibility: 0.95,
      fullBodyMargin: 0.02,
      maximumLeftRightVisibilityDiff: 0.08,
    },
    metrics: [
      { key: 'hipKneeSeparation', min: -0.35, max: 0.2, unit: 'ratio' },
      { key: 'kneeWidthShoulderRatio', min: 0.9, max: 1.5, unit: 'ratio' },
      { key: 'ankleWidthShoulderRatio', min: 0.75, max: 1.4, unit: 'ratio' },
      { key: 'kneeAnkleHorizontalOffset', max: 0.3, unit: 'ratio' },
      { key: 'kneeHeightDiff', max: 0.1, unit: 'ratio' },
      { key: 'legSymmetryDiff', max: 0.12, unit: 'ratio' },
      { key: 'torsoCenterOffset', max: 0.12, unit: 'ratio' },
      { key: 'torsoLean', max: 5, unit: 'degree' },
    ],
  }],
  coachPoseAnchorSrc: '/assets/coach-squat.pose.json',
}

const KNEE_CENTER: PoseAnchorLandmarks = {
  nose: canonicalPoint(0.5, 0.12), leftShoulder: canonicalPoint(0.42, 0.27), rightShoulder: canonicalPoint(0.58, 0.27),
  leftElbow: canonicalPoint(0.46, 0.38), rightElbow: canonicalPoint(0.54, 0.38), leftWrist: canonicalPoint(0.5, 0.36), rightWrist: canonicalPoint(0.5, 0.36),
  leftHip: canonicalPoint(0.46, 0.5), rightHip: canonicalPoint(0.54, 0.5), leftKnee: canonicalPoint(0.46, 0.7), rightKnee: canonicalPoint(0.54, 0.7),
  leftAnkle: canonicalPoint(0.46, 0.9), rightAnkle: canonicalPoint(0.54, 0.9),
}
const KNEE_LEFT_TOP: PoseAnchorLandmarks = {
  ...KNEE_CENTER, leftKnee: canonicalPoint(0.56, 0.51), leftAnkle: canonicalPoint(0.56, 0.68),
}
const mirror = (pose: PoseAnchorLandmarks): PoseAnchorLandmarks => Object.fromEntries(Object.entries(pose).map(([name, point]) => {
  const swapped = name.startsWith('left') ? `right${name.slice(4)}` : name.startsWith('right') ? `left${name.slice(5)}` : name
  return [swapped, { ...point, x: 1 - point.x }]
})) as PoseAnchorLandmarks

export const KNEE_RAISE_REFERENCE: ExerciseReferenceProfile = {
  canonicalPoses: [
    { id: 'knee_raise.CENTER', exerciseId: 'knee_raise', phase: 'CENTER', side: 'center', landmarks: KNEE_CENTER,
      metrics: [{ key: 'leftKneeHeight', target: -0.87, unit: 'ratio' }, { key: 'rightKneeHeight', target: -0.87, unit: 'ratio' }, { key: 'torsoLean', target: 0, unit: 'degree' }] },
    { id: 'knee_raise.LEFT_TOP', exerciseId: 'knee_raise', phase: 'LEFT_TOP', side: 'left', landmarks: KNEE_LEFT_TOP,
      metrics: [{ key: 'leftKneeHeight', target: 0, unit: 'ratio' }, { key: 'rightKneeHeight', target: -0.87, unit: 'ratio' }, { key: 'torsoLean', target: 0, unit: 'degree' }] },
    { id: 'knee_raise.RIGHT_TOP', exerciseId: 'knee_raise', phase: 'RIGHT_TOP', side: 'right', landmarks: mirror(KNEE_LEFT_TOP),
      metrics: [{ key: 'rightKneeHeight', target: 0, unit: 'ratio' }, { key: 'leftKneeHeight', target: -0.87, unit: 'ratio' }, { key: 'torsoLean', target: 0, unit: 'degree' }] },
  ],
  userAcceptance: [
    { canonicalPoseId: 'knee_raise.LEFT_TOP', metrics: [{ key: 'leftKneeHeight', min: KNEE_RAISE_V1.userTargetHeight, unit: 'ratio' }, { key: 'torsoLean', max: KNEE_RAISE_V1.torsoLeanMax, unit: 'degree' }, { key: 'hipShift', max: KNEE_RAISE_V1.hipShiftMax, unit: 'ratio' }] },
    { canonicalPoseId: 'knee_raise.RIGHT_TOP', metrics: [{ key: 'rightKneeHeight', min: KNEE_RAISE_V1.userTargetHeight, unit: 'ratio' }, { key: 'torsoLean', max: KNEE_RAISE_V1.torsoLeanMax, unit: 'degree' }, { key: 'hipShift', max: KNEE_RAISE_V1.hipShiftMax, unit: 'ratio' }] },
  ],
  coachAssetAcceptance: [{
    canonicalPoseId: 'knee_raise.LEFT_TOP', detectability: { minimumPoseConfidence: 0.94, minimumRequiredLandmarkVisibility: 0.9, fullBodyMargin: 0.02, maximumLeftRightVisibilityDiff: 0.15 },
    metrics: [{ key: 'leftKneeHeight', min: -0.1, max: 0.4, unit: 'ratio' }, { key: 'rightKneeHeight', max: -0.45, unit: 'ratio' }, { key: 'torsoLean', max: 7, unit: 'degree' }, { key: 'hipShift', max: 0.25, unit: 'ratio' }],
  }],
  coachPoseAnchorSrc: '/assets/coach-knee-raise.pose.json',
}
