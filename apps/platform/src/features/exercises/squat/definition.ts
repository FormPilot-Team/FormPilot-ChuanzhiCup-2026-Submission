import type { ExerciseDefinition } from '../contract'
import type { SquatFeatures } from '../../motion/types'
import { SquatFeatureExtractor } from './FeatureExtractor'
import { createSquatEngine } from './engine'
import type { SquatStateSnapshot } from './stateMachine'
import { SQUAT_REFERENCE } from '../../referencePose/definitions'
import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../thresholdVersioning'
import { SQUAT_V1 } from './config'
import { COACH_CORRECTIONS } from '../../coach/correctionPresentation'

export const squatDefinition: ExerciseDefinition<SquatFeatures, SquatStateSnapshot> = {
  id: 'squat',
  displayName: '徒手深蹲',
  specVersion: EXERCISE_SPEC_VERSION,
  thresholdVersion: ENGINEERING_THRESHOLD_VERSION,
  createFeatureExtractor: () => new SquatFeatureExtractor(),
  createEngine: () => createSquatEngine(),
  reference: SQUAT_REFERENCE,
  presentation: {
    subtitle: '徒手深蹲专项',
    guidance: '双脚约肩宽，髋部下沉后再完整站起，膝盖不要向内夹',
    adviceFallback: '保持左右稳定，控制下蹲深度和起身节奏。',
    phaseHint: '下蹲后回到完整站立，再开始下一次',
    coach: {
      preparationText: '请自然站立，准备开始',
      activeText: '控制下蹲与起身节奏',
      corrections: COACH_CORRECTIONS.squat,
    },
    targetReps: 8,
    fastTargetReps: 1,
    durationSeconds: 45,
    initialPhase: 'STANDING',
    metrics: [
      { key: 'amplitude', label: '深度', note: `目标髋部下沉 ≥${SQUAT_V1.validDepthHipDrop.toFixed(2)}×躯干长`, icon: 'amplitude', tone: 'blue' },
      { key: 'stability', label: '稳定性', note: `左右膝高差 ≤${SQUAT_V1.kneeHeightDiffMax.toFixed(2)}×躯干长`, icon: 'stability', tone: 'green' },
      { key: 'symmetry', label: '膝部轨迹', note: `膝间距比 ≥${SQUAT_V1.kneeValgusMaxRatio.toFixed(2)}，避免向内偏移`, icon: 'symmetry', tone: 'green' },
      { key: 'tempo', label: '节奏', note: `推荐 ${SQUAT_V1.repDurationMinMs / 1000}–${SQUAT_V1.repDurationMaxMs / 1000} 秒 / 次`, icon: 'tempo', tone: 'blue' },
    ],
    phaseLabels: {
      STANDING: '站立',
      DESCENDING: '下蹲',
      BOTTOM: '底部',
      ASCENDING: '起身',
      COMPLETE: '完成',
    },
    cameraDemo: {
      portraitSrc: '/assets/coach-squat.png',
      landscapeSrc: '/assets/camera-squat-demo.png',
      alt: '演示模式中的徒手深蹲人物',
      sequence: [
        { id: 'STANDING', src: '/assets/squat-demo-standing.png', durationMs: 2400 },
        { id: 'DESCENDING', src: '/assets/squat-demo-half.png', durationMs: 1000 },
        { id: 'BOTTOM', src: '/assets/squat-demo-bottom.png', durationMs: 1000 },
        { id: 'ASCENDING', src: '/assets/squat-demo-half.png', durationMs: 1000 },
        { id: 'STANDING_RETURN', src: '/assets/squat-demo-standing.png', durationMs: 1800 },
      ],
    },
  },
  getDebugData: ({ features, state }) => [
    { label: 'hipDrop', value: (features?.hipDrop ?? 0).toFixed(3) },
    { label: 'standingHipY', value: features?.baselineReady ? (features.standingHipY).toFixed(3) : 'pending' },
    { label: 'kneeSpreadRatio', value: (features?.kneeSpreadRatio ?? 0).toFixed(2) },
    { label: 'kneeHeightDiff', value: (features?.kneeHeightDiff ?? 0).toFixed(3) },
    { label: 'torsoLateralLean', value: `${(features?.torsoLean ?? 0).toFixed(1)}°` },
    { label: 'hipVelocity', value: (features?.hipVerticalVelocity ?? 0).toFixed(3) },
    { label: 'hipKneeSeparation', value: (features?.hipKneeSeparation ?? 0).toFixed(3) },
    { label: 'Baseline', value: state.baselineReady || features?.baselineReady ? 'ready' : 'not ready' },
  ],
  isPoseCompatible: () => true,
}
