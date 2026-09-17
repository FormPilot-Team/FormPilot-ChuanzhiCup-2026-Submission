import { describe, expect, it } from 'vitest'
import { CourseController } from '../src/features/course/CourseController'
import { ELECTRONIC_COACH_COURSE_V1 } from '../src/features/course/CourseDefinition'

describe('Phase 5 course definition and orchestration', () => {
  it('freezes the six-step order, targets, and evaluation modes', () => {
    expect(ELECTRONIC_COACH_COURSE_V1.steps.map((step) => step.exerciseId)).toEqual([
      'shoulder_rotation','overhead_raise','lateral_raise','step_jack','squat','knee_raise',
    ])
    expect(ELECTRONIC_COACH_COURSE_V1.steps.map((step) => [step.target.type, step.target.value])).toEqual([
      ['duration',15],['reps',6],['reps',6],['cycles',6],['reps',6],['reps',10],
    ])
    expect(ELECTRONIC_COACH_COURSE_V1.steps[0].evaluationMode).toBe('guidance')
    expect(ELECTRONIC_COACH_COURSE_V1.steps.slice(1).every((step) => step.evaluationMode === 'scored')).toBe(true)
  })

  it('requires readiness, runs 3-2-1, transitions, and advances', () => {
    const course = new CourseController({ ...ELECTRONIC_COACH_COURSE_V1, transitionMs: 1500 })
    expect(course.update(0,{ready:false,progress:0,target:15}).state).toBe('PREPARING')
    expect(course.update(100,{ready:true,progress:0,target:15}).state).toBe('COUNTDOWN')
    expect(course.update(1100,{ready:true,progress:0,target:15}).countdown).toBe(2)
    expect(course.update(2100,{ready:true,progress:0,target:15}).countdown).toBe(1)
    expect(course.update(3100,{ready:true,progress:0,target:15}).state).toBe('ACTIVE')
    expect(course.update(18100,{ready:true,progress:15,target:15}).state).toBe('TRANSITION')
    const next = course.update(19600,{ready:true,progress:15,target:15})
    expect(next).toMatchObject({ state:'PREPARING', stepIndex:1 })
  })

  it('freezes countdown and timers while paused', () => {
    const course = new CourseController(ELECTRONIC_COACH_COURSE_V1)
    course.update(0,{ready:true,progress:0,target:15}); course.update(1000,{ready:true,progress:0,target:15})
    course.pause(1200); expect(course.update(8000,{ready:true,progress:0,target:15}).state).toBe('PAUSED')
    course.resume(8200); expect(course.update(9000,{ready:true,progress:0,target:15}).countdown).toBe(1)
  })

  it('freezes ACTIVE elapsed time while paused and resumes from the same point', () => {
    const course = new CourseController(ELECTRONIC_COACH_COURSE_V1)
    course.update(0,{ready:true,progress:0,target:15}); course.update(3000,{ready:true,progress:0,target:15})
    expect(course.update(4000,{ready:true,progress:1,target:15}).elapsedMs).toBe(1000)
    course.pause(4500)
    expect(course.update(10000,{ready:true,progress:1,target:15})).toMatchObject({ state:'PAUSED', elapsedMs:1000 })
    course.resume(10500)
    expect(course.update(11000,{ready:true,progress:2,target:15})).toMatchObject({ state:'ACTIVE', elapsedMs:2000 })
  })

  it('freezes TRANSITION remaining time while paused', () => {
    const definition = { ...ELECTRONIC_COACH_COURSE_V1, countdownSeconds:0, transitionMs:1500 }
    const course = new CourseController(definition)
    course.update(0,{ready:true,progress:0,target:15})
    expect(course.update(100,{ready:true,progress:15,target:15}).state).toBe('TRANSITION')
    course.update(600,{ready:true,progress:15,target:15})
    course.pause(600)
    expect(course.update(5000,{ready:true,progress:15,target:15}).transitionRemainingMs).toBe(1000)
    course.resume(5000)
    expect(course.update(5500,{ready:true,progress:15,target:15})).toMatchObject({ state:'TRANSITION', transitionRemainingMs:500 })
    expect(course.update(6000,{ready:true,progress:15,target:15})).toMatchObject({ state:'PREPARING', stepIndex:1 })
  })

  it('reaches COURSE_COMPLETE after the final step transition', () => {
    const definition = { ...ELECTRONIC_COACH_COURSE_V1, countdownSeconds:0, transitionMs:100, steps:[ELECTRONIC_COACH_COURSE_V1.steps[5]] }
    const course = new CourseController(definition)
    course.update(0,{ready:true,progress:0,target:10})
    expect(course.update(10,{ready:true,progress:10,target:10}).state).toBe('TRANSITION')
    expect(course.update(110,{ready:true,progress:10,target:10}).state).toBe('COURSE_COMPLETE')
  })

  it('marks a manual end as incomplete', () => {
    const course = new CourseController(ELECTRONIC_COACH_COURSE_V1)
    expect(course.manualEnd().state).toBe('COURSE_INCOMPLETE')
  })
})
