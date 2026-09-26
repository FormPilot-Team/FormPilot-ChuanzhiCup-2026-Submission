import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  HISTORY_PATH, SMART_TRAINING_PATH, TRAINING_PATH, freeTrainingPath, isTrainingRoute, reportPath, trainingEntryPath,
} from '../src/app/routes'
import { ELECTRONIC_COACH_COURSE_V1 } from '../src/features/course/CourseDefinition'
import { getExerciseDefinition } from '../src/features/exercises/registry'
import { SmartTrainingPage } from '../src/pages/SmartTraining/SmartTrainingPage'
import { FREE_TRAINING_OPTIONS } from '../src/pages/SmartTraining/freeTrainingOptions'

const page = () => renderToStaticMarkup(createElement(SmartTrainingPage))

describe('smart-training routes', () => {
  it('keeps the full course on the standard /train entry and puts free training on the same page', () => {
    expect(SMART_TRAINING_PATH).toBe('/smart-training')
    expect(TRAINING_PATH).toBe('/train')
    expect(HISTORY_PATH).toBe('/history')
    expect(freeTrainingPath('squat')).toBe('/train?exercise=squat')
    expect(trainingEntryPath({ kind: 'full_course' })).toBe('/train')
    expect(trainingEntryPath({ kind: 'other' })).toBe('/train')
    expect(trainingEntryPath({ kind: 'free_training', exerciseId: 'knee_raise' })).toBe('/train?exercise=knee_raise')
    expect(reportPath('a b')).toBe('/report/a%20b')
  })

  it('recognises the training page, including legacy diagnostic URLs, and nothing else', () => {
    expect(isTrainingRoute('/train', '')).toBe(true)
    expect(isTrainingRoute('/train', '?exercise=squat')).toBe(true)
    expect(isTrainingRoute('/', '?demo=1&course=1')).toBe(true)
    expect(isTrainingRoute('/', '?exercise=squat')).toBe(true)
    expect(isTrainingRoute('/', '')).toBe(false)
    expect(isTrainingRoute('/', '?utm=1')).toBe(false)
    expect(isTrainingRoute('/smart-training', '?exercise=squat')).toBe(false)
    expect(isTrainingRoute('/history', '')).toBe(false)
  })
})

describe('free-training options', () => {
  it('offers the six course exercises in course order with their own course targets', () => {
    expect(FREE_TRAINING_OPTIONS.map((item) => item.exerciseId)).toEqual(ELECTRONIC_COACH_COURSE_V1.steps.map((step) => step.exerciseId))
    expect(FREE_TRAINING_OPTIONS.map((item) => [item.name, item.focus, item.target])).toEqual([
      ['肩部环绕', '热身 · 肩部活动', '目标 15 秒'],
      ['双臂上举', '上肢活动 · 肩部与手臂', '目标 6 次'],
      ['侧平举', '肩部控制', '目标 6 次'],
      ['侧步开合', '全身协调', '目标 6 组'],
      ['徒手深蹲', '下肢力量与控制', '目标 6 次'],
      ['交替提膝', '下肢协调与稳定', '目标 10 次'],
    ])
  })

  it('uses the same names the training page shows', () => {
    for (const option of FREE_TRAINING_OPTIONS) expect(option.name).toBe(getExerciseDefinition(option.exerciseId).displayName)
  })

  it('links each exercise to the product free-training URL and never to fast mode', () => {
    for (const option of FREE_TRAINING_OPTIONS) {
      expect(option.href).toBe(`/train?exercise=${option.exerciseId}`)
      expect(new URL(option.href, 'http://app.test').searchParams.has('fast')).toBe(false)
    }
  })
})

describe('smart-training entry page', () => {
  it('offers the full course first, with the product copy and the standard /train entry', () => {
    const html = page()
    expect(html).toContain('<h1')
    expect(html).toContain('热身训练')
    expect(html).not.toContain('智能训练')
    expect(html).toContain('完整训练')
    expect(html).toContain('依次完成 6 个动作，获得完整训练报告和历史比较。')
    expect(html).toContain(`href="${TRAINING_PATH}"`)
    expect(html).toContain('开始完整训练')
    expect(html.indexOf('完整训练')).toBeLessThan(html.indexOf('自由训练'))
  })

  it('lists the six exercises as free-training choices with a start action each', () => {
    const html = page()
    expect(html).toContain('选择一个动作单独练习，适合针对性训练。')
    for (const option of FREE_TRAINING_OPTIONS) {
      expect(html).toContain(`href="${option.href}"`)
      expect(html).toContain(`aria-label="开始${option.name}"`)
      expect(html).toContain(option.focus)
    }
    expect(html.match(/<a[^>]+data-testid="free-training-/g)).toHaveLength(6)
  })

  it('carries the preparation advice that used to live on Home', () => {
    const html = page()
    for (const text of ['训练过程中请根据动作提示调整站位，确保所需身体区域完整入镜', '进入下肢动作时，请确保全身完整可见', '摄像头画面仅用于本次实时识别']) {
      expect(html).toContain(text)
    }
  })

  it('never links to fast mode, has a way home, and a gesture guide button', () => {
    const html = page()
    expect(html).not.toMatch(/[?&]fast=/)
    expect(html).toContain('返回首页')
    expect(html).toContain('开始 / 暂停手势')
  })
})
