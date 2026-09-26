import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CapabilityRadar } from '../src/components/report/CapabilityRadar'
import { analyzeTraining } from '../src/features/analysis'
import type { TrainingAnalysis } from '../src/features/analysis'
import type { TrainingSessionRepository } from '../src/features/training/TrainingSessionRepository'
import type { TrainingSessionState } from '../src/features/training/types'
import {
  CapabilitySection, DataNotesSection, ExerciseReportCard, NextFocusSection, PriorityIssuesSection, ProgressSection,
  ReportHero, ReportNotFound, ReportReadError, TrainingAnalysisSection, TrainingReportView,
} from '../src/pages/Report/TrainingReportPage'
import { loadTrainingReportAnalysis } from '../src/pages/Report/useTrainingReportAnalysis'
import {
  FAST_SESSION, FIRST_SESSION, FULL_IMPROVEMENT, INVALID_REPS, LEGACY_SESSION,
  MISSING_TOP_ELBOW, PARTIAL_SESSION, POSE_QUALITY_ONLY, THEME_MERGE_AND_CAPS, at, makeSession,
} from './analysis-fixtures'

function markup(component: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(component)
}

function renderView(analysis: TrainingAnalysis, session: TrainingSessionState) {
  return markup(createElement(TrainingReportView, { analysis, session }))
}

function cloned<T>(value: T): T {
  return structuredClone(value)
}

function analysisOf(session: TrainingSessionState, history: TrainingSessionState[] = []) {
  return analyzeTraining(session, history)
}

describe('Training Report V2 analysis binding and overall scope', () => {
  it('renders the analysis-v1 recomputed 82 instead of stored aggregate 99', () => {
    const session = cloned(FIRST_SESSION)
    session.courseOverallScore = 99
    for (const exercise of session.exercises) {
      exercise.overallScore = 99
      exercise.metricAverages = { elbow: 99, amplitude: 99 }
      if (exercise.exerciseId !== 'shoulder_rotation') exercise.repetitions.forEach((rep) => { rep.score = 82 })
    }
    const analysis = analysisOf(session)
    expect(analysis.overall.score).toBe(82)
    const html = markup(createElement(ReportHero, { analysis, session }))
    const scoreBlock = html.match(/data-testid="overall-score-scope"[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(scoreBlock).toContain('>82<')
    expect(scoreBlock).not.toContain('>99<')
  })

  it('labels FULL_COURSE as 综合评分', () => {
    const html = markup(createElement(ReportHero, { analysis: analysisOf(FIRST_SESSION), session: FIRST_SESSION }))
    expect(html).toContain('综合评分')
  })

  it('labels COMPLETED_EXERCISES honestly and marks the session incomplete', () => {
    const analysis = analysisOf(PARTIAL_SESSION.current, PARTIAL_SESSION.history)
    const html = markup(createElement(ReportHero, { analysis, session: PARTIAL_SESSION.current }))
    expect(html).toContain('已完成动作平均分')
    expect(html).toContain('本次训练未完整完成')
    expect(html).not.toContain('>综合评分<')
  })

  it('renders UNAVAILABLE without a numeric zero', () => {
    const analysis = analysisOf(FAST_SESSION)
    const html = markup(createElement(ReportHero, { analysis, session: FAST_SESSION }))
    expect(html).toContain('暂不给出综合评分')
    expect(html).not.toContain('0 / 100')
    expect(html).not.toContain('>0<')
  })
})

describe('Training Report V2 comparison and summary', () => {
  it('shows FULL overall delta and comparison date', () => {
    const analysis = analysisOf(FULL_IMPROVEMENT.current, FULL_IMPROVEMENT.history)
    const html = markup(createElement(ReportHero, { analysis, session: FULL_IMPROVEMENT.current }))
    expect(html).toContain(`比上次提高 ${analysis.overall.delta} 分`)
    expect(html).toContain('对比')
  })

  it('shows PARTIAL common count and never an overall delta', () => {
    const analysis = analysisOf(PARTIAL_SESSION.current, PARTIAL_SESSION.history)
    const html = markup(createElement(ReportHero, { analysis, session: PARTIAL_SESSION.current }))
    expect(html).toContain('已与上次共同完成的 3 个动作进行对比')
    expect(html).not.toContain('比上次提高')
    expect(html).not.toContain('比上次降低')
  })

  it('shows the natural NONE reason for a first session', () => {
    const analysis = analysisOf(FIRST_SESSION)
    const html = markup(createElement(ReportHero, { analysis, session: FIRST_SESSION }))
    expect(html).toContain('这是第一条训练记录，暂无可对比的历史')
    expect(html).not.toContain('NO_PREVIOUS_SESSION')
  })

  it('keeps legacy comparison unavailable and exposes no historical delta', () => {
    const analysis = analysisOf(LEGACY_SESSION, [makeSession({ id: 'older', startedAt: at(0) })])
    const html = renderView(analysis, LEGACY_SESSION)
    expect(html).toContain('此记录来自旧版本，无法与当前训练可靠比较')
    expect(html).not.toContain('比上次提高')
  })

  it('renders summary sentences in their supplied order without generating new copy', () => {
    const analysis = analysisOf(FIRST_SESSION)
    const html = markup(createElement(TrainingAnalysisSection, { analysis }))
    let cursor = -1
    for (const sentence of analysis.summary) {
      const next = html.indexOf(sentence.text)
      expect(next).toBeGreaterThan(cursor)
      cursor = next
    }
  })
})

describe('Training Report V2 priority presentation', () => {
  it('renders a single issue with evidence and cue', () => {
    const analysis = analysisOf(FIRST_SESSION)
    const html = markup(createElement(PriorityIssuesSection, { analysis }))
    expect(html).toContain(analysis.priorityIssues[0].reportLabel)
    expect(html).toContain(analysis.priorityIssues[0].cue)
    expect(html).toContain('6 次中 4 次')
  })

  it('keeps SIDE_PAIR evidence separate by side', () => {
    const analysis = analysisOf(THEME_MERGE_AND_CAPS)
    const html = markup(createElement(PriorityIssuesSection, { analysis }))
    expect(html).toContain('左侧')
    expect(html).toContain('右侧')
    expect(html).not.toContain('8/12')
  })

  it('keeps THEME member evidence separate by exercise', () => {
    const analysis = analysisOf(THEME_MERGE_AND_CAPS)
    const html = markup(createElement(PriorityIssuesSection, { analysis }))
    expect(html).toContain('侧平举')
    expect(html).toContain('Step Jack')
    expect(html).toContain('徒手深蹲')
  })

  it('renders paired evidence using 组', () => {
    const paired = makeSession({
      id: 'paired-priority', startedAt: at(4),
      exercises: { knee_raise: { raw: (index) => ({ peakKneeHeight: index % 2 === 0 ? -0.02 : -0.2 }) } },
    })
    const analysis = analysisOf(paired)
    const html = markup(createElement(PriorityIssuesSection, { analysis }))
    expect(html).toContain('组中')
  })

  it('uses analysis summary for a no-priority sufficient-data state', () => {
    const analysis = analysisOf(POSE_QUALITY_ONLY)
    const html = markup(createElement(PriorityIssuesSection, { analysis }))
    expect(html).toContain(analysis.summary.find((item) => item.slot === 'NO_PRIORITY')?.text ?? '')
  })

  it('uses limited-data language instead of a fake no-issue conclusion', () => {
    const analysis = analysisOf(MISSING_TOP_ELBOW)
    const html = markup(createElement(PriorityIssuesSection, { analysis }))
    expect(html).toContain('手肘伸展仅有 3 次可判断，当前证据不足')
    expect(html).not.toContain('本次没有需要优先纠正的问题')
  })
})

describe('Training Report V2 exercise cards', () => {
  it('renders Shoulder Rotation as guidance without a score', () => {
    const analysis = analysisOf(FIRST_SESSION)
    const html = renderView(analysis, FIRST_SESSION)
    const card = html.match(/data-testid="exercise-report-shoulder_rotation"[\s\S]*?<\/details>/)?.[0] ?? ''
    expect(card).toContain('热身引导')
    expect(card).toContain('不计分')
    expect(card).not.toMatch(/\d+\s*分/)
  })

  it('renders the scored exercise value and takeaway from analysis', () => {
    const analysis = analysisOf(MISSING_TOP_ELBOW)
    const exercise = analysis.exercises.find((item) => item.exerciseId === 'overhead_raise')!
    const html = markup(createElement(ExerciseReportCard, { exercise }))
    expect(html).toContain(String(exercise.score))
    expect(html).toContain(exercise.takeaway ?? '')
  })

  it('renders STABLE as basically unchanged instead of progress', () => {
    const analysis = analysisOf(FIRST_SESSION)
    const exercise = cloned(analysis.exercises[0])
    exercise.previousScore = (exercise.score ?? 80) - 1
    exercise.scoreDelta = 1
    exercise.scoreTrend = 'STABLE'
    const html = markup(createElement(ExerciseReportCard, { exercise }))
    expect(html).toContain('与上次基本持平')
    expect(html).not.toContain('提高 1 分')
  })

  it('explains invalid repetitions in user-facing language', () => {
    const exercise = analysisOf(INVALID_REPS).exercises.find((item) => item.exerciseId === 'overhead_raise')!
    const html = markup(createElement(ExerciseReportCard, { exercise }))
    expect(html).toContain('因识别质量不足未纳入分析')
    expect(html).not.toContain('BODY_OUT_OF_FRAME')
  })
})

describe('Training Report V2 capability presentation', () => {
  it('renders a labeled radar only when radarAvailable is true', () => {
    const analysis = analysisOf(FIRST_SESSION)
    expect(analysis.capability.radarAvailable).toBe(true)
    const html = markup(createElement(CapabilitySection, { analysis }))
    expect(html).toContain('data-testid="capability-radar"')
    expect(html).toContain('五项训练能力分布')
  })

  it('falls back to a five-dimension list when radarAvailable is false', () => {
    const analysis = analysisOf(FAST_SESSION)
    expect(analysis.capability.radarAvailable).toBe(false)
    const html = markup(createElement(CapabilitySection, { analysis }))
    expect(html).toContain('本次暂不绘制能力图')
    expect(html).not.toContain('data-testid="capability-radar"')
  })

  it('uses comparison.current and previous for capability comparison, never value versus previous', () => {
    const analysis = analysisOf(FULL_IMPROVEMENT.current, FULL_IMPROVEMENT.history)
    const dimension = analysis.capability.dimensions[0]
    dimension.value = 99
    dimension.comparison = { commonExerciseIds: ['overhead_raise', 'lateral_raise', 'step_jack'], current: 82, previous: 75, delta: 7, trend: 'IMPROVED' }
    const html = markup(createElement(CapabilitySection, { analysis }))
    const row = html.slice(html.indexOf('data-testid="capability-amplitude"'), html.indexOf('data-testid="capability-stability"'))
    expect(row).toContain('>82<')
    expect(row).not.toContain('>99<')
    const radar = markup(createElement(CapabilityRadar, { dimensions: analysis.capability.dimensions }))
    expect(radar).toContain('上次为')
  })

  it('renders a missing FORM dimension as unavailable, never zero', () => {
    const analysis = analysisOf(FIRST_SESSION)
    const form = analysis.capability.dimensions.find((item) => item.dimension === 'FORM')!
    form.value = null
    form.unavailableReason = 'INSUFFICIENT_CONTRIBUTORS'
    analysis.capability.radarAvailable = false
    const html = markup(createElement(CapabilitySection, { analysis }))
    const row = html.slice(html.indexOf('data-testid="capability-form"'))
    expect(row).toContain('有效数据不足')
    expect(row).not.toContain('>0<')
  })
})

describe('Training Report V2 progress, focus, data quality, and state gates', () => {
  it('shows presentation counts from existing issue trend enums', () => {
    const analysis = analysisOf(FULL_IMPROVEMENT.current, FULL_IMPROVEMENT.history)
    const html = markup(createElement(ProgressSection, { analysis }))
    expect(html).toContain('已改善')
    expect(html).toContain('已解决')
  })

  it('renders a measurable NextFocus target and cue without runtime codes', () => {
    const analysis = analysisOf(FIRST_SESSION)
    const html = markup(createElement(NextFocusSection, { analysis }))
    expect(html).toContain('下次目标')
    expect(html).toContain(analysis.nextFocus[0].cue)
    expect(html).not.toMatch(/ELBOW_TOO_BENT|BODY_OUT_OF_FRAME/)
  })

  it('renders a focus item without inventing a target when target is null', () => {
    const analysis = analysisOf(FIRST_SESSION)
    analysis.nextFocus[0].target = null
    const html = markup(createElement(NextFocusSection, { analysis }))
    expect(html).toContain(analysis.nextFocus[0].cue)
    expect(html).not.toContain('下次目标：')
  })

  it('renders the frozen no-focus copy', () => {
    const analysis = analysisOf(POSE_QUALITY_ONLY)
    analysis.nextFocus = []
    const html = markup(createElement(NextFocusSection, { analysis }))
    expect(html).toContain('本次没有需要优先纠正的问题')
  })

  it('explains three-rep FORM evidence without engineering terms', () => {
    const analysis = analysisOf(MISSING_TOP_ELBOW)
    const html = markup(createElement(DataNotesSection, { analysis }))
    expect(html).toContain('有 3 次手肘伸展可以可靠判断')
    expect(html).not.toContain('TOP_ELBOW_NOT_CAPTURED')
  })

  it('hides analysis-only sections for unsupported rules', () => {
    const unsupported = makeSession({ id: 'unsupported', startedAt: at(3), rulesVersion: { spec: 'future', threshold: 'future' } })
    const analysis = analysisOf(unsupported)
    const html = renderView(analysis, unsupported)
    expect(html).not.toContain('data-testid="report-top-issues"')
    expect(html).not.toContain('data-testid="report-capabilities"')
    expect(html).not.toContain('data-testid="report-recommendations"')
    expect(html).toContain('只展示评分、完成度和数据说明')
  })

  it('contains no Family B image or engineering copy in the rendered report', () => {
    const html = renderView(analysisOf(FIRST_SESSION), FIRST_SESSION)
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/analysis-v1|TOP|ELBOW_TOO_BENT|BODY_OUT_OF_FRAME|canonicalId|courseOverallScore|JSON/)
    expect(html).not.toMatch(/完美|绝对正确|受伤风险/)
  })

  it('loads current plus history through the report analysis loader', () => {
    const repository: TrainingSessionRepository = {
      save: () => true,
      get: () => FULL_IMPROVEMENT.current,
      list: () => [...FULL_IMPROVEMENT.history, FULL_IMPROVEMENT.current],
    }
    const result = loadTrainingReportAnalysis(FULL_IMPROVEMENT.current.id, repository)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.analysis.comparison.level).toBe('FULL')
  })

  it('returns a recoverable repository error state instead of throwing', () => {
    const repository: TrainingSessionRepository = { save: () => false, get: () => { throw new Error('read failed') }, list: () => [] }
    expect(loadTrainingReportAnalysis('broken', repository)).toEqual({ status: 'error', session: null })
    expect(markup(createElement(ReportReadError))).toContain('暂时无法读取训练报告')
  })

  it('renders a clear session-not-found recovery state', () => {
    const html = markup(createElement(ReportNotFound))
    expect(html).toContain('没有找到这次训练记录')
    expect(html).toContain('开始训练')
  })
})
