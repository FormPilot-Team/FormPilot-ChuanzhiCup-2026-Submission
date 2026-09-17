import type { ShoulderRotationFeatures } from '../../motion/types'
import { LATERAL_RAISE_REQUIRED } from '../../pose/types'
import type { ExerciseDefinition } from '../contract'
import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../thresholdVersioning'
import { ShoulderRotationFeatureExtractor } from './FeatureExtractor'
import { createShoulderRotationEngine } from './engine'
import type { ShoulderRotationStateSnapshot } from './stateMachine'
import { COACH_CORRECTIONS } from '../../coach/correctionPresentation'

export const shoulderRotationDefinition: ExerciseDefinition<ShoulderRotationFeatures, ShoulderRotationStateSnapshot> = {
  id: 'shoulder_rotation', displayName: '肩部环绕', specVersion: EXERCISE_SPEC_VERSION, thresholdVersion: ENGINEERING_THRESHOLD_VERSION,
  createFeatureExtractor: () => new ShoulderRotationFeatureExtractor(), createEngine: () => createShoulderRotationEngine(),
  reference: { canonicalPoses: [{ id: 'shoulder_rotation.ROTATING', exerciseId: 'shoulder_rotation', phase: 'ROTATING', side: 'center', metrics: [{ key: 'shoulderAngle', target: 90, unit: 'degree' }, { key: 'torsoLean', target: 0, unit: 'degree' }] }], userAcceptance: [], coachAssetAcceptance: [], coachPoseAnchorSrc: '/assets/coach-shoulder-rotation.pose.json' },
  presentation: {
    subtitle: '肩部活动引导', guidance: '双臂同步画大圈，保持连续呼吸和躯干稳定', adviceFallback: '放松肩颈，连续、平稳地完成环绕。', phaseHint: '跟随节奏持续环绕',
    coach: { preparationText: '保持上半身和髋部入镜，准备热身', activeText: '保持动作连续', corrections: COACH_CORRECTIONS.shoulder_rotation },
    targetReps: 0, fastTargetReps: 0, durationSeconds: 15, initialPhase: 'READY',
    metrics: [
      { key: 'amplitude', label: '活动幅度', note: '让肩部充分活动', icon: 'amplitude', tone: 'blue' },
      { key: 'coordination', label: '双臂同步', note: '左右手臂保持同节奏', icon: 'coordination', tone: 'green' },
      { key: 'continuity', label: '连续性', note: '动作不中断', icon: 'tempo', tone: 'blue' },
      { key: 'stability', label: '躯干稳定', note: '避免侧倾借力', icon: 'stability', tone: 'green' },
    ],
    phaseLabels: { READY: '准备', ROTATING: '环绕中', COMPLETE: '完成' },
    cameraDemo: { portraitSrc: '/assets/coach-shoulder-rotation.png', landscapeSrc: '/assets/shoulder-rotation-demo-mid.png', alt: '肩部环绕动作演示', fit: 'contain', sequence: [
      { id: 'low', src: '/assets/shoulder-rotation-demo-low.png', durationMs: 500 }, { id: 'mid', src: '/assets/shoulder-rotation-demo-mid.png', durationMs: 500 }, { id: 'high', src: '/assets/shoulder-rotation-demo-high.png', durationMs: 500 }, { id: 'mid-return', src: '/assets/shoulder-rotation-demo-mid.png', durationMs: 500 },
    ] },
  },
  getDebugData: ({ features, state }) => [
    { label: 'Left excursion', value: `${(features?.leftExcursion ?? 0).toFixed(1)}°` }, { label: 'Right excursion', value: `${(features?.rightExcursion ?? 0).toFixed(1)}°` },
    { label: 'Motion sync', value: `${((features?.motionSync ?? 0) * 100).toFixed(0)}%` }, { label: 'Continuity', value: `${((features?.motionContinuity ?? 0) * 100).toFixed(0)}%` },
    { label: 'Active motion', value: `${(state.activeMotionMs / 1000).toFixed(1)}s` }, { label: 'Torso lean', value: `${(features?.torsoLean ?? 0).toFixed(1)}°` },
  ],
  isPoseCompatible: (frame) => frame.landmarks.length >= 29 && LATERAL_RAISE_REQUIRED.length > 0,
}
