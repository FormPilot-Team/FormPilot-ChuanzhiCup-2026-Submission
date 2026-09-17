import type { ExerciseDefinition } from '../contract'
import type { StepJackFeatures } from '../../motion/types'
import { StepJackFeatureExtractor } from './FeatureExtractor'
import { createStepJackEngine } from './engine'
import type { StepJackStateSnapshot } from './stateMachine'
import { STEP_JACK_REFERENCE } from '../../referencePose/definitions'
import { ENGINEERING_THRESHOLD_VERSION, EXERCISE_SPEC_VERSION } from '../thresholdVersioning'
import { STEP_JACK_V1 } from './config'
import { COACH_CORRECTIONS } from '../../coach/correctionPresentation'

export const stepJackDefinition: ExerciseDefinition<StepJackFeatures, StepJackStateSnapshot> = {
  id: 'step_jack',
  displayName: '侧步开合',
  specVersion: EXERCISE_SPEC_VERSION,
  thresholdVersion: ENGINEERING_THRESHOLD_VERSION,
  createFeatureExtractor: () => new StepJackFeatureExtractor(),
  createEngine: () => createStepJackEngine(),
  reference: STEP_JACK_REFERENCE,
  presentation: {
    subtitle: '侧步开合专项',
    guidance: '左右交替侧步，双臂与脚步同时向上打开',
    adviceFallback: '左右交替侧步，保持手脚同步和核心稳定。',
    phaseHint: '保持动作完整，平稳回到中间位置',
    coach: {
      preparationText: '请后退一些，确保全身完整入镜，双脚回到中间位置',
      activeText: '保持手脚协调',
      corrections: COACH_CORRECTIONS.step_jack,
    },
    targetReps: 8,
    fastTargetReps: 2,
    durationSeconds: 45,
    initialPhase: 'CENTER',
    metrics: [
      { key: 'amplitude', label: '动作幅度', note: `步幅 ≥${STEP_JACK_V1.openMinRatio.toFixed(2)}×，手臂 ≥${STEP_JACK_V1.armTopMinAngle}°`, icon: 'amplitude', tone: 'blue' },
      { key: 'coordination', label: '协调性', note: `手脚同步差建议 ≤${(STEP_JACK_V1.syncAcceptableMs / 1000).toFixed(2)} 秒`, icon: 'coordination', tone: 'green' },
      { key: 'stability', label: '稳定性', note: `核心稳定，躯干倾斜 ≤${STEP_JACK_V1.torsoLeanMax}°`, icon: 'stability', tone: 'green' },
      { key: 'tempo', label: '节奏', note: `推荐 ${STEP_JACK_V1.repDurationMinMs / 1000}–${STEP_JACK_V1.repDurationMaxMs / 1000} 秒 / 侧`, icon: 'tempo', tone: 'blue' },
    ],
    phaseLabels: {
      CENTER: '中间位', LEFT_OPENING: '左侧打开', LEFT_OPEN: '左侧展开', RETURNING_FROM_LEFT: '左侧回收',
      RIGHT_OPENING: '右侧打开', RIGHT_OPEN: '右侧展开', RETURNING_FROM_RIGHT: '右侧回收',
    },
    cameraDemo: {
      portraitSrc: '/assets/coach-step-jack.png',
      landscapeSrc: '/assets/camera-step-jack-demo.png',
      alt: '演示模式中的侧步开合左侧打开人物',
    },
  },
  getDebugData: ({ features, state }) => [
    { label: 'Open ratio', value: (features?.openRatio ?? 0).toFixed(2) },
    { label: 'Mean arm angle', value: `${(features?.meanShoulderAngle ?? 0).toFixed(1)}°` },
    { label: 'Arm angle diff', value: `${(features?.armAngleDiff ?? 0).toFixed(1)}°` },
    { label: 'Current side', value: state.activeSide ?? 'center' },
    { label: 'Sync gap', value: state.armOpenAt !== undefined && state.legOpenAt !== undefined ? `${Math.abs(state.armOpenAt - state.legOpenAt)} ms` : 'pending' },
    { label: 'Torso lean', value: `${(features?.torsoLean ?? 0).toFixed(1)}°` },
  ],
  isPoseCompatible: () => true,
}
