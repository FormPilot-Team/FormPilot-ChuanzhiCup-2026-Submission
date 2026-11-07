/**
 * fp-cdm E2 (personalisation), E4 (safety), E5 (performance) over the full self-report profile space, measured through the
 * PUBLIC engine (recommendCoachDecision) exactly as the Web will call it.
 *   node <vite-node.mjs> scripts/decision-model/cdm/evaluate-cdm.ts --out <dir>                 # bundled release (ACTIVE, owner-approved flag)
 *   node <vite-node.mjs> scripts/decision-model/cdm/evaluate-cdm.ts --out <dir> --weights <w>   # unbound research weights (slate from the ranking)
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'
import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'
import { getCoachWebRecommendation } from '../../../src/features/coachAgent/recommendation/webService'
import type { BodyRegion, CoachProfile, KnowledgeEntry } from '../../../src/features/coachAgent/recommendation/types'
import { getCoachDecisionRecommendation } from '../../../src/features/coachAgent/decisionModel/adapter'
import { isLimitedProfile } from '../../../src/features/coachAgent/decisionModel/ranker'
import { BUNDLED_WEIGHTS, FEATURE_NAMES, loadWeights, type CdmWeights } from '../../../src/features/coachAgent/decisionModel/cdm'
import { COACH_DECISION_CONTRACT, createCoachDecisionEngine, FP_CDM_RELEASE, type CoachDecisionResponse } from '../../../src/features/coachAgent/decisionModel/engine'

const args = process.argv.slice(2)
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const OUT = resolve(arg('--out') ?? 'test-results/cdm-eval'); mkdirSync(OUT, { recursive: true })
const weightsPath = arg('--weights')
const NOW = Date.UTC(2026, 10, 8)
let weights: CdmWeights
let engine: ReturnType<typeof createCoachDecisionEngine>
if (weightsPath) {
  const status = loadWeights(JSON.parse(readFileSync(weightsPath, 'utf8')))
  if (!status.ok) throw new Error(`weights refused: ${status.reason}`)
  weights = status.weights
  engine = createCoachDecisionEngine({ weights, binding: 'unbound', now: () => NOW })
} else {
  if (!BUNDLED_WEIGHTS.ok) throw new Error(`bundled weights refused: ${BUNDLED_WEIGHTS.reason}`)
  weights = BUNDLED_WEIGHTS.weights
  engine = createCoachDecisionEngine({ now: () => NOW })
}
const MODE = weightsPath ? { mode: 'shadow' as const } : { mode: 'active' as const, allowExperimentalModel: true }
const byId = new Map(COACH_KNOWLEDGE.map(e => [e.id, e]))
const REGIONS: BodyRegion[] = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
const subsets = <T>(items: readonly T[]): T[][] => Array.from({ length: (1 << items.length) - 1 }, (_, m) => items.filter((_, b) => ((m + 1) >> b) & 1))
const profiles: CoachProfile[] = []
for (const goals of subsets(['mobility', 'upper_limb', 'daily', 'rehab_support'] as const)) for (const difficulties of [['none'] as CoachProfile['difficulties'], ...subsets(['stiffness', 'reach_difficulty', 'soreness', 'sedentary'] as const)])
  for (const regions of subsets(REGIONS)) for (const preference of ['routine', 'game', 'mixed'] as const) profiles.push({ version: 1, goals: [...goals], difficulties: [...difficulties], regions: [...regions], preference, risk: 'none', acknowledged: true })
const inp = (p: unknown, extra: Record<string, unknown> = {}) => ({ contract: COACH_DECISION_CONTRACT, profile: p, now: NOW, ...extra })
const req = (p: unknown) => ({ schemaVersion: 1, source: 'rules', profile: p })
const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] }
const r4 = (x: number) => Number(x.toFixed(4))
/** What the user would see from the model: the ACTIVE display, or (unbound research weights) the in-slate items of the ranking. */
const modelSlate = (r: CoachDecisionResponse): KnowledgeEntry[] | null => {
  if (r.decisionOrigin === 'model') return [...r.display!.result.chapters, ...r.display!.result.games].map(x => x.entry)
  if (r.execution === 'executed' && !r.abstained && ['SHADOW_MODE', 'UNBOUND_WEIGHTS'].includes(String(r.fallbackReason))) return r.ranking.filter(x => x.inSlate).map(x => byId.get(x.id)!)
  return null
}
// Ordered slate key, same definition as round 2: chapters in display order | games in display order.
const slateKey = (entries: KnowledgeEntry[] | null) => (entries ? `${entries.filter(e => e.kind === 'chapter').map(e => e.id).join(',')}|${entries.filter(e => e.kind === 'game').map(e => e.id).join(',')}` : 'none')
const cover = (p: CoachProfile, entries: KnowledgeEntry[] | null) => { const c = new Set((entries ?? []).flatMap(x => x.regions)); return p.regions.filter(x => c.has(x)).length / p.regions.length }

// ---------------- E4 safety ----------------
const e4: Record<string, unknown> = {}
let riskExec = 0, riskHold = 0
const riskSample = profiles.filter((_, i) => i % 5 === 0)
for (const risk of ['acute_pain', 'dizziness', 'recent_injury'] as const) for (const p of riskSample) {
  const r = engine.recommend(inp({ ...p, risk }), MODE); if (r.execution === 'executed') riskExec += 1; if (r.status === 'safety_hold') riskHold += 1
}
e4.riskProfiles = { checked: riskSample.length * 3, held: riskHold, modelExecutions: riskExec }
let limitedLeak = 0, hrefLeak = 0, executed = 0, rankingLeak = 0
const outcomes = new Map<string, number>()
for (const p of profiles) {
  const r = engine.recommend(inp(p), MODE)
  outcomes.set(String(r.abstainReason ?? r.fallbackReason), (outcomes.get(String(r.abstainReason ?? r.fallbackReason)) ?? 0) + 1)
  if (r.execution === 'executed') executed += 1
  for (const e of modelSlate(r) ?? []) {
    if (isLimitedProfile(p) && e.caution.length) limitedLeak += 1
    if (e.kind === 'chapter' && e.href === null) hrefLeak += 1
  }
  if (isLimitedProfile(p)) rankingLeak += r.ranking.filter(x => (byId.get(x.id)?.caution.length ?? 0) > 0).length
}
e4.profileSpace = { profiles: profiles.length, executed, outcomes: Object.fromEntries(outcomes), limitedCautionItemsShown: limitedLeak, limitedCautionItemsRanked: rankingLeak, nonLaunchableChapters: hrefLeak }
const adversarial: CdmWeights = { ...weights, coef: FEATURE_NAMES.map(n => /c_caution|x_diff_.*_caution_count|c_deepknee/.test(n) ? 25 : 0) }
const adv = createCoachDecisionEngine({ weights: adversarial, binding: 'unbound', now: () => NOW })
let advLeak = 0, advLimited = 0
for (const p of profiles.filter(isLimitedProfile).filter((_, i) => i % 3 === 0)) { advLimited += 1; advLeak += adv.recommend(inp(p), { mode: 'shadow' }).ranking.filter(x => (byId.get(x.id)?.caution.length ?? 0) > 0).length }
e4.adversarialCautionLovingWeights = { limitedProfiles: advLimited, cautionItemsRankedOrShown: advLeak }
let unavailableLeak = 0
for (const id of ['taijiquan', 'yijinjing', 'boating', 'archery', 'apple', 'racing']) for (const p of profiles.filter((_, i) => i % 9 === 0)) {
  const r = engine.recommend(inp(p, { availability: { snapshotRef: `e4:${id}`, unavailableIds: [id] } }), MODE)
  if (r.ranking.some(x => x.id === id || x.programId === id)) unavailableLeak += 1
}
e4.unavailableContentRankedOrShown = unavailableLeak
const low = createCoachDecisionEngine({ weights: { ...weights, abstainSuitabilityBelow: 1.01 }, binding: 'unbound', now: () => NOW }).recommend(inp(profiles[0]), { mode: 'shadow' })
e4.lowConfidenceAbstain = { fallbackReason: low.fallbackReason, abstainReason: low.abstainReason, displayIsRules: JSON.stringify(low.display?.result) === JSON.stringify(low.rules.result) }
e4.outOfDistributionAbstainInProfileSpace = outcomes.get('OUT_OF_DISTRIBUTION') ?? 0
e4.faults = {
  missingWeights: createCoachDecisionEngine({ weights: undefined }).recommend(inp(profiles[0]), MODE).fallbackReason,
  placeholderWeights: createCoachDecisionEngine({ weights: { schemaVersion: 1, id: 'fp-cdm-m2', version: '1.0.0', status: 'AWAITING_LABELS' } }).recommend(inp(profiles[0]), MODE).fallbackReason,
  tamperedWeights: weightsPath ? 'n/a (unbound)' : createCoachDecisionEngine({ weights: { ...weights, coef: weights.coef.map((c, i) => (i ? c : c + 1e-6)) } }).recommend(inp(profiles[0]), MODE).fallbackReason,
  inferenceException: createCoachDecisionEngine({ infer: () => { throw new Error('fault') } }).recommend(inp(profiles[0]), MODE).fallbackReason,
  experimentalWithoutApproval: weightsPath ? 'n/a (unbound)' : engine.recommend(inp(profiles[0]), { mode: 'active' }).fallbackReason,
}

// ---------------- E5 performance ----------------
const lat: number[] = []
for (const p of profiles.slice(0, 2000)) engine.recommend(inp(p), MODE)
for (const p of profiles) { const t = performance.now(); engine.recommend(inp(p), MODE); lat.push(performance.now() - t) }
const rulesLat: number[] = []
for (const p of profiles) { const t = performance.now(); getCoachWebRecommendation(req(p)); rulesLat.push(performance.now() - t) }
const withHistory = inp(profiles[100], { trainingHistory: { origin: 'synthetic_demo', chapters: [{ chapterId: 'bdj-1', sessions: 4, completedSessions: 4, meanScore: 72, trend: 'up', lastPracticedAt: NOW - 2 * 86_400_000 }, { chapterId: 'bdj-2', sessions: 2, completedSessions: 1, meanScore: 61, trend: 'flat', lastPracticedAt: NOW - 3 * 86_400_000 }] },
  latestReport: { origin: 'synthetic_demo', createdAt: NOW - 86_400_000, findings: [{ focus: 'stability', subjectId: 'bdj-2', score: 58, trend: 'worse' }] } })
const histLat: number[] = []
for (let i = 0; i < 3000; i += 1) { const t = performance.now(); engine.recommend(withHistory, MODE); histLat.push(performance.now() - t) }
const batchStart = performance.now(); for (const p of profiles.slice(0, 5000)) engine.recommend(inp(p), MODE); const batchMs = performance.now() - batchStart
let bundle: Record<string, unknown> = { status: 'not_measured' }
try {
  const esbuildPath = resolve(import.meta.dirname, '../../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js')
  const esbuild = await import(/* @vite-ignore */ `file:///${esbuildPath.replace(/\\/g, '/')}`)
  const build = async (entry: string) => {
    // platform 'browser' with no externals: the build fails if anything imports a Node built-in.
    const res = await esbuild.build({ entryPoints: [resolve(import.meta.dirname, entry)], bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' })
    const b = res.outputFiles[0].contents as Uint8Array
    const text = new TextDecoder().decode(b)
    return { minifiedBytes: b.length, gzipBytes: gzipSync(b).length, nodeBuiltinImports: (text.match(/from"node:|require\("(fs|path|crypto|os)"\)/g) ?? []).length, processReferences: (text.match(/\bprocess\./g) ?? []).length }
  }
  // Core = engine/index.ts (what the Web imports). engine/platform.ts adds the optional local-record helpers
  // (routine session parser + the existing consent-gated readers), which the app already ships for other pages.
  const both = resolve(OUT, '_entry-with-platform.ts')
  const dir = resolve(import.meta.dirname, '../../../src/features/coachAgent/decisionModel/engine').split('\\').join('/')
  writeFileSync(both, `export * from '${dir}/index.ts'\nexport * from '${dir}/platform.ts'\n`)
  bundle = { p0WebService: await build('../../../src/features/coachAgent/recommendation/webService.ts'), engineCoreIncludingP0Pr49AndWeights: await build('../../../src/features/coachAgent/decisionModel/engine/index.ts'),
    engineWithLocalRecordHelpers: await build(both) }
  rmSync(both)
} catch (error) { bundle = { status: 'failed', error: String(error) } }
const e5 = {
  engine: weightsPath ? 'unbound research weights' : `${FP_CDM_RELEASE.release} (release-bound)`, weightsFileBytes: statSync(weightsPath ?? resolve('../..', FP_CDM_RELEASE.m2.weightsFile)).size, parameters: weights.coef.length * 3 + 4,
  singleRequestMs: { n: lat.length, p50: r4(q(lat, 0.5)), p95: r4(q(lat, 0.95)), max: r4(Math.max(...lat)) },
  withHistoryAndReportMs: { n: histLat.length, p50: r4(q(histLat, 0.5)), p95: r4(q(histLat, 0.95)) },
  rulesOnlyMs: { p50: r4(q(rulesLat, 0.5)), p95: r4(q(rulesLat, 0.95)) },
  batch5000: { totalMs: r4(batchMs), perRequestMs: r4(batchMs / 5000) },
  heapUsedMB: r4(process.memoryUsage().heapUsed / 1e6), cpu: 'single thread, Node, development laptop', gpu: 'not used', network: 'none', bundle,
  coldStart: 'measured separately by scripts/decision-model/cdm/cold-start.mjs (fresh process import + first call)',
}

// ---------------- E2 personalisation ----------------
const sys = { rules_p0: new Map<string, number>(), pr49: new Map<string, number>(), cdm: new Map<string, number>() }
const covs = { rules_p0: [] as number[], pr49: [] as number[], cdm: [] as number[] }, progs = { rules_p0: [] as number[], pr49: [] as number[], cdm: [] as number[] }
let abstained = 0
for (const p of profiles) {
  const rules = getCoachWebRecommendation(req(p)).result
  const pr = getCoachDecisionRecommendation(req(p), { mode: 'active' }).active.result
  const c = modelSlate(engine.recommend(inp(p), MODE))
  if (!c) abstained += 1
  const entries = { rules_p0: rules ? [...rules.chapters, ...rules.games].map(x => x.entry) : null, pr49: pr ? [...pr.chapters, ...pr.games].map(x => x.entry) : null, cdm: c }
  for (const k of ['rules_p0', 'pr49', 'cdm'] as const) {
    const e = entries[k]
    sys[k].set(slateKey(e), (sys[k].get(slateKey(e)) ?? 0) + 1)
    if (e) { covs[k].push(cover(p, e)); progs[k].push(new Set(e.filter(x => x.kind === 'chapter').map(x => x.programId)).size) }
  }
}
const ent = (m: Map<string, number>, n: number) => { let h = 0; for (const v of m.values()) { const x = v / n; h -= x * Math.log2(x) } return r4(h / Math.log2(n)) }
const mean = (v: number[]) => r4(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length))
const e2 = { profiles: profiles.length, cdmAbstainedOrFellBack: abstained,
  distinctSlates: Object.fromEntries(Object.entries(sys).map(([k, m]) => [k, m.size])), normalisedEntropy: Object.fromEntries(Object.entries(sys).map(([k, m]) => [k, ent(m, profiles.length)])),
  meanRegionCoverage: Object.fromEntries(Object.entries(covs).map(([k, v]) => [k, mean(v)])), meanDistinctProgrammes: Object.fromEntries(Object.entries(progs).map(([k, v]) => [k, mean(v)])) }
const report = { schemaVersion: 2, generatedAt: new Date().toISOString(), via: 'public engine recommendCoachDecision', labelKind: weights.trainedOn.labels.kind, weightsPath: weightsPath ?? FP_CDM_RELEASE.m2.weightsFile,
  scope: 'self-report profile space (synthetic enumeration of the profile form), not real users', e2, e4, e5 }
writeFileSync(resolve(OUT, `cdm-e2-e4-e5-${weightsPath ? 'unbound' : 'release'}.json`), `${JSON.stringify(report, null, 1)}\n`)
console.log(JSON.stringify({ e4, e5, e2 }, null, 1))
