import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AICoach } from '../src/components/aiCoach/AICoach'
import { analyzeTraining } from '../src/features/analysis'
import { customDigest, routineDigest, warmUpDigest } from '../src/features/aiCoach/digests'
import { INTENTS, answerIntent, matchQuestion, reply, suggestedIntents } from '../src/features/aiCoach/intents'
import type { CoachPageContext } from '../src/features/aiCoach/types'
import { buildCustomCoachContext, buildWarmUpCoachContext, customGuide, routineGuide, warmUpGuide } from '../src/features/coachContext/liveCoachContexts'
import { buildRoutineCoachContext } from '../src/features/coachContext/routineCoachContext'
import { getExerciseDefinition } from '../src/features/exercises/registry'
import { buildRoutineReport } from '../src/features/routines/report/routineReport'
import { getRoutineProgram } from '../src/features/routines/programs'
import { createDraftAction } from '../src/features/workshop/definition'
import { standingPose } from '../src/features/workshop/fixture'
import { CustomActionRecognizer } from '../src/features/workshop/recognition/recognizer'
import { buildCustomActionReport } from '../src/features/workshop/report'
import { recordRep, startCustomSession } from '../src/features/workshop/session'
import { FIRST_SESSION, FULL_IMPROVEMENT, at } from './analysis-fixtures'
import { routineRecord } from './helpers/routineFixtures'

const questions = (context: CoachPageContext) => suggestedIntents(context).map((id) => INTENTS[id].question)

function customAction() {
  const capture = (degrees: number) => ({ landmarks: standingPose(degrees).map(({ x, y, z, visibility }) => ({ x, y, z, visibility })), aspect: 16 / 9, frames: 12, capturedAt: '2026-09-27T08:00:00.000Z' })
  return { ...createDraftAction(new Date('2026-09-27T08:00:00.000Z'), 'custom-raise'), name: '侧平举练习', startPose: { description: '双臂自然下垂', capture: capture(8) }, finishPose: { description: '双臂抬到肩高', capture: capture(90) } }
}

function warmUpTraining(feedback?: Parameters<typeof buildWarmUpCoachContext>[0]['feedback']): CoachPageContext {
  const definition = getExerciseDefinition('overhead_raise')
  return {
    page: 'training',
    live: buildWarmUpCoachContext({ definition, position: { index: 1, total: 6 }, freeTraining: false, courseState: 'ACTIVE', progress: 3, target: 6, targetUnit: '次', score: 84, feedback }),
    guide: warmUpGuide(definition, '次'),
  }
}

describe('AI Coach Lite: questions depend on the page', () => {
  it('offers training, report, history and workshop questions in user language', () => {
    expect(questions(warmUpTraining())).toEqual(['这个动作怎么做？', '为什么刚才提示我动作不标准？', '我现在做得怎么样？', '我应该注意哪里？'])
    const digest = warmUpDigest(analyzeTraining(FIRST_SESSION, []), FIRST_SESSION)
    expect(questions({ page: 'report', digest })).toEqual(['我这次表现怎么样？', '为什么是这个分数？', '最大的问题是什么？', '和上次相比有进步吗？', '下次应该重点练什么？'])
    expect(questions({ page: 'home', recent: [], latest: null, week: null })).toEqual(['我最近训练怎么样？', '上次练了什么？', '今天可以继续练什么？'])
    expect(questions({ page: 'history', recent: [], latest: null, week: null })).toEqual(['我最近训练怎么样？', '上次练了什么？', '今天可以继续练什么？'])
    expect(questions({ page: 'workshop' })).toHaveLength(3)
  })
})

describe('training answers come from the live context', () => {
  it('explains how to do the current exercise from its definition', () => {
    const answer = answerIntent('how-to-do', warmUpTraining())
    expect(answer.text).toContain('双臂上举（第 2 / 6 项）')
    expect(answer.text).toContain(getExerciseDefinition('overhead_raise').presentation.guidance)
    expect(answer.basis).toBe('依据：这个动作的示范要求')
  })

  it('explains the latest correction without diagnosing, and says so when there is none', () => {
    const corrected = answerIntent('why-corrected', warmUpTraining({ id: 'f', timestamp: 0, kind: 'correction', exerciseId: 'overhead_raise', code: 'ELBOW_TOO_BENT_L', message: '左手肘伸直', severity: 2 }))
    expect(corrected.text).toContain('刚才提示「左手肘伸直」')
    expect(corrected.text).toContain('手肘弯曲')
    expect(corrected.text).toContain('二维画面')
    expect(corrected.text).not.toMatch(/力量不足|肌肉|损伤|诊断/)
    expect(answerIntent('why-corrected', warmUpTraining()).text).toContain('没有需要纠正的提示')
  })

  it('reports progress with the real numbers of each mode', () => {
    expect(answerIntent('how-am-i-doing', warmUpTraining()).text).toBe('已经完成 3 / 6 次，当前动作得分 84。')
    const program = getRoutineProgram('baduanjin')
    const chapter = program.chapters[3]
    const routine: CoachPageContext = {
      page: 'training',
      live: buildRoutineCoachContext({ program, chapter, chapterPosition: { index: 3, total: 10 }, courseState: 'ACTIVE', elapsedSeconds: 250, totalSeconds: 728, coveredSeconds: 240, match: { status: 'behind', similarity: 0.734, timingOffsetMs: -1320, matchedAt: 249, videoTime: 250.4, regionScores: { arms: 0.61, torso: 0.9, legs: null }, mirrored: false }, recentReports: [] }),
      guide: routineGuide(program, chapter),
    }
    const doing = answerIntent('how-am-i-doing', routine)
    expect(doing.text).toContain('跟练相似度是 73%，比视频慢了一点')
    expect(doing.facts).toEqual([{ label: '上肢', value: '61%' }, { label: '躯干', value: '90%' }])
    expect(answerIntent('what-to-watch', routine).text).toContain('上肢和示范的一致度最低（61%）')
    const action = customAction()
    const recognizer = new CustomActionRecognizer(action)
    const custom: CoachPageContext = { page: 'training', live: buildCustomCoachContext({ action, setup: recognizer.setup, courseState: 'PREPARING', count: 0, target: 10, snapshot: null }), guide: customGuide(action, recognizer.setup) }
    expect(answerIntent('how-am-i-doing', custom).text).toContain('还没有开始')
    expect(answerIntent('how-to-do', custom).text).toContain('从「双臂自然下垂」出发，做到「双臂抬到肩高」')
  })
})

describe('report answers restate the report', () => {
  it('uses analysis-v1 output for a warm-up report', () => {
    const analysis = analyzeTraining(FIRST_SESSION, [])
    const context: CoachPageContext = { page: 'report', digest: warmUpDigest(analysis, FIRST_SESSION) }
    expect(answerIntent('report-overview', context).text).toContain(`综合评分 ${analysis.overall.score} 分`)
    expect(answerIntent('biggest-issue', context).text).toContain(analysis.priorityIssues[0].reportLabel)
    expect(answerIntent('vs-last', context).text).toBe('这是第一条训练记录，暂无可对比的历史。')
    const focus = answerIntent('next-focus', context)
    expect(focus.text).toContain(analysis.nextFocus[0].cue)
    expect(focus.text).toContain('下次目标')
    const improved = analyzeTraining(FULL_IMPROVEMENT.current, FULL_IMPROVEMENT.history)
    expect(answerIntent('vs-last', { page: 'report', digest: warmUpDigest(improved, FULL_IMPROVEMENT.current) }).text).toContain(`综合评分比上次提高 ${improved.overall.delta} 分`)
  })

  it('never gives a custom action a score, and uses the follow-along similarity for routines', () => {
    const record = startCustomSession(customAction(), { id: 'custom-session-1-a', startedAt: at(1), recognitionMode: 'pose-match', source: 'live', mode: 'normal', requirements: ['arms-straight', 'full-return'] })
    for (let index = 1; index <= 4; index += 1) recordRep(record, { index, durationMs: 1500, peakProgress: 1, requirements: [{ id: 'arms-straight', passed: index > 2 }, { id: 'full-return', passed: true }], failed: index > 2 ? [] : ['arms-straight'], passed: index > 2 })
    const custom = customDigest(buildCustomActionReport({ ...record, outcome: 'completed' }))
    const overview = answerIntent('report-overview', { page: 'report', digest: custom })
    expect(overview.text).toContain('完成 4 / 10 次')
    expect(overview.text).toContain('识别重点全部达标 2 次')
    expect(overview.text).not.toMatch(/综合评分|得分|\d+ 分/)
    expect(answerIntent('biggest-issue', { page: 'report', digest: custom }).text).toContain('手臂保持伸直')
    const routine = routineDigest(buildRoutineReport(routineRecord({ id: 'r1', startedAt: at(2), chapters: { 'bdj-2': { similarity: 0.55 } } }))!)
    expect(answerIntent('report-overview', { page: 'report', digest: routine }).text).toContain('跟练相似度')
    expect(answerIntent('biggest-issue', { page: 'report', digest: routine }).text).toContain('第二式 · 左右开弓似射雕')
  })
})

describe('history answers and free input', () => {
  const recent = [
    { sessionId: 'r1', modeId: 'baduanjin', modeTitle: '八段锦 · 整套跟练', startedAt: at(3), completed: true, headline: '完整跟练 · 跟练相似度 80%（高度一致）', reportPath: '/report/r1' },
    { sessionId: 's1', modeId: 'smart-training', modeTitle: '热身训练 · 完整训练', startedAt: at(2), completed: false, headline: '已完成动作平均分 78', reportPath: '/report/s1' },
  ]
  const home: CoachPageContext = { page: 'home', recent, latest: null, week: { count: 2, previous: 1 } }

  it('summarises recent training and the last one from the saved records', () => {
    const summary = answerIntent('recent-summary', home)
    expect(summary.text).toContain('本周完成了 2 次训练，上周是 1 次')
    expect(summary.facts?.[1]).toMatchObject({ value: '已完成动作平均分 78（未完成）' })
    expect(answerIntent('last-training', home)).toMatchObject({ link: { href: '/report/r1' } })
    expect(answerIntent('what-next', home).text).toContain('今天可以试试「太极拳」')
    expect(answerIntent('recent-summary', { page: 'home', recent: [], latest: null, week: null }).text).toContain('还没有训练记录')
  })

  it('maps simple free input to the page\'s questions and declines the rest honestly', () => {
    const report: CoachPageContext = { page: 'report', digest: warmUpDigest(analyzeTraining(FIRST_SESSION, []), FIRST_SESSION) }
    expect(matchQuestion('我这次表现得怎么样', report)).toEqual({ kind: 'intent', id: 'report-overview' })
    expect(matchQuestion('下次练什么好', report)).toEqual({ kind: 'intent', id: 'next-focus' })
    expect(matchQuestion('跟上次比进步了吗', report)).toEqual({ kind: 'intent', id: 'vs-last' })
    expect(matchQuestion('你好', report)).toEqual({ kind: 'greeting' })
    expect(matchQuestion('膝盖疼怎么办', report)).toEqual({ kind: 'safety' })
    expect(matchQuestion('帮我写一首诗', report)).toEqual({ kind: 'unknown' })
    // Generic words alone (怎么样) never pull an unrelated question onto a training answer.
    expect(matchQuestion('明天天气怎么样', { page: 'home', recent: [], latest: null, week: null })).toEqual({ kind: 'unknown' })
    expect(matchQuestion('我最近练得怎么样', { page: 'home', recent: [], latest: null, week: null })).toEqual({ kind: 'intent', id: 'recent-summary' })
    expect(reply('膝盖疼怎么办', report).answer.text).toContain('不能判断伤病')
    const unknown = reply('明天天气如何', report).answer.text
    expect(unknown).toContain('这个问题我还回答不了')
    expect(unknown).toContain('“我这次表现怎么样？”')
    // A question from another page is not answered with made-up data.
    expect(matchQuestion('上次练了什么', warmUpTraining())).toEqual({ kind: 'unknown' })
  })
})

describe('AI Coach component', () => {
  it('renders a labelled, collapsed launcher with the coach avatar', () => {
    const html = renderToStaticMarkup(createElement(AICoach, { context: { page: 'workshop' } }))
    expect(html).toContain('aria-label="打开 AI 教练"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('/assets/coach/coach-avatar.webp')
    expect(html).not.toContain('role="dialog"')
    // The same Family A face as Home: a transparent cut-out on the shared avatar disc, never multiplied into the page.
    expect(html).toContain('fp-coach-avatar')
    expect(html).not.toContain('mix-blend-multiply')
  })
})
