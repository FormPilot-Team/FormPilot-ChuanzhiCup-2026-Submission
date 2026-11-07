/**
 * Phase 3 I4 behaviour probes (pre-declared 2026-11-07). Descriptive, NOT accuracy: synthetic probe users run through the
 * released public engine (and, for I3 / ablation views, the UNBOUND research variants). Inputs and outputs are saved verbatim.
 *   node <vite-node.mjs> scripts/decision-model/cdm/probes.ts --variants scripts/decision-model/cdm/artifacts/integration/variants --out <file.json>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'
import { getCoachWebRecommendation } from '../../../src/features/coachAgent/recommendation/webService'
import type { BodyRegion, CoachProfile } from '../../../src/features/coachAgent/recommendation/types'
import { getCoachDecisionRecommendation } from '../../../src/features/coachAgent/decisionModel/adapter'
import { COACH_DECISION_CONTRACT, createCoachDecisionEngine, recommendCoachDecision, type CoachDecisionInput, type CoachDecisionResponse } from '../../../src/features/coachAgent/decisionModel/engine'

const args = process.argv.slice(2)
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const NOW = Date.UTC(2026, 10, 8, 12)
const DAY = 86_400_000
const byId = new Map(COACH_KNOWLEDGE.map(e => [e.id, e]))
const base: CoachProfile = { version: 1, goals: ['upper_limb'], difficulties: ['stiffness'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true }
const P = (o: Partial<CoachProfile> = {}): CoachProfile => ({ ...base, ...o })
const inp = (profile: CoachProfile, o: Partial<CoachDecisionInput> = {}): CoachDecisionInput => ({ contract: COACH_DECISION_CONTRACT, profile, now: NOW, ...o })
const ACTIVE = { mode: 'active' as const, allowExperimentalModel: true }
const run = (i: CoachDecisionInput, engine = recommendCoachDecision, opts: Parameters<typeof recommendCoachDecision>[1] = ACTIVE) => engine(i, opts)
const r4 = (x: number) => Math.round(x * 1e4) / 1e4
const slate = (r: CoachDecisionResponse) => (r.decisionOrigin === 'model' ? [...r.display!.result.chapters, ...r.display!.result.games].map(x => x.entry.id) : r.ranking.filter(x => x.inSlate).map(x => x.id))
const rulesSlate = (p: CoachProfile) => { const r = getCoachWebRecommendation({ schemaVersion: 1, source: 'rules', profile: p }).result; return r ? [...r.chapters, ...r.games].map(x => x.entry.id) : [] }
const pr49Slate = (p: CoachProfile) => { const r = getCoachDecisionRecommendation({ schemaVersion: 1, source: 'rules', profile: p }, { mode: 'active' }).active.result; return r ? [...r.chapters, ...r.games].map(x => x.entry.id) : [] }
const top = (r: CoachDecisionResponse, k = 5) => r.ranking.slice(0, k).map(x => ({ id: x.id, title: x.title, score: x.score, suitability: x.suitability, inSlate: x.inSlate, reasons: x.reasons }))
const jaccard = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); const u = new Set([...A, ...B]).size; return u ? r4([...A].filter(x => B.has(x)).length / u) : 1 }
/** Kendall tau-b over the items both rankings contain. */
function kendall(a: string[], b: string[]) {
  const common = a.filter(x => b.includes(x)); if (common.length < 2) return null
  const pa = new Map(a.map((x, i) => [x, i])), pb = new Map(b.map((x, i) => [x, i])); let c = 0, d = 0
  for (let i = 0; i < common.length; i += 1) for (let j = i + 1; j < common.length; j += 1) {
    const s = Math.sign((pa.get(common[i])! - pa.get(common[j])!) * (pb.get(common[i])! - pb.get(common[j])!)); if (s > 0) c += 1; else if (s < 0) d += 1
  }
  return r4((c - d) / (c + d))
}
const ids = (r: CoachDecisionResponse) => r.ranking.map(x => x.id)
const regionPrecision = (p: CoachProfile, s: string[]) => (s.length ? r4(s.filter(id => byId.get(id)!.regions.some(x => p.regions.includes(x))).length / s.length) : null)
const regionCoverage = (p: CoachProfile, s: string[]) => { const c = new Set(s.flatMap(id => byId.get(id)!.regions)); return r4(p.regions.filter(x => c.has(x)).length / p.regions.length) }
const focusCount = (s: string[]) => { const out: Record<string, number> = {}; for (const id of s) for (const f of byId.get(id)!.focuses) out[f] = (out[f] ?? 0) + 1; return out }
const summary = (r: CoachDecisionResponse) => ({ decisionOrigin: r.decisionOrigin, status: r.status, fallbackReason: r.fallbackReason, abstainReason: r.abstainReason, outOfDistributionFeatures: r.outOfDistributionFeatures, confidence: r.confidence, slate: slate(r), top5: top(r) })
const out: Record<string, unknown> = { schemaVersion: 1, generatedAt: new Date().toISOString(), engine: 'fp-cdm-release/1.0.0 via recommendCoachDecision (ACTIVE + owner flag for the probe)', now: NOW,
  note: 'Synthetic probe users (not real users). Descriptive behaviour of the released model; AI-label experimental tier. Not accuracy, not clinical evidence.' }

// P1 goal sweep
const goals: CoachProfile['goals'][] = [['upper_limb'], ['mobility'], ['daily'], ['mobility', 'daily'], ['rehab_support']]
const g0 = run(inp(base))
out.goalSweep = goals.map(g => {
  const p = P({ goals: g }); const r = run(inp(p))
  return { input: inp(p), ...summary(r), limitedProfileSafetyPoolChanged: g.includes('rehab_support'), slateFocus: focusCount(slate(r)), kendallVsUpperLimbOverCommon: kendall(ids(g0), ids(r)), slateJaccardVsUpperLimb: jaccard(slate(g0), slate(r)),
    rulesP0Slate: rulesSlate(p), pr49Slate: pr49Slate(p), rulesSlateJaccardVsUpperLimb: jaccard(rulesSlate(base), rulesSlate(p)) }
})
// P2 region sweep
const regionSets: BodyRegion[][] = [['shoulders'], ['neck'], ['arms'], ['trunk'], ['legs'], ['shoulders', 'neck'], ['trunk', 'legs'], ['arms', 'legs'], ['shoulders', 'arms']]
out.regionSweep = regionSets.map(regions => {
  const p = P({ regions }); const r = run(inp(p)); const s = slate(r), rp = rulesSlate(p), pr = pr49Slate(p)
  return { input: inp(p), ...summary(r), model: { regionPrecision: regionPrecision(p, s), regionCoverage: regionCoverage(p, s) }, rulesP0: { slate: rp, regionPrecision: regionPrecision(p, rp), regionCoverage: regionCoverage(p, rp) }, pr49: { slate: pr, regionPrecision: regionPrecision(p, pr), regionCoverage: regionCoverage(p, pr) } }
})
// P3 training-stage trajectory (same user, growing history)
const ch = (chapterId: string, sessions: number, meanScore: number, trend: 'up' | 'flat' | 'down', daysAgo: number, completed = sessions) => ({ chapterId, sessions, completedSessions: completed, meanScore, trend, lastPracticedAt: NOW - daysAgo * DAY })
const stages: Array<[string, Partial<CoachDecisionInput>]> = [
  ['S0 新用户（无历史）', {}],
  ['S1 第 1 周：八段锦第一式 2 次', { trainingHistory: { origin: 'synthetic_demo', chapters: [ch('bdj-1', 2, 62, 'flat', 2)] } }],
  ['S2 第 2 周：第一、二式 + 摘苹果', { trainingHistory: { origin: 'synthetic_demo', chapters: [ch('bdj-1', 5, 70, 'up', 5), ch('bdj-2', 3, 64, 'flat', 2)] }, gameHistory: { origin: 'synthetic_demo', games: [{ gameId: 'apple', plays: 3, completedPlays: 3, lastPlayedAt: NOW - 1 * DAY }] } }],
  ['S3 第 4 周：八段锦前四式 + 太极起势 + 划船', { trainingHistory: { origin: 'synthetic_demo', chapters: [ch('bdj-1', 8, 78, 'up', 6), ch('bdj-2', 7, 74, 'up', 4), ch('bdj-3', 6, 72, 'up', 2), ch('bdj-4', 4, 70, 'flat', 1), ch('tjq-1', 2, 60, 'flat', 3)] },
    gameHistory: { origin: 'synthetic_demo', games: [{ gameId: 'apple', plays: 6, completedPlays: 6, lastPlayedAt: NOW - 3 * DAY }, { gameId: 'boating', plays: 5, completedPlays: 4, lastPlayedAt: NOW - 1 * DAY }] } }],
]
const s0 = run(inp(base))
out.trainingStages = stages.map(([label, extra]) => {
  const i = inp(base, extra); const r = run(i)
  const practised = new Set([...(i.trainingHistory?.chapters ?? []).map(c => c.chapterId), ...(i.gameHistory?.games ?? []).map(g => g.gameId)])
  return { label, input: i, ...summary(r), kendallVsS0: kendall(ids(s0), ids(r)), slateNovelShare: slate(r).length ? r4(slate(r).filter(id => !practised.has(id)).length / slate(r).length) : null,
    ranks: Object.fromEntries(['bdj-1', 'bdj-2', 'bdj-3', 'bdj-4', 'bdj-5', 'apple', 'boating', 'archery'].map(id => [id, r.ranking.find(x => x.id === id)?.rank ?? null])) }
})
// P4 latest report
const s2 = stages[2][1]
const withReport = (focus: 'stability' | 'reach' | 'rhythm', trend: 'worse' | 'same') => inp(base, { ...s2, latestReport: { origin: 'synthetic_demo', createdAt: NOW - DAY, findings: [{ focus, subjectId: 'bdj-2', score: 52, trend }] } })
const noReport = run(inp(base, s2))
out.reportProbe = (['stability', 'reach', 'rhythm'] as const).map(focus => {
  const i = withReport(focus, 'worse'); const r = run(i)
  const focusIds = r.ranking.filter(x => byId.get(x.id)!.focuses.includes(focus)).map(x => x.id)
  const meanRank = (resp: CoachDecisionResponse) => r4(focusIds.reduce((s, id) => s + (resp.ranking.find(x => x.id === id)?.rank ?? 0), 0) / Math.max(1, focusIds.length))
  return { input: i, ...summary(r), focus, candidatesWithFocus: focusIds.length, meanRankWithReport: meanRank(r), meanRankWithoutReport: meanRank(noReport), kendallVsNoReport: kendall(ids(noReport), ids(r)) }
})
// P5 risk
out.riskProbe = (['none', 'acute_pain', 'dizziness', 'recent_injury'] as const).map(risk => { const i = inp(P({ risk })); const r = run(i); return { input: i, ...summary(r), execution: r.execution, displayStatus: r.display?.result.status ?? null, message: r.display?.result.message ?? null } })
// P6 out of distribution
const oodP = P({ goals: ['mobility'], difficulties: ['none'], regions: ['shoulders', 'neck', 'arms', 'legs'], preference: 'routine' })
const nearP = P({ goals: ['mobility'], difficulties: ['none'], regions: ['shoulders', 'neck', 'arms'], preference: 'routine' })
out.oodProbe = [oodP, nearP].map(p => { const i = inp(p); const r = run(i); return { input: i, ...summary(r), displayIsRules: r.decisionOrigin === 'rules' } })
// P7 robustness to small input perturbations (history numbers jittered, seed-fixed)
let seed = 20261107; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const s2in = inp(base, s2); const s2r = run(s2in); const taus: number[] = []; let top1Same = 0, slateSame = 0
const trials = 200
for (let t = 0; t < trials; t += 1) {
  const j = structuredClone(s2in)
  for (const c of j.trainingHistory!.chapters) { c.meanScore = Math.max(0, Math.min(100, (c.meanScore ?? 60) + Math.round((rnd() - 0.5) * 10))); c.lastPracticedAt = (c.lastPracticedAt ?? NOW) - Math.round((rnd() - 0.5) * 2) * DAY; if (rnd() < 0.3) c.sessions = Math.max(1, c.sessions + (rnd() < 0.5 ? -1 : 1)); c.completedSessions = Math.min(c.sessions, c.completedSessions ?? c.sessions) }
  for (const c of j.trainingHistory!.chapters) c.lastPracticedAt = Math.min(NOW, c.lastPracticedAt ?? NOW)
  const r = run(j); taus.push(kendall(ids(s2r), ids(r)) ?? 1); if (r.ranking[0]?.id === s2r.ranking[0]?.id) top1Same += 1; if (slate(r).join() === slate(s2r).join()) slateSame += 1
}
taus.sort((a, b) => a - b)
out.perturbation = { base: s2in, trials, perturbation: 'meanScore ±5, lastPracticedAt ±1 day, sessions ±1 with p=0.3', kendallMedian: taus[Math.floor(trials / 2)], kendallP05: taus[Math.floor(trials * 0.05)], top1Unchanged: r4(top1Same / trials), slateUnchanged: r4(slateSame / trials) }
// P8 research variants and training-stage checkpoints (UNBOUND; SHADOW ranking), compared with the release
const vdir = arg('--variants')
if (vdir) {
  const variants = readdirSync(vdir).filter(f => f.endsWith('.weights.json')).sort()
  const users: Array<[string, CoachDecisionInput]> = [['基础画像', inp(base)], ['S2 有历史', inp(base, s2)], ['S3 有历史', inp(base, stages[3][1])], ['S2 + 报告', withReport('stability', 'worse')],
    ['颈肩', inp(P({ goals: ['mobility'], regions: ['neck', 'shoulders'], preference: 'routine' }))], ['下肢躯干 / 游戏', inp(P({ goals: ['daily'], difficulties: ['sedentary'], regions: ['legs', 'trunk'], preference: 'game' }))]]
  const release = users.map(([, i]) => run(i, recommendCoachDecision, { mode: 'shadow' }))
  out.variants = variants.map(file => {
    const w = JSON.parse(readFileSync(resolve(vdir, file), 'utf8'))
    const engine = createCoachDecisionEngine({ weights: w, binding: 'unbound' })
    return { file, variant: w.variant?.name, note: w.variant?.note, trainFamilies: w.variant?.trainFamilies?.length, features: w.featureNames.length,
      users: users.map(([label, i], k) => { const r = engine.recommend(i, { mode: 'shadow' }); return { label, top3: r.ranking.slice(0, 3).map(x => x.id), kendallVsRelease: kendall(ids(release[k]), ids(r)), top3OverlapWithRelease: release[k].ranking.slice(0, 3).filter(x => r.ranking.slice(0, 3).some(y => y.id === x.id)).length, fallbackReason: r.fallbackReason, abstainReason: r.abstainReason } }) }
  })
  out.variantUsers = users.map(([label, i], k) => ({ label, input: i, releaseTop3: release[k].ranking.slice(0, 3).map(x => x.id) }))
}
const file = arg('--out') ?? 'probes.json'
writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`)
const brief = {
  goal: (out.goalSweep as Array<Record<string, unknown>>).map(g => [JSON.stringify((g.input as CoachDecisionInput).profile.goals), g.slate, g.kendallVsUpperLimbOverCommon, g.slateJaccardVsUpperLimb, g.rulesSlateJaccardVsUpperLimb]),
  region: (out.regionSweep as Array<Record<string, any>>).map(g => [g.input.profile.regions.join('+'), g.model.regionPrecision, g.rulesP0.regionPrecision, g.pr49.regionPrecision, g.fallbackReason]),
  stages: (out.trainingStages as Array<Record<string, any>>).map(s => [s.label, s.slate, s.kendallVsS0, s.slateNovelShare, JSON.stringify(s.ranks)]),
  report: (out.reportProbe as Array<Record<string, any>>).map(s => [s.focus, s.meanRankWithoutReport, s.meanRankWithReport, s.kendallVsNoReport]),
  risk: (out.riskProbe as Array<Record<string, any>>).map(s => [s.input.profile.risk, s.fallbackReason, s.execution]),
  ood: (out.oodProbe as Array<Record<string, any>>).map(s => [s.input.profile.regions.length, s.fallbackReason, s.abstainReason, s.outOfDistributionFeatures]),
  perturbation: out.perturbation && { ...(out.perturbation as Record<string, unknown>), base: undefined },
  variants: ((out.variants ?? []) as Array<Record<string, any>>).map(v => [v.variant, v.users.map((u: any) => u.kendallVsRelease)]),
}
console.log(JSON.stringify(brief, null, 0).replace(/\],\[/g, '],\n['))
