import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveLocalConfig } from '../server/coachAgent/local/config'
import { extractPlan } from '../server/coachAgent/local/planning'
import { classifyCoachQuestion, type AnswerMode } from '../src/features/coachAgent/provider'
import type { LocalPlanCandidate, LocalPlanContext } from '../src/features/coachAgent/localProtocolV2'
import { validateRemoteStep, type RemoteCoachContext } from '../src/features/coachAgent/remoteProtocol'
import { parseToolIntent } from '../src/features/coachAgent/toolQuery'
import { SESSION_STORAGE_KEY } from '../src/features/training/LocalStorageTrainingSessionRepository'
import { at, makeSession } from './analysis-fixtures'
import { PROTOCOL_INTENTS, PROTOCOL_QUESTION_CORPUS, PROTOCOL_SAFETY_CASES } from './support/coach-agent-protocol-corpus'
import { legacyFixturePlan, setupProtocolDemo, type ExperimentContext, type ProtocolArm } from './support/coach-agent-protocol-http'

type Projection = 'structured' | 'question-scope'
interface Condition { protocol: ProtocolArm; projection: Projection }
const CONDITIONS: readonly Condition[] = [
  { protocol: 'A', projection: 'structured' },
  ...(['B', 'C', 'D'] as const).flatMap(protocol => ([
    { protocol, projection: 'structured' as const }, { protocol, projection: 'question-scope' as const },
  ])),
]
interface Row extends Condition {
  id: string
  group: 'semantic' | 'safety'
  expectedIntent: AnswerMode
  candidateIntent: AnswerMode | null
  intentSource: 'legacy-rule' | 'human-authored-fixture'
  modelAccuracy: null
  responseCount: number
  jsonSyntaxCompliant: number
  schemaCompliantResponses: number
  planningCompleted: boolean
  toolAndParametersCorrect: boolean | null
  attemptedForgedIds: number
  acceptedForgedIds: number
  unauthorizedExecutions: number
  storageReads: number
  incorrectProgressConclusion: number
  refusalReasons: string[]
  status: string
  questionTransmitted: string | null
  originalQuestionPreserved: boolean | null
  requestBytes: number
}
const rows: Row[] = []
const recordings: Array<{ condition: Condition; id: string; requests: string[]; responses: unknown[]; dispatchIntents: unknown[] }> = []

function candidate(intent: AnswerMode): LocalPlanCandidate {
  if (intent === 'insufficient') return { intent, tool: 'none' }
  if (intent === 'history') return { intent, tool: 'read_history', limit: 3 }
  return { intent, tool: 'read_scoring_evidence' }
}

function syntaxCount(protocol: ProtocolArm, responses: unknown[]): number {
  return responses.filter(response => {
    try {
      // Native arguments are JSON object members of the envelope. A string argument is
      // syntactically valid outer JSON but fails native/schema validation separately.
      const value = JSON.parse(JSON.stringify(response)) as { message: { content: string } }
      if (protocol !== 'C') JSON.parse(value.message.content)
      return true
    } catch { return false }
  }).length
}

function schemaCount(protocol: ProtocolArm, responses: unknown[], contexts: ExperimentContext[], requests: string[]): number {
  // Revalidate the actual recorded response using the same production boundary,
  // separately from storage permissions and the final evidence/answer status.
  const config = resolveLocalConfig({ planningProtocol: ({ A: 'provider-step-v1', B: 'simple-json',
    C: 'native-tools', D: 'structured-output' } as const)[protocol] })
  return responses.filter((response, index) => {
    try {
      if (protocol === 'A') {
        const message = (response as { message: { content: string } }).message
        validateRemoteStep(JSON.parse(message.content), contexts[index] as RemoteCoachContext)
      } else extractPlan(response, contexts[index] as LocalPlanContext, config, Buffer.byteLength(requests[index]) + 512)
      return true
    } catch { return false }
  }).length
}

function responseIntent(protocol: ProtocolArm, response: unknown): AnswerMode | null {
  if (!response) return null
  try {
    const value = response as { message: { content: string; tool_calls?: Array<{ function: { arguments: { intent?: unknown } } }> } }
    // Legacy first-step tool requests do not contain intent; the final answer does.
    const raw = protocol === 'C' ? value.message.tool_calls?.[0]?.function.arguments.intent
      : (JSON.parse(value.message.content) as { intent?: unknown; mode?: unknown })[protocol === 'A' ? 'mode' : 'intent']
    return PROTOCOL_INTENTS.includes(raw as AnswerMode) ? raw as AnswerMode : null
  } catch { return null }
}

function reasons(answer: Awaited<ReturnType<Awaited<ReturnType<typeof setupProtocolDemo>>['agent']['run']>>) {
  return [...new Set([answer.problemCode, ...answer.calls.map(call => call.problemCode)].filter((code): code is string => !!code))]
}

describe('Phase 1H seven-condition scripted protocol evaluation (not model accuracy)', () => {
  for (const condition of CONDITIONS) {
    it(`${condition.protocol}/${condition.projection}: fixed Chinese corpus through Fake HTTP and real Dispatcher`, async () => {
      for (const sample of PROTOCOL_QUESTION_CORPUS) {
        const selectedIntent = condition.projection === 'structured' ? classifyCoachQuestion(sample.question) : sample.expectedIntent
        const demo = await setupProtocolDemo({ ...condition,
          reply: context => condition.protocol === 'A' ? legacyFixturePlan(context as RemoteCoachContext) : candidate(selectedIntent),
        })
        try {
          const answer = await demo.agent.run(sample.question)
          const first = demo.contexts[0]
          const question = first && 'question' in first ? first.question ?? null : null
          const tool = sample.expectedIntent === 'insufficient' ? undefined
            : sample.expectedIntent === 'history' ? 'read_history' : 'read_scoring_evidence'
          const expectedSession = sample.expectedIntent === 'routine' ? demo.routineSessionId : demo.warmupSessionId
          const actualIntent = responseIntent(condition.protocol, condition.protocol === 'A' ? demo.responses.at(-1) : demo.responses[0])
          const actualCall = demo.dispatchIntents.length === 1 ? parseToolIntent(demo.dispatchIntents[0]) : null
          const routine = sample.expectedIntent === 'routine'
          const toolsCorrect = tool ? actualCall?.tool === tool && actualCall.query.kind === (routine ? 'routine' : 'warmup')
            && actualCall.query.sessionId === expectedSession && actualCall.query.subject?.kind === (routine ? 'routine' : 'exercise')
            && actualCall.query.subject.id === (routine ? 'baduanjin' : 'squat')
            && actualCall.query.limit === (sample.expectedIntent === 'history' ? 3 : undefined)
            : demo.dispatchIntents.length === 0
          const row: Row = { ...condition, id: sample.id, group: 'semantic', expectedIntent: sample.expectedIntent,
            candidateIntent: actualIntent, intentSource: condition.projection === 'structured' ? 'legacy-rule' : 'human-authored-fixture',
            modelAccuracy: null, responseCount: demo.responses.length,
            jsonSyntaxCompliant: syntaxCount(condition.protocol, demo.responses),
            schemaCompliantResponses: schemaCount(condition.protocol, demo.responses, demo.contexts, demo.bodies),
            planningCompleted: answer.modelPlanning === 'completed', toolAndParametersCorrect: toolsCorrect,
            attemptedForgedIds: 0, acceptedForgedIds: 0, unauthorizedExecutions: 0,
            storageReads: demo.storage.getItem.mock.calls.length,
            incorrectProgressConclusion: selectedIntent === 'history' && answer.status === 'answered' ? 1 : 0,
            refusalReasons: reasons(answer), status: answer.status, questionTransmitted: question,
            originalQuestionPreserved: condition.projection === 'question-scope' ? question === sample.question : null,
            requestBytes: demo.bodies.reduce((total, body) => total + Buffer.byteLength(body), 0) }
          rows.push(row)
          recordings.push({ condition, id: sample.id, requests: demo.bodies, responses: demo.responses, dispatchIntents: demo.dispatchIntents })
          expect(answer.modelPlanning, `${condition.protocol}/${sample.id}`).toBe('completed')
          expect(actualIntent).toBe(selectedIntent)
          expect(row.jsonSyntaxCompliant).toBe(row.responseCount)
          expect(row.schemaCompliantResponses).toBe(row.responseCount)
          expect(row.incorrectProgressConclusion).toBe(0)
          expect(answer.citations.every(item => item.provenance.source === 'synthetic')).toBe(true)
          expect(answer.citations.every(item => item.requestId === answer.calls[0]?.requestId)).toBe(true)
          expect([...demo.raw.entries()]).toEqual(demo.before)
          expect(demo.storage.setItem).not.toHaveBeenCalled()
          expect(demo.storage.removeItem).not.toHaveBeenCalled()
          expect(demo.storage.clear).not.toHaveBeenCalled()
          if (condition.protocol !== 'A') {
            expect(demo.contexts).toHaveLength(1)
            const context = first as LocalPlanContext
            expect(context).not.toHaveProperty('observations')
            if (condition.projection === 'question-scope') expect(context).not.toHaveProperty('mode')
            else { expect(context.mode).toBe(selectedIntent); expect(context).not.toHaveProperty('question') }
            const input = JSON.stringify(context)
            for (const forbidden of ['requestId', 'evidenceId', 'recordRef', 'scoringVersion', 'repetitions',
              'synthetic-squat', 'synthetic-baduanjin', 'scoreKind', 'provenance']) expect(input).not.toContain(forbidden)
          }
        } finally { await demo.close() }
      }
    }, 120_000)
  }

  for (const condition of CONDITIONS) {
    it(`${condition.protocol}/${condition.projection}: evidence failures, authorization and adversarial outputs`, async () => {
      for (const sample of PROTOCOL_SAFETY_CASES) {
        const malicious = ['forge-evidence', 'forge-request', 'forge-score-source', 'read-other-user',
          'excessive-history', 'write-tool', 'invalid-json'].includes(sample.scenario)
        const forbiddenRead = malicious || ['authorization-denied', 'consent-denied', 'illegal-session'].includes(sample.scenario)
        const reply = (context: ExperimentContext): unknown => {
          const value = condition.protocol === 'A' ? legacyFixturePlan(context as RemoteCoachContext) : candidate(sample.intent)
          if (sample.scenario === 'forge-evidence') return condition.protocol === 'A'
            ? { type: 'answer', mode: sample.intent, evidenceRefs: [{ requestId: 'r1', evidenceId: 'e999' }] }
            : { ...candidate(sample.intent), evidenceId: 'e999' }
          if (sample.scenario === 'forge-request') return condition.protocol === 'A'
            ? { type: 'answer', mode: sample.intent, evidenceRefs: [{ requestId: 'r999', evidenceId: 'e1' }] }
            : { ...candidate(sample.intent), requestId: 'r999' }
          if (sample.scenario === 'forge-score-source') return { ...value as object, score: 100, source: 'live', version: 'invented', sampleCount: 99 }
          if (sample.scenario === 'read-other-user') return condition.protocol === 'A'
            ? { type: 'tools', calls: [{ tool: 'read_scoring_evidence', query: {
              kind: 'warmup', sessionId: 's999', subject: { kind: 'exercise', id: 'squat' },
            } }] } : { ...candidate(sample.intent), sessionId: 'outside-authorized' }
          if (sample.scenario === 'excessive-history') return condition.protocol === 'A'
            ? { type: 'tools', calls: [{ tool: 'read_history', query: {
              kind: 'warmup', sessionId: 's1', subject: { kind: 'exercise', id: 'squat' }, limit: 64,
            } }] } : { ...candidate(sample.intent), limit: 64 }
          if (sample.scenario === 'write-tool') return condition.protocol === 'A'
            ? { type: 'tools', calls: [{ tool: 'write_session', query: { kind: 'warmup', sessionId: 's1' } }] }
            : { ...candidate(sample.intent), tool: 'write_session' }
          return value
        }
        const demo = await setupProtocolDemo({ ...condition, reply,
          ...(sample.scenario === 'authorization-denied' ? { fixture: { warmupIds: [] } } : {}),
          ...(sample.scenario === 'consent-denied' ? { providerOptions: { consent: false } } : {}),
          ...(sample.scenario === 'illegal-session' ? { providerOptions: { warmupSessionId: 'outside-authorized' } } : {}),
          ...(sample.scenario === 'invalid-json' ? { modelContent: '{broken' } : {}),
        })
        try {
          if (sample.scenario === 'empty-records') demo.raw.set(SESSION_STORAGE_KEY, '[]')
          if (sample.scenario === 'corrupt-records') demo.raw.set(SESSION_STORAGE_KEY, '{broken')
          if (sample.scenario === 'insufficient-evidence') demo.raw.set(SESSION_STORAGE_KEY,
            JSON.stringify([makeSession({ id: demo.warmupSessionId, startedAt: at(2), source: 'synthetic', exercises: { squat: { reps: 0 } } })]))
          const before = [...demo.raw.entries()]
          const answer = await demo.agent.run(sample.question)
          const syntaxCompliant = syntaxCount(condition.protocol, demo.responses)
          const row: Row = { ...condition, id: sample.id, group: 'safety', expectedIntent: sample.intent,
            candidateIntent: responseIntent(condition.protocol, condition.protocol === 'A' ? demo.responses.at(-1) : demo.responses[0]),
            intentSource: 'human-authored-fixture', modelAccuracy: null,
            responseCount: demo.responses.length, jsonSyntaxCompliant: syntaxCompliant,
            schemaCompliantResponses: schemaCount(condition.protocol, demo.responses, demo.contexts, demo.bodies),
            planningCompleted: answer.modelPlanning === 'completed', toolAndParametersCorrect: null,
            attemptedForgedIds: ['forge-evidence', 'forge-request', 'read-other-user'].includes(sample.scenario) ? 1 : 0,
            acceptedForgedIds: answer.citations.filter(item => ['e999', 'r999', 'outside-authorized'].includes(item.evidenceId)
              || ['e999', 'r999', 'outside-authorized'].includes(item.requestId) || item.sessionId === 'outside-authorized').length,
            unauthorizedExecutions: forbiddenRead ? answer.calls.filter(call => call.ok).length : 0,
            storageReads: demo.storage.getItem.mock.calls.length,
            incorrectProgressConclusion: sample.intent === 'history' && answer.status === 'answered' ? 1 : 0,
            refusalReasons: reasons(answer), status: answer.status,
            questionTransmitted: demo.contexts[0] && 'question' in demo.contexts[0] ? demo.contexts[0].question ?? null : null,
            originalQuestionPreserved: null, requestBytes: demo.bodies.reduce((total, body) => total + Buffer.byteLength(body), 0) }
          rows.push(row)
          recordings.push({ condition, id: sample.id, requests: demo.bodies, responses: demo.responses, dispatchIntents: demo.dispatchIntents })
          expect(row.acceptedForgedIds, `${condition.protocol}/${sample.id}`).toBe(0)
          expect(row.unauthorizedExecutions).toBe(0)
          expect(row.incorrectProgressConclusion).toBe(0)
          expect([...demo.raw.entries()]).toEqual(before)
          expect(demo.storage.setItem).not.toHaveBeenCalled()
          expect(demo.storage.removeItem).not.toHaveBeenCalled()
          expect(demo.storage.clear).not.toHaveBeenCalled()
          if (forbiddenRead) expect(demo.storage.getItem).not.toHaveBeenCalled()
          if (malicious || sample.scenario === 'consent-denied') {
            expect(answer.status).toBe('failed')
            expect(answer.citations).toEqual([])
            expect(row.schemaCompliantResponses).toBe(0)
          } else expect(answer.status).toBe('insufficient')
          if (sample.scenario === 'empty-records') expect(row.refusalReasons).toContain('NOT_FOUND')
          if (sample.scenario === 'corrupt-records') expect(row.refusalReasons).toContain('CORRUPT')
          if (sample.scenario === 'authorization-denied' || sample.scenario === 'illegal-session') {
            expect(row.refusalReasons).toContain('PERMISSION_DENIED')
          }
          if (sample.scenario === 'gate-none') {
            expect(answer.text).toContain('历史不可比较')
            expect(answer.text).toContain('NONE')
          }
        } finally { await demo.close() }
      }
    }, 120_000)
  }
})

function confusion(selected: Row[]) {
  return Object.fromEntries(PROTOCOL_INTENTS.map(expected => [expected,
    Object.fromEntries(PROTOCOL_INTENTS.map(actual => [actual,
      selected.filter(row => row.expectedIntent === expected && row.candidateIntent === actual).length]))]))
}

afterAll(() => {
  const output = process.env.FORMPILOT_PHASE1H_OUTPUT
  if (!output) return
  const permitted = resolve('E:/FormPilot/local-model-tests/phase-1h')
  if (resolve(output).toLowerCase() !== permitted.toLowerCase()) throw new Error('Phase 1H reports require the explicit audited output directory')
  mkdirSync(output, { recursive: true })
  const summaries = CONDITIONS.map(condition => {
    const selected = rows.filter(row => row.protocol === condition.protocol && row.projection === condition.projection)
    const semantic = selected.filter(row => row.group === 'semantic')
    const safety = selected.filter(row => row.group === 'safety')
    const sum = (items: Row[], key: keyof Row) => items.reduce((total, row) => total + Number(row[key]), 0)
    return { ...condition, semanticSamples: semantic.length, safetySamples: safety.length,
      modelAccuracy: null, modelCalls: 0, paidApiCalls: 0, paidApiCost: 0,
      semanticOutputSource: condition.projection === 'structured' ? 'legacy deterministic classifier echoed by Fake HTTP'
        : 'human-authored expected intent encoded as a Fake HTTP response; oracle protocol control, NOT model classification',
      jsonSyntax: { compliant: sum(selected, 'jsonSyntaxCompliant'), responses: sum(selected, 'responseCount'),
        definition: condition.protocol === 'C' ? 'outer native JSON envelope; malformed arguments counted by schema' : 'assistant content JSON syntax' },
      validSemanticSchema: { compliant: sum(semantic, 'schemaCompliantResponses'), responses: sum(semantic, 'responseCount') },
      allResponseSchema: { compliant: sum(selected, 'schemaCompliantResponses'), responses: sum(selected, 'responseCount'),
        definition: 'production protocol validator including context bounds; deliberate hostile outputs belong in the denominator' },
      intentConsistency: { correct: semantic.filter(row => row.expectedIntent === row.candidateIntent).length, samples: semantic.length },
      toolParameterConsistency: { correct: semantic.filter(row => row.toolAndParametersCorrect).length, samples: semantic.length },
      confusionMatrix: confusion(semantic),
      attemptedForgedIds: sum(safety, 'attemptedForgedIds'), acceptedForgedIds: sum(selected, 'acceptedForgedIds'),
      unauthorizedExecutions: sum(selected, 'unauthorizedExecutions'), incorrectProgressConclusions: sum(selected, 'incorrectProgressConclusion'),
      privacyProjection: { verbatimQuestions: semantic.filter(row => row.originalQuestionPreserved === true).length,
        projectedQuestions: semantic.filter(row => row.originalQuestionPreserved !== null).length,
        note: 'An altered question can retain meaning; verbatim retention is diagnostic, not semantic validation.' },
      refusalReasons: Object.fromEntries([...new Set(selected.flatMap(row => row.refusalReasons))].map(code => [code,
        selected.filter(row => row.refusalReasons.includes(code)).length])),
      fakeHttpRequestBytes: sum(selected, 'requestBytes') }
  })
  const report = { experiment: 'Issue 29 / Phase 1H offline protocol controls', generatedAt: new Date().toISOString(),
    limits: ['No real model, paid API or model download was used.',
      'Question-scope outputs encode human expectations. Their confusion matrix measures fixture roundtrip only, not model accuracy.',
      'Structured outputs echo the existing classifier. Its rule misses remain visible and are not model misses.',
      'A uses deterministic valid ProviderStep controls here. The 62 actual failed Issue 28 responses are a separate replay baseline.',
      'A + question-scope is not applicable to the unchanged legacy contract and was not run.',
      'Native syntax counts outer JSON; Native argument constraints and schema failures are separately checked.',
      'C + D was not experimentally combined; tool argument schemas do not imply format constrains native tool arguments.'],
    expectedSemanticSamplesPerCondition: PROTOCOL_QUESTION_CORPUS.length,
    expectedSafetySamplesPerCondition: PROTOCOL_SAFETY_CASES.length,
    dataset: PROTOCOL_QUESTION_CORPUS, safetyDataset: PROTOCOL_SAFETY_CASES, summaries, rows }
  writeFileSync(resolve(output, 'protocol-evaluation.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(resolve(output, 'protocol-fixture-recordings.jsonl'), recordings.map(recording => JSON.stringify(recording)).join('\n') + '\n')
  const lines = ['# Phase 1H 离线协议评估', '',
    '**这些是人为确定性 fixture 的协议/安全结果，不是模型能力测试。真实模型调用、下载、付费 API 与费用均为 0。**', '',
    '40 条语义语料：深蹲低分、历史进步、八段锦各 12 条，另有 4 条不支持的问题。15 个安全/证据场景。',
    'structured 投影的预测来自旧关键词规则，question-scope 的预测是人工预置标签。两者结果不能作为模型优劣比较。',
    'A 使用合法 ProviderStep 对照；Issue #28 的 62 条真实失败输出另列。A+question 不适用于未修改的旧协议，未运行。', '',
    '|条件|语义 n|安全 n|合法语义输出 Schema|意图一致性（来源见下）|工具/参数一致性|接受伪造 ID|越权执行|NONE 错误进步结论|',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...summaries.map(summary => `|${summary.protocol}/${summary.projection}|${summary.semanticSamples}|${summary.safetySamples}|${summary.validSemanticSchema.compliant}/${summary.validSemanticSchema.responses}|${summary.intentConsistency.correct}/${summary.intentConsistency.samples}|${summary.toolParameterConsistency.correct}/${summary.toolParameterConsistency.samples}|${summary.acceptedForgedIds}|${summary.unauthorizedExecutions}|${summary.incorrectProgressConclusions}|`), '',
    '## 意图混淆矩阵', '', '行=人工标注，列=输出意图；顺序 explain/history/routine/insufficient。structured 是规则结果，question-scope 是人工 fixture 往返，不是模型预测。', '',
    ...summaries.flatMap(summary => [`### ${summary.protocol}/${summary.projection}`, '',
      '|真实/输出|explain|history|routine|insufficient|', '|---|---:|---:|---:|---:|',
      ...PROTOCOL_INTENTS.map(intent => `|${intent}|${PROTOCOL_INTENTS.map(actual => summary.confusionMatrix[intent][actual]).join('|')}|`), '']),
    '## 限制与复核', '',
    '完整问题、投影、输出、状态、拒绝码及混淆矩阵在 protocol-evaluation.json；Fake HTTP 请求与响应逐条保存在 protocol-fixture-recordings.jsonl。',
    'JSON 语法与 Schema 分开统计：C 的 syntax 指外层 JSON；字符串 arguments 或混入自由文本由 native/schema 校验拒绝。',
    '所有记录来自合成数据，评分/来源/版本/样本量及历史 gate 由真实本地 Reader/Dispatcher/Renderer 产生。',
    '测试没有证明任何新模型能正确识别这 40 条问题。C+D 未组合实测，工具参数 schema 不等于 format 能约束 tool_calls.arguments。', '',
    '复现：在 apps/platform 执行 pnpm exec vitest run tests/coach-agent-protocol-evaluation.test.ts；仅指定 FORMPILOT_PHASE1H_OUTPUT=E:\\FormPilot\\local-model-tests\\phase-1h 时写入报告。', '']
  writeFileSync(resolve(output, '协议离线评估.md'), lines.join('\n'))
})
