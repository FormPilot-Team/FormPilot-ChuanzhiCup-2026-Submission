import { LateralRaiseFeatureExtractor } from './FeatureExtractor'
import type { MotionFeatures } from '../../motion/types'
import type { ExerciseDefinition } from '../contract'
import { createLateralRaiseEngine } from './engine'
import type { LateralRaiseStateSnapshot } from './stateMachine'
import { LATERAL_RAISE_REFERENCE } from '../../referencePose/definitions'
import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../thresholdVersioning'
import { LATERAL_RAISE_V1 } from './config'
import { COACH_CORRECTIONS } from '../../coach/correctionPresentation'

export const lateralRaiseDefinition: ExerciseDefinition<MotionFeatures, LateralRaiseStateSnapshot> = {
  id: 'lateral_raise',
  displayName: '侧平举',
  specVersion: EXERCISE_SPEC_VERSION,
  thresholdVersion: ENGINEERING_THRESHOLD_VERSION,
  createFeatureExtractor: () => new LateralRaiseFeatureExtractor(),
  createEngine: () => createLateralRaiseEngine(),
  reference: LATERAL_RAISE_REFERENCE,
  presentation: {
    subtitle: '侧平举专项',
    guidance: '保持核心收紧，手臂向两侧抬起，感受肩部发力',
    adviceFallback: '保持核心收紧，控制抬起与下放速度。',
    phaseHint: '保持动作完整，平稳回到起始位置',
    coach: {
      preparationText: '保持上半身和髋部入镜，双臂自然下垂',
      activeText: '保持动作稳定',
      corrections: COACH_CORRECTIONS.lateral_raise,
    },
    targetReps: 8,
    fastTargetReps: 1,
    durationSeconds: 45,
    initialPhase: 'START',
    metrics: [
      { key: 'amplitude', label: '动作幅度', note: `目标幅度 ${LATERAL_RAISE_V1.topMinAngle}°–${LATERAL_RAISE_V1.topMaxAngle}°`, icon: 'amplitude', tone: 'blue' },
      { key: 'symmetry', label: '对称性', note: '左右两侧基本对称', icon: 'symmetry', tone: 'green' },
      { key: 'stability', label: '稳定性', note: '核心稳定，身体控制良好', icon: 'stability', tone: 'green' },
      { key: 'tempo', label: '节奏', note: `推荐 ${LATERAL_RAISE_V1.repDurationMinMs / 1000}–${LATERAL_RAISE_V1.repDurationMaxMs / 1000} 秒 / 次`, icon: 'tempo', tone: 'blue' },
    ],
    phaseLabels: { START: '起始位', RAISING: '抬起', TOP: '顶部', LOWERING: '回落', COMPLETE: '完成' },
    cameraDemo: {
      portraitSrc: '/assets/coach-lateral-raise.png',
      landscapeSrc: '/assets/camera-lateral-raise-demo.png',
      alt: '演示模式中的侧平举人物',
    },
  },
  getDebugData: ({ features }) => [
    ['Left shoulder', `${(features?.shoulderAngleL ?? 0).toFixed(1)}°`],
    ['Right shoulder', `${(features?.shoulderAngleR ?? 0).toFixed(1)}°`],
    ['Left elbow', `${(features?.elbowAngleL ?? 0).toFixed(1)}°`],
    ['Right elbow', `${(features?.elbowAngleR ?? 0).toFixed(1)}°`],
    ['Symmetry diff', `${(features?.symmetryDiff ?? 0).toFixed(1)}°`],
    ['Torso lean', `${(features?.torsoLean ?? 0).toFixed(1)}°`],
  ].map(([label, value]) => ({ label, value })),
  isPoseCompatible: () => true,
}
