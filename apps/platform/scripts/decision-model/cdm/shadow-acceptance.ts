/**
 * SHADOW acceptance checker (WEB_INTEGRATION_READY.md §10). Reads the SHADOW logs exported from the Web acceptance build
 * (one JSON file per device: an array of CoachDecisionShadowLogEntry, or { entries: [...] }) and reports PASS / INSUFFICIENT / FAIL.
 *   node <VN> scripts/decision-model/cdm/shadow-acceptance.ts --log deviceA.json --log deviceB.json [--out report.json]
 *   node <VN> scripts/decision-model/cdm/shadow-acceptance.ts --self-test     # synthetic scenarios: checks the checker, NOT acceptance evidence
 * SHADOW acceptance checks wiring, safety and stability with real usage. It does not measure recommendation quality.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { CoachProfile } from '../../../src/features/coachAgent/recommendation/types'
import { COACH_DECISION_CONTRACT, recommendCoachDecision, type CoachDecisionInput } from '../../../src/features/coachAgent/decisionModel/engine'
import { toShadowLogEntry, type CoachDecisionShadowLogEntry } from '../../../src/features/coachAgent/decisionModel/engine/shadow'
import type { SyntheticHistory, SyntheticReport } from './scenarioTypes'
import { checkShadowLogs, type ShadowDevice } from './shadowCheck'

function readDevice(path: string): ShadowDevice {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  const entries = Array.isArray(raw) ? raw : (raw as { entries?: unknown[] })?.entries
  if (!Array.isArray(entries)) throw new Error(`${path}: 需要记录数组或 { entries: [...] }`)
  return { name: basename(path), entries: entries as CoachDecisionShadowLogEntry[] }
}

function selfTestLog(): ShadowDevice {
  const DAY = 86_400_000
  const NOW = Date.UTC(2026, 10, 7, 12)
  const file = JSON.parse(readFileSync(resolve('scripts/decision-model/cdm/data/scenarios.v1.json'), 'utf8')) as { scenarios: Array<{ profile: CoachProfile; history: SyntheticHistory | null; report: SyntheticReport | null }> }
  const entries = file.scenarios.map(s => {
    const input: CoachDecisionInput = {
      contract: COACH_DECISION_CONTRACT, profile: s.profile, now: NOW,
      trainingHistory: s.history?.routines?.length ? { origin: 'synthetic_demo', chapters: s.history.routines.map(r => ({ chapterId: r.chapterId, sessions: r.sessions, completedSessions: r.completedSessions, meanScore: r.meanScore, trend: r.trend, lastPracticedAt: NOW - r.lastDaysAgo * DAY })) } : null,
      gameHistory: s.history?.games?.length ? { origin: 'synthetic_demo', games: s.history.games.map(g => ({ gameId: g.gameId, plays: g.plays, completedPlays: g.completedPlays, lastPlayedAt: NOW - g.lastDaysAgo * DAY })) } : null,
      latestReport: s.report ? { origin: 'synthetic_demo', createdAt: NOW - s.report.daysAgo * DAY, findings: s.report.findings.map(f => ({ focus: f.focus, subjectId: f.subjectId, score: f.score, trend: f.trend })) } : null,
    }
    const t0 = performance.now()
    const res = recommendCoachDecision(input, { mode: 'shadow' })
    return toShadowLogEntry(res, { at: NOW, elapsedMs: performance.now() - t0 })
  })
  return { name: 'self-test-synthetic-72-scenarios', entries }
}

const args = process.argv.slice(2)
const OUT = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : args.includes('--self-test') ? 'scripts/decision-model/cdm/artifacts/integration/shadow-acceptance-selftest.json' : 'shadow-acceptance-report.json')
let report: unknown
if (args.includes('--self-test')) {
  const clean = selfTestLog()
  // Negative control: a log where the Web showed the model ranking in SHADOW must FAIL H3.
  const tampered: ShadowDevice = { name: 'self-test-tampered', entries: clean.entries.map((e, i) => (i % 9 === 0 && e.modelSlate.chapters.length ? { ...e, displayed: { ...e.displayed, chapters: [...e.modelSlate.chapters] } } : e)) }
  report = { note: '合成场景自检：验证检查器本身，不是 SHADOW 验收证据（无真实设备、无本机记录）。', clean: checkShadowLogs([clean]), negativeControlTampered: checkShadowLogs([tampered]) }
} else {
  const logs = args.flatMap((a, i) => (a === '--log' ? [args[i + 1]] : []))
  if (!logs.length) throw new Error('用法：--log <file.json> [--log ...] 或 --self-test')
  report = { logs, ...checkShadowLogs(logs.map(readDevice)) }
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
const r = report as { verdict?: string; clean?: { verdict: string; hard: Record<string, { status: string }> }; negativeControlTampered?: { verdict: string; hard: Record<string, { status: string; violations: number }> } }
console.log(JSON.stringify(r.clean ? { out: OUT, clean: r.clean.verdict, cleanHard: Object.fromEntries(Object.entries(r.clean.hard).map(([k, v]) => [k, v.status])), tampered: r.negativeControlTampered!.verdict, tamperedH3: r.negativeControlTampered!.hard.H3_display_is_rules } : { out: OUT, verdict: r.verdict }))
