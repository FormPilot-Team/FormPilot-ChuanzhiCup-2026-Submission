import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CapabilityRadar } from '../src/components/report/CapabilityRadar'
import { buildTrainingReport } from '../src/features/report/TrainingReportBuilder'
import {
  CapabilitySection,
  ExerciseReportCard,
  RecommendationsSection,
  ReportNotFound,
  ReportSummary,
  TopIssuesSection,
  TrainingReportView,
} from '../src/pages/Report/TrainingReportPage'
import { createCompleteReportSession, createIncompleteReportSession } from './helpers/reportFixture'

function markup(component: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(component)
}

describe('training report UI components', () => {
  const complete = buildTrainingReport(createCompleteReportSession())

  it('renders the summary with course facts and score scope', () => {
    const html = markup(createElement(ReportSummary, { report: complete }))
    expect(html).toContain('训练完成')
    expect(html).toContain('6 / 6')
    expect(html).toContain('课程总评')
    expect(html).toContain('反馈记录')
  })

  it('renders a labeled SVG radar with a textual description', () => {
    const html = markup(createElement(CapabilityRadar, { capabilities: complete.capabilitySummary }))
    expect(html).toContain('<svg')
    expect(html).toContain('五项训练能力分布')
    expect(html).toContain('动作幅度')
    expect(html).toContain('0 到 100 分')
  })

  it('keeps numeric capability values outside the chart', () => {
    const html = markup(createElement(CapabilitySection, { capabilities: complete.capabilitySummary, completedScoredCount: 5 }))
    expect(html).toContain('仅汇总已完成计分动作中的可用指标')
    expect(html).toContain('5/5')
  })

  it('hides the radar when fewer than two scored actions are complete', () => {
    const html = markup(createElement(CapabilitySection, { capabilities: complete.capabilitySummary, completedScoredCount: 1 }))
    expect(html).toContain('完成更多动作后可查看能力分布')
    expect(html).not.toContain('data-testid="capability-radar"')
  })

  it('renders guidance without a numeric score', () => {
    const html = markup(createElement(ExerciseReportCard, { exercise: complete.guidanceExercises[0] }))
    expect(html).toContain('肩部环绕')
    expect(html).toContain('引导完成')
    expect(html).toContain('不显示或参与 0–100 数值总分')
    expect(html).not.toContain('0 分')
  })

  it('renders a scored exercise with progress, score, and metrics', () => {
    const html = markup(createElement(ExerciseReportCard, { exercise: complete.scoredExercises[0] }))
    expect(html).toContain('双臂上举')
    expect(html).toContain('10 / 10 次')
    expect(html).toContain('86 分')
    expect(html).toContain('肘部伸展')
  })

  it('renders top issues from confirmed feedback', () => {
    const html = markup(createElement(TopIssuesSection, { issues: complete.topIssues }))
    expect(html).toContain('右臂抬高不足')
    expect(html).toContain('来自已确认纠错反馈')
    expect(html).toContain('4 次')
  })

  it('renders a careful no-issues state', () => {
    const html = markup(createElement(TopIssuesSection, { issues: [] }))
    expect(html).toContain('没有记录到明显的重复纠错问题')
    expect(html).toContain('不等于动作全部标准')
  })

  it('renders deterministic recommendations', () => {
    const html = markup(createElement(RecommendationsSection, { recommendations: complete.recommendations }))
    expect(html).toContain('基于已保存结果的规则建议')
    expect(html).toContain('右臂高度')
  })

  it('distinguishes an incomplete report and its score scope', () => {
    const incomplete = buildTrainingReport(createIncompleteReportSession())
    const html = markup(createElement(TrainingReportView, { report: incomplete }))
    expect(html).toContain('训练未完成')
    expect(html).toContain('2 / 6')
    expect(html).toContain('已完成动作平均分')
    expect(html).toContain('基于当前已完成的 1 个计分动作')
    expect(html).toContain('训练报告')
    expect(html).toContain('本次训练尚未完成该动作')
    expect(html).toContain('暂无可展示的数据')
    expect(html).not.toContain('TRAINING REPORT')
    expect(html).not.toContain('目标数据不可用')
    expect(html).not.toContain('数据缺失')
  })

  it('renders a graceful session-not-found state', () => {
    const html = markup(createElement(ReportNotFound))
    expect(html).toContain('未找到本次训练记录')
    expect(html).toContain('Session ID 无效')
  })
})
