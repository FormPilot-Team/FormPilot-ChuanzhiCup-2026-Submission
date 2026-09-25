import type { CourseState } from '../course/CourseController'
import type { CoachCardViewModel } from './types'

export type CoachDockVisualState =
  | 'preparing'
  | 'ready'
  | 'active'
  | 'correcting'
  | 'recovery'
  | 'paused'
  | 'transition'
  | 'complete'

export type CoachDockSeverity = 'neutral' | 'info' | 'warning' | 'success'

export interface CoachDockExerciseContext {
  name: string
  guidance: string
  preparationText: string
  activeText: string
}

export interface CoachDockFeedback {
  message: string
  severity?: number
}

export interface ResolveCoachDockStateInput {
  courseState: CourseState
  poseReady: boolean
  activeCorrection?: CoachDockFeedback
  recovery?: CoachDockFeedback
  exercise: CoachDockExerciseContext
  nextExerciseName?: string
  isSpeaking?: boolean
}

export interface CoachDockState {
  visualState: CoachDockVisualState
  statusLabel: string
  primaryMessage: string
  severity: CoachDockSeverity
  exerciseContext: string
  isSpeaking?: boolean
}

const COPY = {
  waitingForPose: '进入镜头并保持全身可见，我会在动作开始后持续观察。',
  ready: '姿态已识别，保持准备位置。',
  paused: '训练已暂停，准备好后继续。',
  transition: '本动作已完成，稍作调整，准备下一项。',
  complete: '训练已完成，做得很好。',
  incomplete: '本次训练已结束。',
} as const

export function resolveCoachDockFeedback(viewModel: CoachCardViewModel): Pick<ResolveCoachDockStateInput, 'activeCorrection' | 'recovery'> {
  if (viewModel.state === 'CORRECTING') return { activeCorrection: { message: viewModel.primaryMessage } }
  if (viewModel.state === 'POSITIVE') return { recovery: { message: viewModel.primaryMessage } }
  return {}
}

export function resolveCoachDockState(input: ResolveCoachDockStateInput): CoachDockState {
  const shared = { exerciseContext: input.exercise.name, isSpeaking: input.isSpeaking }

  if (input.courseState === 'COURSE_COMPLETE' || input.courseState === 'COURSE_INCOMPLETE') {
    return {
      ...shared,
      visualState: 'complete',
      statusLabel: input.courseState === 'COURSE_COMPLETE' ? '训练完成' : '训练结束',
      primaryMessage: input.courseState === 'COURSE_COMPLETE' ? COPY.complete : COPY.incomplete,
      severity: input.courseState === 'COURSE_COMPLETE' ? 'success' : 'neutral',
    }
  }

  if (input.courseState === 'PAUSED') {
    return { ...shared, visualState: 'paused', statusLabel: '已暂停', primaryMessage: COPY.paused, severity: 'neutral' }
  }

  if (input.courseState === 'TRANSITION') {
    return {
      ...shared,
      visualState: 'transition',
      statusLabel: '本动作完成',
      primaryMessage: input.nextExerciseName ? `下一项：${input.nextExerciseName}。${COPY.transition}` : COPY.transition,
      severity: 'success',
    }
  }

  if (input.courseState === 'PREPARING') {
    return {
      ...shared,
      visualState: 'preparing',
      statusLabel: '准备中',
      primaryMessage: input.poseReady ? input.exercise.preparationText : COPY.waitingForPose,
      severity: 'info',
    }
  }

  if (input.courseState === 'COUNTDOWN') {
    return { ...shared, visualState: 'ready', statusLabel: '准备中', primaryMessage: COPY.ready, severity: 'info' }
  }

  if (input.activeCorrection) {
    return {
      ...shared,
      visualState: 'correcting',
      statusLabel: '动作纠正',
      primaryMessage: input.activeCorrection.message,
      severity: 'warning',
    }
  }

  if (input.recovery) {
    return {
      ...shared,
      visualState: 'recovery',
      statusLabel: '已调整',
      primaryMessage: input.recovery.message,
      severity: 'success',
    }
  }

  return {
    ...shared,
    visualState: 'active',
    statusLabel: '训练中',
    primaryMessage: input.exercise.activeText || input.exercise.guidance,
    severity: 'info',
  }
}
