import { mkdir, writeFile } from 'node:fs/promises'
import { LocalAdaptiveDecisionEngine } from '../src/features/adaptiveTraining/LocalAdaptiveDecisionEngine.ts'
import { buildLocalScenarioFrames, LOCAL_EXPECTATIONS, type LocalScenarioFrame } from '../src/features/adaptiveTraining/localScenarioReplay.ts'
import { DECISION_SCENARIOS, NORMAL_INPUT } from '../src/features/adaptiveTraining/scenarios.ts'
import { STRATEGY_LABELS, ISSUE_LABELS } from '../src/features/adaptiveTraining/localGuidance.ts'
import { FeedbackPolicy } from '../src/features/feedback/FeedbackPolicy.ts'
import type { TrainingDecisionInput, InterventionStrategy } from '../src/features/adaptiveTraining/protocol.ts'
import type { RuleResult } from '../src/features/exercises/types.ts'

const repeated: TrainingDecisionInput = { ...NORMAL_INPUT, score: 58, consecutiveErrors: 2, feedbackResponse: 'not_corrected',
  errors: [{ code: 'DEPTH_INSUFFICIENT', severity: .4 }] }
const makeFrames = (length: number, build: (t: number) => TrainingDecisionInput, needed: (t: number) => boolean): LocalScenarioFrame[] =>
  Array.from({ length: length + 1 }, (_, t) => ({ at: t * 1000, input: build(t), interventionExpected: needed(t) }))
const cases = DECISION_SCENARIOS.map(s => ({ id: s.id, name: s.fault ? `原接口异常情境：本地决策无需传输（${s.id}）` : s.name,
  frames: buildLocalScenarioFrames(s), expected: LOCAL_EXPECTATIONS[s.id] }))
cases.push(
  { id: 'same-count-high-quality', name: '相同重复次数但质量较高，不急于干预', expected: 'CONTINUE_STANDARD', frames: makeFrames(5, () => ({ ...repeated, score: 96 }), () => false) },
  { id: 'score-improving', name: '提示后同阶段质量改善，恢复常规反馈', expected: 'CONTINUE_STANDARD', frames: makeFrames(20, t => ({ ...repeated, score: t < 6 ? 58 : 88 }), t => t < 6) },
  { id: 'intermittent-errors', name: '间歇性同类错误后回位，无当前问题时保留常规反馈', expected: 'CONTINUE_STANDARD', frames: makeFrames(30, t => ({ ...repeated, errors: t % 3 === 0 ? [] : repeated.errors }), t => t % 3 !== 0) },
  { id: 'missing-score', name: '缺少有效评分数据', expected: 'CONTINUE_STANDARD', frames: makeFrames(15, () => ({ ...repeated, score: null }), () => false) },
  { id: 'low-reliability', name: '关键点可靠性较低，不判断动作错误', expected: 'CONTINUE_STANDARD', frames: makeFrames(15, () => ({ ...repeated, poseReliability: .4 }), () => false) },
  { id: 'phase-aligned', name: '不同阶段分数交替，避免误判改善', expected: 'SHOW_DECOMPOSITION', frames: makeFrames(24, t => ({ ...repeated, phase: t % 2 ? 'BOTTOM' : 'STANDING', score: t % 2 ? 40 : 90 }), () => true) },
)

const localLatencies: number[] = [], baselineLatencies: number[] = []
const reports = cases.map(testCase => {
  const engine = new LocalAdaptiveDecisionEngine()
  const baseline = new FeedbackPolicy()
  let previousKey: string | undefined, previousAdaptiveKey: string | undefined
  let repeatedBaseline = 0, repeatedAdaptive = 0, unnecessary = 0
  let previousStrategy: InterventionStrategy = 'CONTINUE_STANDARD'
  const timeline = testCase.frames.map(frame => {
    const input = frame.input
    const ruleResult: RuleResult = { exerciseId: input.exerciseId, phase: input.phase, confidence: input.poseValid ? input.poseReliability ?? .98 : .4,
      currentScore: input.score ?? 0, metrics: {}, errors: input.errors.map(e => ({ ...e, message: ISSUE_LABELS[e.code] })) }
    const baselineStarted = performance.now()
    const feedback = input.trainingState === 'ACTIVE' ? baseline.update(ruleResult, frame.at) : undefined
    baselineLatencies.push(performance.now() - baselineStarted)
    const started = performance.now()
    const decision = engine.decide(input, frame.at)
    localLatencies.push(performance.now() - started)
    if (feedback?.kind === 'correction') {
      const key = String(feedback.code)
      const adaptiveKey = `${decision.strategy}:${key}`
      if (previousKey === key && input.feedbackResponse !== 'corrected') repeatedBaseline += 1
      if (previousAdaptiveKey === adaptiveKey && decision.local?.features.trend !== 'improving' && input.feedbackResponse !== 'corrected') repeatedAdaptive += 1
      previousKey = key; previousAdaptiveKey = adaptiveKey
    } else if (feedback?.kind === 'recovery') { previousKey = undefined; previousAdaptiveKey = undefined }
    if (decision.strategy !== previousStrategy && decision.strategy !== 'CONTINUE_STANDARD' && !frame.interventionExpected) unnecessary += 1
    previousStrategy = decision.strategy
    return { atSeconds: frame.at / 1000, input: { phase: input.phase, score: input.score, poseValid: input.poseValid, errors: input.errors,
      consecutiveErrors: input.consecutiveErrors, feedbackResponse: input.feedbackResponse }, baselineStrategy: 'CONTINUE_STANDARD',
      originalFeedbackEvent: feedback ?? null, adaptiveStrategy: decision.strategy, localExplanation: decision.local, safetyFallback: decision.safetyFallback }
  })
  const final = timeline.at(-1)!
  const improvement = timeline.find(t => t.localExplanation?.features.trend === 'improving')
  return { id: testCase.id, name: testCase.name, dataSource: 'constructed-engineering-scenario', expectedFinalStrategy: testCase.expected,
    inputState: testCase.frames.at(-1)!.input, baselineFinalStrategy: 'CONTINUE_STANDARD', adaptiveFinalStrategy: final.adaptiveStrategy,
    baselineMatchesAnnotation: testCase.expected === 'CONTINUE_STANDARD', adaptiveMatchesAnnotation: final.adaptiveStrategy === testCase.expected,
    baselineRepeatedVisualCueOpportunities: repeatedBaseline, adaptiveRepeatedVisualCueOpportunities: repeatedAdaptive,
    baselineUnnecessaryAdaptiveActivations: 0, adaptiveUnnecessaryActivations: unnecessary,
    improvingTrendFirstObservedAtSeconds: improvement?.atSeconds ?? null,
    strategyWhenImprovementObserved: improvement?.adaptiveStrategy ?? null, timeline }
})
function timings(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1) }
}
const report = { generatedAt: new Date().toISOString(), dataSource: 'constructed-engineering-scenarios', humanParticipants: 0,
  method: 'Original FeedbackPolicy is replayed with the same constructed RuleResult at 1 Hz. Local policy receives the same state timeline. No pose/scoring thresholds are changed.',
  caveats: ['Agreement is against explicit engineering expectations for these constructed cases, not measured recognition accuracy.',
    'Repeated cue opportunities count identical visual strategy families at original correction event times. Original speech is unchanged. These are not observed human failures or measured spoken prompt reductions.',
    'Unnecessary activations use predeclared per-frame interventionExpected annotations. No human outcomes or trained model claims.',
    'Latency measures this local Node process and includes policy work; it is not a browser frame budget or a device-independent benchmark.'],
  summary: { scenarios: reports.length, baselineAgreementCount: reports.filter(r => r.baselineMatchesAnnotation).length,
    adaptiveAgreementCount: reports.filter(r => r.adaptiveMatchesAnnotation).length,
    baselineRepeatedVisualCueOpportunities: reports.reduce((sum, r) => sum + r.baselineRepeatedVisualCueOpportunities, 0),
    adaptiveRepeatedVisualCueOpportunities: reports.reduce((sum, r) => sum + r.adaptiveRepeatedVisualCueOpportunities, 0),
    adaptiveUnnecessaryActivations: reports.reduce((sum, r) => sum + r.adaptiveUnnecessaryActivations, 0),
    localLatency: timings(localLatencies), baselineLatency: timings(baselineLatencies) }, scenarios: reports }
await mkdir('docs/competition', { recursive: true })
await writeFile('docs/competition/local-adaptive-results.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
const examples = reports.filter(r => ['switch', 'decomposition', 'pause'].includes(r.id))
const markdown = `# 本地自适应策略对比\n\n数据来源：31 个预先标注的人工构造工程情境，真人参与人数为 0。原始 25 个情境全部保留，并增加 6 个边界情境。\n\n`
  + `固定规则符合末状态标注 ${report.summary.baselineAgreementCount}/${reports.length}，本地策略符合 ${report.summary.adaptiveAgreementCount}/${reports.length}。这仅表示本套构造情境的策略符合性，不是人体实验或识别准确率。\n\n`
  + `| 典型情境 | 固定规则 | 本地自适应 | 决策依据 |\n| --- | --- | --- | --- |\n`
  + examples.map(r => `| ${r.name} | 常规反馈 | ${STRATEGY_LABELS[r.adaptiveFinalStrategy]} | ${r.timeline.at(-1)!.localExplanation!.reasons.join(' ')} |`).join('\n')
  + `\n\n按原 FeedbackPolicy 的纠错事件时刻计算，同内容视觉提示的重复机会：固定规则 ${report.summary.baselineRepeatedVisualCueOpportunities} 次，本地策略 ${report.summary.adaptiveRepeatedVisualCueOpportunities} 次。不必要的新增策略激活：${report.summary.adaptiveUnnecessaryActivations} 次。语音链路没有修改，这些指标不代表实际语音重复减少或真人纠正效果。\n\n`
  + `本次本地决策计时 ${report.summary.localLatency.samples} 次，中位 ${report.summary.localLatency.medianMs.toFixed(4)} ms，P95 ${report.summary.localLatency.p95Ms.toFixed(4)} ms，最大 ${report.summary.localLatency.maxMs!.toFixed(4)} ms。固定规则 P95 ${report.summary.baselineLatency.p95Ms.toFixed(4)} ms。仅代表本机 Node 运行测量。\n\n`
  + `改善情境的逐秒输入、原反馈事件、两种策略、完整策略分、趋势、干预效果和回退见 [JSON 记录](./local-adaptive-results.json)。\n\n复跑：\n\n\`\`\`powershell\nnpm run adaptive:evaluate\n\`\`\`\n`
await writeFile('docs/competition/LOCAL_COMPARISON.md', markdown, 'utf8')
console.log(JSON.stringify(report.summary, null, 2))
if (reports.some(r => !r.adaptiveMatchesAnnotation)) process.exitCode = 1
