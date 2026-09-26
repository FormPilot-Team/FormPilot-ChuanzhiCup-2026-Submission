import type { CourseState } from '../course/CourseController'
import type { ExerciseDefinition } from '../exercises/contract'
import type { FeedbackEvent } from '../feedback/types'
import type { BaseMotionFeatures } from '../motion/types'
import type { ExerciseState } from '../exercises/types'
import type { RoutineChapter, RoutineProgram } from '../routines/types'
import { REQUIREMENTS } from '../workshop/catalog'
import { goalText } from '../workshop/definition'
import type { RecognitionSetup, RecognizerSnapshot } from '../workshop/recognition/recognizer'
import type { CustomActionDefinition } from '../workshop/types'
import type { CoachExerciseGuide } from '../aiCoach/types'
import type { CoachContext } from './types'

/** 热身训练: the current exercise, its latest feedback and progress, as the training page shows them. */
export function buildWarmUpCoachContext(input: {
  definition: ExerciseDefinition<BaseMotionFeatures, ExerciseState>
  position: { index: number; total: number }
  freeTraining: boolean
  courseState: CourseState
  progress: number
  target: number
  targetUnit: '次' | '组' | '秒'
  score: number | null
  feedback?: FeedbackEvent
}): CoachContext {
  const { definition } = input
  return {
    currentMode: { id: 'smart-training', title: input.freeTraining ? `自由训练 · ${definition.displayName}` : '热身训练', kind: 'smart-training' },
    currentExercise: {
      id: definition.id,
      name: definition.displayName,
      position: input.freeTraining ? undefined : `${input.position.index + 1} / ${input.position.total}`,
      cue: definition.presentation.guidance,
    },
    currentFeedback: input.feedback ? { code: input.feedback.code ?? 'FEEDBACK', message: input.feedback.message, tone: input.feedback.kind === 'correction' ? 'warning' : 'success' } : null,
    sessionStats: {
      state: input.courseState,
      elapsedSeconds: 0,
      totalSeconds: null,
      metrics: { progress: input.progress, target: input.target, score: input.score },
      unit: input.targetUnit,
    },
    recentReports: [],
  }
}

export function warmUpGuide(definition: ExerciseDefinition<BaseMotionFeatures, ExerciseState>, unit: string): CoachExerciseGuide {
  const presentation = definition.presentation
  return {
    howTo: presentation.guidance,
    keyPoints: [presentation.phaseHint, presentation.adviceFallback].filter(Boolean),
    checks: presentation.metrics.slice(0, 4).map((metric) => `${metric.label}（${metric.note}）`).concat(`计次单位：${unit}`),
  }
}

export function routineGuide(program: RoutineProgram, chapter: RoutineChapter): CoachExerciseGuide {
  return {
    howTo: chapter.cue,
    keyPoints: [`跟着${program.title}标准视频的口令和节奏练习`, '镜像跟练（与示范左右相反）同样有效'],
    checks: ['与示范视频同一时刻的身体姿态（上肢、躯干、下肢）', '节奏：是否跟上视频'],
  }
}

/** 我的动作: the user's own poses and 识别重点 are the whole definition of the exercise. */
export function buildCustomCoachContext(input: {
  action: CustomActionDefinition
  setup: RecognitionSetup
  courseState: CourseState
  count: number
  target: number
  snapshot: RecognizerSnapshot | null
}): CoachContext {
  const { action, snapshot } = input
  const failed = snapshot?.lastRep?.failed[0]
  return {
    currentMode: { id: 'custom-action', title: action.name, kind: 'custom-action' },
    currentExercise: { id: action.id, name: action.name, cue: action.finishPose.description || undefined },
    currentFeedback: snapshot?.feedback && snapshot.feedback.tone !== 'info'
      ? { code: snapshot.feedback.code, message: snapshot.feedback.message, tone: snapshot.feedback.tone }
      : failed ? { code: `REQUIREMENT_${failed.toUpperCase().replaceAll('-', '_')}`, message: REQUIREMENTS[failed].feedback, tone: 'warning' } : null,
    sessionStats: {
      state: input.courseState,
      elapsedSeconds: 0,
      totalSeconds: null,
      metrics: {
        progress: input.count,
        target: input.target,
        passed: snapshot?.passedReps ?? 0,
        position: snapshot?.progress === null || snapshot?.progress === undefined ? null : Math.round(snapshot.progress * 100),
      },
      unit: action.goal.type === 'duration' ? '秒' : '次',
    },
    recentReports: [],
  }
}

export function customGuide(action: CustomActionDefinition, setup: RecognitionSetup): CoachExerciseGuide {
  const start = action.startPose.description || '开始姿势'
  const finish = action.finishPose.description || '完成姿势'
  return {
    howTo: action.goal.type === 'duration'
      ? `做到「${finish}」并保持住，累计 ${goalText(action.goal)}`
      : `从「${start}」出发，做到「${finish}」，再回到开始姿势，算一次；目标 ${goalText(action.goal)}`,
    keyPoints: setup.requirements.filter((item) => item.id !== 'full-return').map((item) => `${REQUIREMENTS[item.id].label}：${REQUIREMENTS[item.id].description}`),
    checks: setup.mode === 'pose-match' ? ['和你示范的开始、完成姿势比较，判断做到了哪一步'] : ['按动作模板的信号判断动作进度'],
  }
}
