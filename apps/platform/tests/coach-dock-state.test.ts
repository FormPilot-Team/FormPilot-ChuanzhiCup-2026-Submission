import { describe, expect, it } from 'vitest'
import { resolveCoachDockState, type ResolveCoachDockStateInput } from '../src/features/coach/coachDockState'

const base: ResolveCoachDockStateInput = {
  courseState: 'ACTIVE',
  poseReady: true,
  exercise: {
    name: '侧平举',
    guidance: '保持核心收紧',
    preparationText: '站稳并保持全身入镜',
    activeText: '双臂同步抬起',
  },
}

const resolve = (overrides: Partial<ResolveCoachDockStateInput> = {}) => resolveCoachDockState({ ...base, ...overrides })

describe('resolveCoachDockState', () => {
  it('maps PREPARING from real pose readiness', () => {
    expect(resolve({ courseState: 'PREPARING', poseReady: false })).toMatchObject({ visualState: 'preparing', statusLabel: '准备中' })
  })

  it('maps countdown to ready', () => {
    expect(resolve({ courseState: 'COUNTDOWN' })).toMatchObject({ visualState: 'ready', statusLabel: '准备中' })
  })

  it('maps a quiet ACTIVE state to existing exercise guidance', () => {
    expect(resolve()).toMatchObject({ visualState: 'active', primaryMessage: '双臂同步抬起' })
  })

  it('gives a correction priority over recovery and neutral guidance', () => {
    expect(resolve({ activeCorrection: { message: '右臂再抬高一些' }, recovery: { message: '已经恢复' } })).toMatchObject({
      visualState: 'correcting', primaryMessage: '右臂再抬高一些', severity: 'warning',
    })
  })

  it('shows recovery when no correction is active', () => {
    expect(resolve({ recovery: { message: '很好，保持这个高度' } })).toMatchObject({
      visualState: 'recovery', primaryMessage: '很好，保持这个高度', severity: 'success',
    })
  })

  it('maps PAUSED without inventing a course state', () => {
    expect(resolve({ courseState: 'PAUSED' })).toMatchObject({ visualState: 'paused', statusLabel: '已暂停' })
  })

  it('maps TRANSITION and names the next exercise', () => {
    expect(resolve({ courseState: 'TRANSITION', nextExerciseName: '徒手深蹲' })).toMatchObject({
      visualState: 'transition', statusLabel: '本动作完成',
    })
    expect(resolve({ courseState: 'TRANSITION', nextExerciseName: '徒手深蹲' }).primaryMessage).toContain('徒手深蹲')
  })

  it.each(['COURSE_COMPLETE', 'COURSE_INCOMPLETE'] as const)('maps %s to complete', (courseState) => {
    expect(resolve({ courseState }).visualState).toBe('complete')
  })

  it('keeps the optional voice synchronization interface passive', () => {
    expect(resolve({ isSpeaking: undefined }).isSpeaking).toBeUndefined()
  })
})
