import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { analyzeTraining, isCourseFlow } from '../src/features/analysis'
import { CourseController } from '../src/features/course/CourseController'
import { ELECTRONIC_COACH_COURSE_V1 } from '../src/features/course/CourseDefinition'
import { createFreeTrainingCourse } from '../src/features/course/freeTraining'
import {
  buildTrainingHistoryItems, buildTrainingHistoryOverview, historyScoreText, isReliableFullCourse,
} from '../src/features/history/TrainingHistory'
import { MemoryTrainingSessionRepository } from '../src/features/training/MemoryTrainingSessionRepository'
import { TrainingSession } from '../src/features/training/TrainingSession'
import { freeTrainingLabel, resolveTrainingScope } from '../src/features/training/trainingScope'
import type { TrainingSessionState } from '../src/features/training/types'
import { TrainingHistoryView } from '../src/pages/History/TrainingHistoryPage'
import { TrainingReportView } from '../src/pages/Report/TrainingReportPage'
import { freeTrainingSummary } from '../src/pages/Report/reportPresentation'
import { FIRST_SESSION, at, makeSession } from './analysis-fixtures'

type ExerciseId = TrainingSessionState['exerciseOrder'][number]

function freeSession(id: string, day: number, exerciseId: ExerciseId, overrides: Parameters<typeof makeSession>[0]['exercises'] = undefined, courseStatus: 'completed' | 'incomplete' = 'completed') {
  return makeSession({ id, startedAt: at(day), include: [exerciseId], exerciseOrder: [exerciseId], courseStatus, exercises: overrides })
}

function course(id: string, day: number) {
  return makeSession({ id, startedAt: at(day) })
}

describe('free training course and session', () => {
  it('builds a one-step course from the standard course step, and rejects anything else', () => {
    for (const step of ELECTRONIC_COACH_COURSE_V1.steps) {
      const free = createFreeTrainingCourse(step.exerciseId)
      expect(free.steps).toEqual([step])
      expect(free.countdownSeconds).toBe(ELECTRONIC_COACH_COURSE_V1.countdownSeconds)
      expect(free.transitionMs).toBe(ELECTRONIC_COACH_COURSE_V1.transitionMs)
    }
    expect(() => createFreeTrainingCourse('jumping_jack' as ExerciseId)).toThrow()
    expect(ELECTRONIC_COACH_COURSE_V1.steps).toHaveLength(6)
  })

  it('runs the unchanged CourseController flow and completes after its only step', () => {
    const controller = new CourseController(createFreeTrainingCourse('squat'))
    expect(controller.update(0, { ready: true, progress: 0, target: 6 }).state).toBe('COUNTDOWN')
    expect(controller.update(3_000, { ready: true, progress: 0, target: 6 }).state).toBe('ACTIVE')
    expect(controller.update(9_000, { ready: true, progress: 6, target: 6 }).state).toBe('TRANSITION')
    expect(controller.update(11_000, { ready: true, progress: 6, target: 6 })).toMatchObject({ state: 'COURSE_COMPLETE', stepIndex: 0 })
  })

  it('records a single-exercise order with the course target, which analysis-v1 reads as NOT_COURSE_FLOW', () => {
    const repository = new MemoryTrainingSessionRepository()
    const session = new TrainingSession(1_000, repository, ['squat'], 'live', 'normal')
    session.start()
    const finished = session.finish(90_000, 'completed')
    expect(finished).toMatchObject({ exerciseOrder: ['squat'], activeExerciseId: 'squat', source: 'live', mode: 'normal', courseStatus: 'completed' })
    expect(finished.exercises.map((item) => item.exerciseId)).toEqual(['squat'])
    expect(finished.exercises[0]).toMatchObject({ evaluationMode: 'scored', targetType: 'reps', targetValue: 6 })
    expect(repository.get(finished.id)?.exerciseOrder).toEqual(['squat'])
    expect(isCourseFlow(finished)).toBe(false)
    expect(resolveTrainingScope(finished)).toEqual({ kind: 'free_training', exerciseId: 'squat' })
  })

  it('tells full courses, free training and legacy standalone chains apart for presentation', () => {
    expect(resolveTrainingScope(FIRST_SESSION)).toEqual({ kind: 'full_course' })
    expect(resolveTrainingScope(freeSession('f', 1, 'knee_raise'))).toEqual({ kind: 'free_training', exerciseId: 'knee_raise' })
    const chain = makeSession({ id: 'chain', startedAt: at(1), exerciseOrder: ['lateral_raise', 'step_jack', 'squat', 'knee_raise'] })
    expect(resolveTrainingScope(chain)).toEqual({ kind: 'other' })
    expect(freeTrainingLabel('step_jack')).toBe('自由训练 · 侧步开合')
  })
})

describe('free training under analysis-v1 (unchanged)', () => {
  const free = freeSession('free-squat', 3, 'squat')

  it('never produces a full-course score, a comparison or an overall delta', () => {
    const analysis = analyzeTraining(free, [course('c1', 1), course('c2', 2), free])
    expect(analysis.courseComplete).toBe(false)
    expect(analysis.overall.scope).toBe('COMPLETED_EXERCISES')
    expect(analysis.overall.score).not.toBeNull()
    expect(analysis.overall).toMatchObject({ scoredExerciseCount: 1, previousScore: null, delta: null, trend: null })
    expect(analysis.comparison).toMatchObject({ level: 'NONE', reason: 'CURRENT_NOT_COURSE_FLOW', overallDeltaAllowed: false })
    expect(analysis.dataQuality.sessionFlags).toContain('NOT_COURSE_FLOW')
    expect(analysis.capability.radarAvailable).toBe(false)
  })

  it('is never selected as the previous session of a full course', () => {
    const later = course('later', 4)
    const onlyFree = analyzeTraining(later, [free])
    expect(onlyFree.comparison).toMatchObject({ level: 'NONE', reason: 'NO_ELIGIBLE_PREVIOUS' })
    expect(onlyFree.comparison.excluded).toContainEqual({ sessionId: 'free-squat', reasons: ['NOT_COURSE_FLOW'] })
    const withCourse = analyzeTraining(later, [course('c1', 1), free])
    expect(withCourse.comparison).toMatchObject({ level: 'FULL', previousSessionId: 'c1' })
  })

  it('stays out of the long-term course trend while History still lists it as a finished free training', () => {
    const sessions = [course('c1', 1), course('c2', 2), free, course('c3', 4)]
    const items = buildTrainingHistoryItems(sessions)
    const freeItem = items.find((item) => item.session.id === 'free-squat')
    expect(freeItem).toMatchObject({ scope: { kind: 'free_training', exerciseId: 'squat' }, incomplete: false, legacy: false })
    expect(isReliableFullCourse(freeItem!.analysis)).toBe(false)
    const overview = buildTrainingHistoryOverview(items.map((item) => item.analysis))
    expect(overview.reliableSessionCount).toBe(3)
    expect(overview.trendSessions.map((item) => item.sessionId)).toEqual(['c1', 'c2', 'c3'])
    expect(historyScoreText(freeItem!.analysis, freeItem!.scope)).toMatch(/^已完成动作平均分 \d+$/)

    const html = renderToStaticMarkup(createElement(TrainingHistoryView, { items, overview }))
    const cardStart = html.indexOf('data-testid="history-card-free-squat"')
    const cardHtml = html.slice(cardStart, html.indexOf('</article>', cardStart))
    expect(cardHtml).toContain('自由训练 · 徒手深蹲')
    expect(cardHtml).toContain('训练完成')
    expect(cardHtml).not.toContain('综合评分')
    expect(html).toContain('href="/report/free-squat"')
  })

  it('treats an early-ended free training as unfinished and a finished warm-up as unscored', () => {
    const early = freeSession('early', 5, 'lateral_raise', { lateral_raise: { reps: 3 } }, 'incomplete')
    const warmup = freeSession('warmup', 6, 'shoulder_rotation')
    const [warmupItem, earlyItem] = buildTrainingHistoryItems([early, warmup])
    expect(earlyItem).toMatchObject({ scope: { kind: 'free_training', exerciseId: 'lateral_raise' }, incomplete: true })
    expect(warmupItem).toMatchObject({ scope: { kind: 'free_training', exerciseId: 'shoulder_rotation' }, incomplete: false })
    expect(historyScoreText(warmupItem.analysis, warmupItem.scope)).toBe('热身引导 · 不计分')
    expect(historyScoreText(earlyItem.analysis, earlyItem.scope)).toBe('暂无可靠评分')
  })
})

describe('free training report presentation', () => {
  const free = freeSession('free-squat', 3, 'squat', { squat: { raw: (index) => index % 2 === 0 ? { minKneeSpreadRatio: 0.66 } : undefined } })
  const analysis = analyzeTraining(free, [course('c1', 1), free])
  const html = renderToStaticMarkup(createElement(TrainingReportView, { analysis, session: free }))

  it('labels the report as free training and keeps the completed-exercises scope, with no course comparison', () => {
    expect(html).toContain('自由训练 · 徒手深蹲 · 已完成')
    expect(html).toContain('已完成动作平均分')
    expect(html).not.toContain('>综合评分<')
    expect(html).toContain('自由训练只评估本次动作，不参与完整课程的历史对比和长期趋势。')
    expect(html).toContain('训练动作')
    expect(html).toContain('徒手深蹲 · 6 / 6 次')
    expect(html).not.toContain('data-testid="report-progress"')
  })

  it('shows only the trained exercise and no five-dimension section', () => {
    expect(html).toContain('data-testid="exercise-report-squat"')
    for (const id of ['shoulder_rotation', 'overhead_raise', 'lateral_raise', 'step_jack', 'knee_raise']) {
      expect(html).not.toContain(`data-testid="exercise-report-${id}"`)
    }
    expect(html).not.toContain('data-testid="report-capabilities"')
    expect(html).not.toContain('肩部环绕属于热身引导')
  })

  it('rewords only the course-scoped summary sentences, from the same analysis numbers', () => {
    expect(analysis.summary[0].text).toContain('本次训练未完成')
    const summary = freeTrainingSummary(analysis, 'squat')
    expect(summary).toHaveLength(analysis.summary.length)
    const squat = analysis.exercises.find((item) => item.exerciseId === 'squat')
    expect(summary[0]).toEqual({ ...analysis.summary[0], text: `本次自由训练完成徒手深蹲 6 / 6 次，得分 ${squat?.score} 分。` })
    summary.slice(1).forEach((sentence, index) => expect(sentence).toEqual(analysis.summary[index + 1]))
    expect(html).not.toContain('本次训练未完成')
    expect(html).not.toContain('本次有动作未开始')
    expect(html).toContain('本次最需要关注：')
  })

  it('never lets a free training claim a score that analysis-v1 did not give', () => {
    const early = freeSession('early', 5, 'squat', { squat: { reps: 2 } }, 'incomplete')
    const earlyAnalysis = analyzeTraining(early, [])
    expect(earlyAnalysis.overall.scope).toBe('UNAVAILABLE')
    const earlyHtml = renderToStaticMarkup(createElement(TrainingReportView, { analysis: earlyAnalysis, session: early }))
    expect(earlyHtml).toContain('自由训练 · 徒手深蹲 · 未完成')
    expect(earlyHtml).toContain('暂不评分')
    expect(earlyHtml).toContain('本次自由训练提前结束，徒手深蹲完成 2 / 6 次。')
    expect(earlyHtml).toContain('本次徒手深蹲有效识别次数不足，分析范围有限。')

    const warmup = freeSession('warmup', 6, 'shoulder_rotation')
    const warmupHtml = renderToStaticMarkup(createElement(TrainingReportView, { analysis: analyzeTraining(warmup, []), session: warmup }))
    expect(warmupHtml).toContain('自由训练 · 肩部环绕 · 已完成')
    expect(warmupHtml).toContain('热身引导，不计分')
    expect(warmupHtml).toContain('data-testid="exercise-report-shoulder_rotation"')
    expect(warmupHtml).toContain('本次自由训练完成了肩部环绕热身引导，该动作不计分。')
    expect(warmupHtml).toContain('肩部环绕属于热身引导，不做动作问题分析。')
  })

  it('leaves full-course reports exactly as analysed', () => {
    const courseAnalysis = analyzeTraining(FIRST_SESSION, [])
    const courseHtml = renderToStaticMarkup(createElement(TrainingReportView, { analysis: courseAnalysis, session: FIRST_SESSION }))
    expect(courseHtml).not.toContain('自由训练')
    expect(courseHtml).toContain('综合评分')
    expect(courseHtml).toContain('data-testid="report-capabilities"')
    for (const sentence of courseAnalysis.summary) expect(courseHtml).toContain(sentence.text)
  })
})
