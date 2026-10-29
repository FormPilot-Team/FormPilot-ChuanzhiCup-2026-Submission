import { mkdir, writeFile } from 'node:fs/promises'
import { JevDecisionService } from '../server/JevDecisionService.ts'
import { DECISION_SCENARIOS, mockAnswer } from '../src/features/adaptiveTraining/scenarios.ts'
import { ruleBaseline } from '../src/features/adaptiveTraining/decisionPolicy.ts'

const live = process.argv.includes('--live')
if (live) throw new Error('Paid API execution is disabled for this competition. Use npm run adaptive:evaluate.')
const mock = process.argv.includes('--mock')
if (live && mock) throw new Error('Choose --live or --mock')
if (live && !process.env.TYPESAFE_API_KEY) throw new Error('Set TYPESAFE_API_KEY in the server environment before --live. No official requests made.')
const mode = live ? 'live' : mock ? 'mock' : 'fallback'
const official = new JevDecisionService({ apiKey: live ? process.env.TYPESAFE_API_KEY : undefined })
const rows = []
for (const scenario of DECISION_SCENARIOS) {
  let mockReturn: unknown = null
  const faultInjected = Boolean(scenario.fault)
  const useMock = mock || faultInjected
  const fakeFetch: typeof fetch = async (_url, options) => {
    if (scenario.fault === 'failure') throw new Error('Injected network failure')
    if (scenario.fault === 'timeout') return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('Injected timeout')), { once: true })
    })
    mockReturn = scenario.fault === 'invalid' ? { model: 'jev-mock', answers: { intervention: { type: 'choice', choice: 'ILLEGAL' } }, usage: { input_tokens: 0, output_tokens: 0 } }
      : { model: 'jev-mock', answers: { intervention: mockAnswer(scenario.mockChoice) }, usage: { input_tokens: 0, output_tokens: 0 } }
    return Response.json(mockReturn)
  }
  const service = useMock ? new JevDecisionService({ apiKey: 'mock-test-only', fetcher: fakeFetch, timeoutMs: 20 }) : official
  const started = performance.now()
  const result = await service.decide(scenario.input)
  const measuredMs = Math.round((performance.now() - started) * 100) / 100
  const decision = useMock && result.source === 'jev' ? { ...result, source: 'mock', model: 'mock-local' } : result
  rows.push({
    id: scenario.id, name: scenario.name, input: scenario.input,
    baselineResult: { ...ruleBaseline(), issueCodes: scenario.input.errors.map(e => e.code) },
    actualJevReturn: !useMock && result.source === 'jev' ? { model: result.model, answer: result.modelAnswer } : null,
    mockJevReturn: mockReturn, faultInjection: scenario.fault ?? null,
    finalDecision: decision, latencyMs: measuredMs, safetyFallback: result.safetyFallback,
    validationPassed: useMock ? result.strategy === scenario.expected : result.strategy === 'CONTINUE_STANDARD' || result.source === 'jev',
  })
}
await mkdir('docs/competition', { recursive: true })
const report = {
  generatedAt: new Date().toISOString(), mode, officialEndpoint: 'https://api.typesafe.ai/v1/systemone',
  realJevResponses: rows.filter(r => r.actualJevReturn !== null).length,
  note: 'Mock outputs and injected faults are not Jev measurements. Local latency is not model performance. No accuracy or improvement conclusions.',
  scenarios: rows,
}
await writeFile(`docs/competition/jev-results.${mode}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`${mode}: ${rows.length} scenarios, ${report.realJevResponses} real Jev responses, ${rows.filter(r => r.validationPassed).length} validations passed`)
if (rows.some(r => !r.validationPassed)) process.exitCode = 1
