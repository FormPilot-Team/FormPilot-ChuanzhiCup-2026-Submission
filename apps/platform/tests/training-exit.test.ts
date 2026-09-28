import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TrainingExitControl } from '../src/components/training/TrainingExitControl'
import { routineExitPhase, warmUpExitPhase } from '../src/features/training/trainingExit'

describe('training exit phase', () => {
  it('warm-up: leaves at once before the first exercise starts and after the course ends, asks in between', () => {
    expect(warmUpExitPhase({ sessionStatus: 'ready', courseState: 'PREPARING', exerciseIndex: 0 })).toBe('preparing')
    // Camera on, still waiting for the ready pose of the first exercise.
    expect(warmUpExitPhase({ sessionStatus: 'active', courseState: 'PREPARING', exerciseIndex: 0 })).toBe('preparing')
    expect(warmUpExitPhase({ sessionStatus: 'active', courseState: 'COUNTDOWN', exerciseIndex: 0 })).toBe('active')
    expect(warmUpExitPhase({ sessionStatus: 'active', courseState: 'ACTIVE', exerciseIndex: 0 })).toBe('active')
    expect(warmUpExitPhase({ sessionStatus: 'paused', courseState: 'PAUSED', exerciseIndex: 0 })).toBe('active')
    // A later exercise waiting in PREPARING is mid-course.
    expect(warmUpExitPhase({ sessionStatus: 'active', courseState: 'PREPARING', exerciseIndex: 2 })).toBe('active')
    expect(warmUpExitPhase({ sessionStatus: 'active', courseState: 'TRANSITION', exerciseIndex: 2 })).toBe('active')
    expect(warmUpExitPhase({ sessionStatus: 'completed', courseState: 'COURSE_COMPLETE', exerciseIndex: 5 })).toBe('complete')
    expect(warmUpExitPhase({ sessionStatus: 'active', courseState: 'COURSE_INCOMPLETE', exerciseIndex: 1 })).toBe('complete')
  })

  it('routine: preparing until the standard video starts, complete once it has ended', () => {
    expect(routineExitPhase({ sessionStatus: 'ready', courseState: 'PREPARING' })).toBe('preparing')
    expect(routineExitPhase({ sessionStatus: 'active', courseState: 'PREPARING' })).toBe('preparing')
    expect(routineExitPhase({ sessionStatus: 'active', courseState: 'COUNTDOWN' })).toBe('active')
    expect(routineExitPhase({ sessionStatus: 'active', courseState: 'ACTIVE' })).toBe('active')
    expect(routineExitPhase({ sessionStatus: 'paused', courseState: 'PAUSED' })).toBe('active')
    expect(routineExitPhase({ sessionStatus: 'active', courseState: 'TRANSITION' })).toBe('complete')
    expect(routineExitPhase({ sessionStatus: 'completed', courseState: 'COURSE_INCOMPLETE' })).toBe('complete')
  })

  it('renders one labelled back link carrying its phase', () => {
    const html = renderToStaticMarkup(createElement(TrainingExitControl, { href: '/smart-training', label: '返回热身训练', phase: 'active' }))
    expect(html).toContain('href="/smart-training"')
    expect(html).toContain('返回热身训练')
    expect(html).toContain('data-exit-phase="active"')
  })
})
