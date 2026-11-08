/**
 * SHADOW acceptance rules (pure; no I/O). Used by shadow-acceptance.ts and the engine tests.
 * Hard checks must have zero violations; coverage short -> INSUFFICIENT; "observed" is descriptive only.
 */
import { FP_CDM_RELEASE } from '../../../src/features/coachAgent/decisionModel/engine'
import { COACH_DECISION_SHADOW_LOG_SCHEMA, type CoachDecisionShadowLogEntry } from '../../../src/features/coachAgent/decisionModel/engine/shadow'

export const MIN_READY_ENTRIES = 30
export const MIN_DEVICES = 3
export const MIN_LIVE_HISTORY_ENTRIES = 10
export const MAX_P95_MS = 10
const BUNDLE_FAILURES = new Set(['MODEL_MISSING', 'MODEL_NOT_TRAINED', 'WEIGHTS_INVALID', 'MODEL_VERSION_MISMATCH', 'LABELS_NOT_ACCEPTED', 'CATALOGUE_MISMATCH', 'CONTENT_FEATURES_MISMATCH', 'UNBOUND_WEIGHTS'])

export type ShadowDevice = { name: string; entries: CoachDecisionShadowLogEntry[] }
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const quantile = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }
const count = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m }, {})

export function checkShadowLogs(devices: ShadowDevice[]) {
  const all = devices.flatMap(d => d.entries.map((e, i) => ({ device: d.name, i, e })))
  const hard: Record<string, { rule: string; violations: string[] }> = {
    H1_schema: { rule: `每条记录 schema = ${COACH_DECISION_SHADOW_LOG_SCHEMA}`, violations: [] },
    H2_mode: { rule: '所有记录 mode = shadow', violations: [] },
    H3_display_is_rules: { rule: '用户看到的（displayed）与规则结果完全相同，decisionOrigin = rules', violations: [] },
    H4_release: { rule: `发布号 ${FP_CDM_RELEASE.release}、权重指纹 ${FP_CDM_RELEASE.m2.weightsFingerprint}，无模型文件完整性失败`, violations: [] },
    H5_wiring: { rule: '无 INPUT_INVALID / INVALID_AVAILABILITY，inputIssueCount = 0', violations: [] },
    H6_model_faults: { rule: '无 MODEL_ERROR / OUTPUT_GUARD_REJECTED，Guard 违规为 0', violations: [] },
    H7_safety: { rule: 'safety_hold 时模型未运行且未展示任何内容', violations: [] },
  }
  for (const { device, i, e } of all) {
    const at = `${device}#${i}`
    if (e?.schema !== COACH_DECISION_SHADOW_LOG_SCHEMA) { hard.H1_schema.violations.push(at); continue }
    if (e.mode !== 'shadow') hard.H2_mode.violations.push(`${at}:${e.mode}`)
    if (e.decisionOrigin !== 'rules' || !same(e.displayed.routines, e.rules.routines) || !same(e.displayed.chapters, e.rules.chapters) || !same(e.displayed.games, e.rules.games)) hard.H3_display_is_rules.violations.push(at)
    if ((e.release !== null && (e.release !== FP_CDM_RELEASE.release || e.weightsFingerprint !== FP_CDM_RELEASE.m2.weightsFingerprint)) || BUNDLE_FAILURES.has(e.fallbackReason ?? '')) hard.H4_release.violations.push(`${at}:${e.fallbackReason ?? e.release}`)
    if (e.fallbackReason === 'INPUT_INVALID' || e.fallbackReason === 'INVALID_AVAILABILITY' || e.inputIssueCount > 0) hard.H5_wiring.violations.push(`${at}:${e.fallbackReason}`)
    if (e.fallbackReason === 'MODEL_ERROR' || e.fallbackReason === 'OUTPUT_GUARD_REJECTED' || e.guardViolations.length) hard.H6_model_faults.violations.push(`${at}:${e.fallbackReason}`)
    if (e.status === 'safety_hold' && (e.execution === 'executed' || e.displayed.chapters.length || e.displayed.games.length || e.displayed.routines.length)) hard.H7_safety.violations.push(at)
  }
  const valid = all.map(x => x.e).filter(e => e?.schema === COACH_DECISION_SHADOW_LOG_SCHEMA)
  const ms = valid.map(e => e.elapsedMs).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  const p95 = quantile(ms, 0.95)
  const latency = { rule: `调用耗时 p95 ≤ ${MAX_P95_MS} ms`, measured: ms.length, p50: quantile(ms, 0.5), p95, max: ms.length ? Math.max(...ms) : null, status: ms.length === 0 ? 'NOT_MEASURED' : p95! <= MAX_P95_MS ? 'PASS' : 'FAIL' }
  const ready = valid.filter(e => e.status === 'ready')
  const executed = ready.filter(e => e.execution === 'executed')
  const coverage = {
    C1_ready_entries: { need: MIN_READY_ENTRIES, have: ready.length },
    C2_devices: { need: MIN_DEVICES, have: devices.filter(d => d.entries.length).length },
    C3_live_history_entries: { need: MIN_LIVE_HISTORY_ENTRIES, have: valid.filter(e => e.dataSources.trainingHistory === 'live_local_records').length },
  }
  const hardFail = Object.values(hard).some(h => h.violations.length) || latency.status === 'FAIL'
  const coverageShort = Object.values(coverage).some(c => c.have < c.need) || latency.status === 'NOT_MEASURED'
  const abstained = executed.filter(e => e.fallbackReason === 'MODEL_ABSTAINED')
  const compared = executed.filter(e => e.fallbackReason === 'SHADOW_MODE')
  return {
    verdict: hardFail ? 'FAIL' : coverageShort ? 'INSUFFICIENT' : 'PASS',
    hard: Object.fromEntries(Object.entries(hard).map(([k, h]) => [k, { rule: h.rule, status: h.violations.length ? 'FAIL' : 'PASS', violations: h.violations.length, examples: h.violations.slice(0, 10) }])),
    latency, coverage: Object.fromEntries(Object.entries(coverage).map(([k, c]) => [k, { ...c, status: c.have >= c.need ? 'OK' : 'SHORT' }])),
    // Descriptive only (no pass/fail): how the model would behave for these users if ACTIVE were approved.
    observed: {
      entries: valid.length, devices: devices.length, status: count(valid, e => e.status), fallbackReason: count(valid, e => e.fallbackReason ?? 'null'),
      modelExecutedShareOfReady: ready.length ? executed.length / ready.length : null,
      abstainShareOfExecuted: executed.length ? abstained.length / executed.length : null,
      abstainReason: count(abstained, e => e.abstainReason ?? 'null'),
      outOfDistributionFeatures: count(abstained.flatMap(e => e.outOfDistributionFeatures.length ? e.outOfDistributionFeatures : ['(none)']), x => x),
      rankingEffect: count(compared, e => e.rankingEffect),
      top1ChapterAgreement: compared.length ? compared.filter(e => e.modelSlate.chapters[0] !== undefined && e.modelSlate.chapters[0] === e.rules.chapters[0]).length / compared.length : null,
      dataSources: { trainingHistory: count(valid, e => e.dataSources.trainingHistory), latestReport: count(valid, e => e.dataSources.latestReport), gameHistory: count(valid, e => e.dataSources.gameHistory) },
    },
  }
}

