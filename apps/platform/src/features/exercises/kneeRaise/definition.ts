import type { KneeRaiseFeatures } from '../../motion/types'
import { KNEE_RAISE_REFERENCE } from '../../referencePose/definitions'
import type { ExerciseDefinition } from '../contract'
import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../thresholdVersioning'
import { KNEE_RAISE_V1 } from './config'
import { createKneeRaiseEngine } from './engine'
import { KneeRaiseFeatureExtractor } from './FeatureExtractor'
import type { KneeRaiseStateSnapshot } from './stateMachine'
import { COACH_CORRECTIONS } from '../../coach/correctionPresentation'

export const kneeRaiseDefinition: ExerciseDefinition<KneeRaiseFeatures, KneeRaiseStateSnapshot> = {
  id: 'knee_raise', displayName: '交替提膝', specVersion: EXERCISE_SPEC_VERSION,
  thresholdVersion: ENGINEERING_THRESHOLD_VERSION,
  createFeatureExtractor: () => new KneeRaiseFeatureExtractor(), createEngine: () => createKneeRaiseEngine(),
  reference: KNEE_RAISE_REFERENCE,
  presentation: {
    subtitle: '原地交替提膝专项', guidance: '先自然站稳，再将左膝与右膝依次抬近髋高，每次完整回到中间',
    adviceFallback: '保持身体居中，完整回位，并注意左右交替。', phaseHint: '请自然站立，准备开始',
    coach: { preparationText: '请自然站立，保持身体居中', activeText: '保持身体稳定，左右交替', corrections: COACH_CORRECTIONS.knee_raise },
    targetReps: 10, fastTargetReps: 2, durationSeconds: 45, initialPhase: 'CENTER',
    metrics: [
      { key: 'amplitude', label: '动作幅度', note: `膝部目标高度 ≥ ${KNEE_RAISE_V1.userTargetHeight.toFixed(2)}×躯干长`, icon: 'amplitude', tone: 'blue' },
      { key: 'stability', label: '稳定性', note: `侧倾 ≤${KNEE_RAISE_V1.torsoLeanMax}°，横移 ≤${KNEE_RAISE_V1.hipShiftMax.toFixed(2)}×肩宽`, icon: 'stability', tone: 'green' },
      { key: 'alternation', label: '左右交替', note: '左、右依次完成并完整回到中间', icon: 'coordination', tone: 'green' },
      { key: 'symmetry', label: '对称性', note: `左右峰值差 ≤${KNEE_RAISE_V1.peakHeightGapMax.toFixed(2)}×躯干长`, icon: 'symmetry', tone: 'blue' },
    ],
    phaseLabels: { CENTER: '站立中位', LEFT_RAISING: '左膝抬起', LEFT_TOP: '左侧顶部', LEFT_RETURNING: '左膝回落',
      RIGHT_RAISING: '右膝抬起', RIGHT_TOP: '右侧顶部', RIGHT_RETURNING: '右膝回落', COMPLETE: '单侧完成' },
    cameraDemo: {
      portraitSrc: '/assets/coach-knee-raise.png', landscapeSrc: '/assets/knee-raise-demo-center.png', alt: '演示模式中的原地交替提膝人物',
      fit: 'contain',
      sequence: [
        { id: 'CENTER', src: '/assets/knee-raise-demo-center.png', durationMs: 1800 },
        { id: 'LEFT_RAISING', src: '/assets/knee-raise-demo-left-half.png', durationMs: 500 },
        { id: 'LEFT_TOP', src: '/assets/knee-raise-demo-left-top.png', durationMs: 450 },
        { id: 'LEFT_RETURNING', src: '/assets/knee-raise-demo-left-half.png', durationMs: 500 },
        { id: 'CENTER_AFTER_LEFT', src: '/assets/knee-raise-demo-center.png', durationMs: 700 },
        { id: 'RIGHT_RAISING', src: '/assets/knee-raise-demo-right-half.png', durationMs: 500 },
        { id: 'RIGHT_TOP', src: '/assets/knee-raise-demo-right-top.png', durationMs: 450 },
        { id: 'RIGHT_RETURNING', src: '/assets/knee-raise-demo-right-half.png', durationMs: 500 },
        { id: 'CENTER_AFTER_RIGHT', src: '/assets/knee-raise-demo-center.png', durationMs: 1000 },
      ],
    },
  },
  getDebugData: ({ features, state, result }) => [
    { label: 'baselineReady', value: state.baselineReady || features?.baselineReady ? 'ready' : 'not ready' },
    { label: 'leftKneeHeight', value: (features?.leftKneeHeight ?? 0).toFixed(3) }, { label: 'rightKneeHeight', value: (features?.rightKneeHeight ?? 0).toFixed(3) },
    { label: 'leftKneeVelocity', value: (features?.leftKneeVelocity ?? 0).toFixed(3) }, { label: 'rightKneeVelocity', value: (features?.rightKneeVelocity ?? 0).toFixed(3) },
    { label: 'hipShift', value: (features?.hipHorizontalShift ?? 0).toFixed(3) }, { label: 'torsoLean', value: `${(features?.torsoLean ?? 0).toFixed(1)}°` },
    { label: 'currentSide', value: state.currentSide ?? 'none' }, { label: 'lastCompletedSide', value: state.lastCompletedSide ?? 'none' },
    { label: 'cycle count', value: String(state.cycleCount) }, { label: 'current score', value: String(result.currentScore) },
  ],
  isPoseCompatible: () => true,
}
