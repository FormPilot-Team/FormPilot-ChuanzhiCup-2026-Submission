import type { ExerciseId } from '../../features/exercises/types'
import type { CoachAnimationAdapter, CoachAnimationFrame } from './types'

const FRAMES: Record<ExerciseId, CoachAnimationFrame> = {
  shoulder_rotation: {
    src: '/assets/coach-shoulder-rotation.png', alt: 'AI 电子教练演示肩部环绕动作',
    caption: '双臂同步画大圈，保持连续呼吸和躯干稳定', canonicalPoseId: 'shoulder_rotation.ROTATING',
    poseAnchorSrc: '/assets/coach-shoulder-rotation.pose.json',
  },
  overhead_raise: {
    src: '/assets/coach-overhead-raise.png', alt: 'AI 电子教练演示双臂上举顶部动作',
    caption: '双臂伸直同步举过头顶，再有控制地回落', canonicalPoseId: 'overhead_raise.TOP',
    poseAnchorSrc: '/assets/coach-overhead-raise.pose.json',
    motionFrames: [
      { id: 'start', src: '/assets/overhead-raise-demo-start.png', durationMs: 900 },
      { id: 'half', src: '/assets/overhead-raise-demo-half.png', durationMs: 650 },
      { id: 'top', src: '/assets/overhead-raise-demo-top.png', durationMs: 800 },
      { id: 'half-return', src: '/assets/overhead-raise-demo-half.png', durationMs: 650 },
    ],
  },
  lateral_raise: {
    src: '/assets/coach-lateral-raise.png',
    alt: 'AI 电子教练演示侧平举顶部动作',
    caption: '保持核心收紧，手臂向两侧抬起，感受肩部发力',
    canonicalPoseId: 'lateral_raise.TOP',
    poseAnchorSrc: '/assets/coach-lateral-raise.pose.json',
  },
  step_jack: {
    src: '/assets/coach-step-jack.png',
    alt: 'AI 电子教练演示侧步开合左侧打开动作',
    caption: '左脚侧步打开，双臂同步上举，然后回到中间并左右交替',
    canonicalPoseId: 'step_jack.LEFT_OPEN',
    poseAnchorSrc: '/assets/coach-step-jack.pose.json',
  },
  squat: {
    src: '/assets/coach-squat.png',
    alt: 'AI 电子教练演示徒手深蹲底部动作',
    caption: '双脚约肩宽，髋部下沉，膝盖与脚尖同向，再完整站起',
    canonicalPoseId: 'squat.BOTTOM',
    poseAnchorSrc: '/assets/coach-squat.pose.json',
    motionFrames: [
      { id: 'standing', src: '/assets/squat-demo-standing.png', durationMs: 800 },
      { id: 'descending', src: '/assets/squat-demo-half.png', durationMs: 650 },
      { id: 'bottom', src: '/assets/squat-demo-bottom.png', durationMs: 700 },
      { id: 'ascending', src: '/assets/squat-demo-half.png', durationMs: 650 },
      { id: 'return', src: '/assets/squat-demo-standing.png', durationMs: 800 },
    ],
  },
  knee_raise: {
    src: '/assets/coach-knee-raise.png', alt: 'AI 电子教练演示左侧提膝顶部动作',
    caption: '身体保持居中，左膝与右膝依次抬近髋高，每次先完整回到站立位',
    canonicalPoseId: 'knee_raise.LEFT_TOP', poseAnchorSrc: '/assets/coach-knee-raise.pose.json',
    motionFrames: [
      { id: 'center', src: '/assets/knee-raise-demo-center.png', durationMs: 500 },
      { id: 'left-half', src: '/assets/knee-raise-demo-left-half.png', durationMs: 350 },
      { id: 'left-top', src: '/assets/knee-raise-demo-left-top.png', durationMs: 450 },
      { id: 'left-return', src: '/assets/knee-raise-demo-left-half.png', durationMs: 350 },
      { id: 'center-mid', src: '/assets/knee-raise-demo-center.png', durationMs: 500 },
      { id: 'right-half', src: '/assets/knee-raise-demo-right-half.png', durationMs: 350 },
      { id: 'right-top', src: '/assets/knee-raise-demo-right-top.png', durationMs: 450 },
      { id: 'right-return', src: '/assets/knee-raise-demo-right-half.png', durationMs: 350 },
      { id: 'center-return', src: '/assets/knee-raise-demo-center.png', durationMs: 500 },
    ],
  },
}

export function getCoachAnimationFrame(exerciseId: ExerciseId): CoachAnimationFrame {
  return FRAMES[exerciseId]
}

export class PlaceholderCoachAnimationAdapter implements CoachAnimationAdapter {
  private exerciseId: ExerciseId = 'shoulder_rotation'
  private playing = false
  private loop = true

  loadExercise(exerciseId: ExerciseId): void { this.exerciseId = exerciseId }
  play(): void { this.playing = true }
  pause(): void { this.playing = false }
  reset(): void { this.playing = false }
  setLoop(loop: boolean): void { this.loop = loop }
  getFrame(): CoachAnimationFrame {
    void this.playing
    void this.loop
    return getCoachAnimationFrame(this.exerciseId)
  }
}
