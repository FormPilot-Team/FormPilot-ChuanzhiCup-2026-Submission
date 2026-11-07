/**
 * fp-cdm E2 (personalisation), E4 (safety), E5 (performance) over the full self-report profile space.
 *   node <vite-node.mjs> scripts/decision-model/cdm/evaluate-cdm.ts --out <dir> [--weights <fp-cdm-m2.weights.json>]
 * Without --weights a deterministic FIXTURE weight vector of the same architecture is used: E4/E5 are
 * weight-independent properties (guard, abstain, latency, size); E2 is only reported for real weights.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'
import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'
import { getCoachWebRecommendation } from '../../../src/features/coachAgent/recommendation/webService'
import type { BodyRegion, CoachProfile, CoachRecommendationResult } from '../../../src/features/coachAgent/recommendation/types'
import { getCoachDecisionRecommendation } from '../../../src/features/coachAgent/decisionModel/adapter'
import { isLimitedProfile } from '../../../src/features/coachAgent/decisionModel/ranker'
import { createCdmService, FEATURE_NAMES, FEATURE_SET_VERSION, loadWeights, type CdmWeights } from '../../../src/features/coachAgent/decisionModel/cdm'

const args = process.argv.slice(2)
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const OUT = resolve(arg('--out') ?? 'test-results/cdm-eval'); mkdirSync(OUT, { recursive: true })
const weightsPath = arg('--weights')
let weights: CdmWeights, weightsKind: 'trained' | 'fixture'
if (weightsPath) {
  const status = loadWeights(JSON.parse(readFileSync(weightsPath, 'utf8')))
  if (!status.ok) throw new Error(`weights refused: ${status.reason}`)
  weights = status.weights; weightsKind = 'trained'
} else {
  let s = 11; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5
  weights = { schemaVersion: 1, id: 'fp-cdm-m2', version: '0.0.0-fixture', status: 'TRAINED', family: 'pairwise_lr', hyperparameter: 0, featureSet: FEATURE_SET_VERSION, featureNames: [...FEATURE_NAMES],
    mean: FEATURE_NAMES.map(() => 0), scale: FEATURE_NAMES.map(() => 1), coef: FEATURE_NAMES.map(() => r()), pairTemperature: 1, platt: { a: 1, b: 0 }, abstainSuitabilityBelow: 0,
    trainedOn: { matrixSha256: 'fixture', labels: { kind: 'test_fixture' }, devFamilies: [] } }
  weightsKind = 'fixture'
}
const svc = createCdmService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, weights: { ok: true, weights }, now: () => Date.UTC(2026, 10, 8) })
const REGIONS: BodyRegion[] = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
const subsets = <T>(items: readonly T[]): T[][] => Array.from({ length: (1 << items.length) - 1 }, (_, m) => items.filter((_, b) => ((m + 1) >> b) & 1))
const profiles: CoachProfile[] = []
for (const goals of subsets(['mobility', 'upper_limb', 'daily', 'rehab_support'] as const)) for (const difficulties of [['none'] as CoachProfile['difficulties'], ...subsets(['stiffness', 'reach_difficulty', 'soreness', 'sedentary'] as const)])
  for (const regions of subsets(REGIONS)) for (const preference of ['routine', 'game', 'mixed'] as const) profiles.push({ version: 1, goals: [...goals], difficulties: [...difficulties], regions: [...regions], preference, risk: 'none', acknowledged: true })
const req = (p: unknown) => ({ schemaVersion: 1, source: 'rules', profile: p })
const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] }
const r4 = (x: number) => Number(x.toFixed(4))
const slateKey = (r: CoachRecommendationResult | null) => r ? `${r.chapters.map(c => c.entry.id).join(',')}|${r.games.map(g => g.entry.id).join(',')}` : 'none'
const cover = (p: CoachProfile, r: CoachRecommendationResult | null) => { const c = new Set([...(r?.chapters ?? []), ...(r?.games ?? [])].flatMap(x => x.entry.regions)); return p.regions.filter(x => c.has(x)).length / p.regions.length }

// ---------------- E4 safety ----------------
const e4: Record<string, unknown> = {}
let riskExec = 0, riskHold = 0
for (const risk of ['acute_pain', 'dizziness', 'recent_injury'] as const) for (const p of profiles.filter((_, i) => i % 5 === 0)) {
  const r = svc(req({ ...p, risk }), { mode: 'active' }); if (r.modelExecution === 'executed') riskExec += 1; if (r.active.status === 'safety_hold') riskHold += 1
}
e4.riskProfiles = { checked: profiles.filter((_, i) => i % 5 === 0).length * 3, held: riskHold, modelExecutions: riskExec }
let limitedLeak = 0, hrefLeak = 0, executed = 0
const outcomes = new Map<string, number>()
for (const p of profiles) {
  const r = svc(req(p), { mode: 'active' })
  outcomes.set(String(r.fallbackReason), (outcomes.get(String(r.fallbackReason)) ?? 0) + 1)
  if (r.modelExecution === 'executed') executed += 1
  for (const x of [...(r.active.result?.chapters ?? []), ...(r.active.result?.games ?? [])]) {
    if (isLimitedProfile(p) && x.entry.caution.length) limitedLeak += 1
    if (x.entry.kind === 'chapter' && x.entry.href === null) hrefLeak += 1
  }
}
e4.profileSpace = { profiles: profiles.length, executed, outcomes: Object.fromEntries(outcomes), limitedCautionItems: limitedLeak, nonLaunchableChapters: hrefLeak }
const adversarial: CdmWeights = { ...weights, coef: FEATURE_NAMES.map(n => /c_caution|x_diff_.*_caution_count|c_deepknee/.test(n) ? 25 : 0) }
const advSvc = createCdmService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, weights: { ok: true, weights: adversarial }, now: () => 0 })
let advLeak = 0, advLimited = 0
for (const p of profiles.filter(isLimitedProfile).filter((_, i) => i % 3 === 0)) { advLimited += 1; const r = advSvc(req(p), { mode: 'active' }); advLeak += [...(r.active.result?.chapters ?? []), ...(r.active.result?.games ?? [])].filter(x => x.entry.caution.length).length }
e4.adversarialCautionLovingWeights = { limitedProfiles: advLimited, cautionItemsShown: advLeak }
let unavailableLeak = 0
for (const id of ['taijiquan', 'yijinjing', 'boating', 'archery', 'apple', 'racing']) for (const p of profiles.filter((_, i) => i % 9 === 0)) {
  const r = svc(req(p), { mode: 'active', availability: { snapshotRef: `e4:${id}`, unavailableIds: [id] } })
  if (r.decisionOrigin === 'model' && [...r.active.result!.chapters, ...r.active.result!.games].some(x => x.entry.id === id || x.entry.programId === id)) unavailableLeak += 1
}
e4.unavailableContentShownByModel = unavailableLeak
const abstain = createCdmService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, weights: { ok: true, weights: { ...weights, abstainSuitabilityBelow: 1.01 } }, now: () => 0 })
const ab = abstain(req(profiles[0]), { mode: 'active' })
e4.lowConfidenceAbstain = { fallbackReason: ab.fallbackReason, abstainReason: ab.model?.abstainReason, activeIsRules: JSON.stringify(ab.active.result) === JSON.stringify(ab.rules.result) }
const ood = createCdmService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, weights: { ok: true, weights: { ...weights, scale: weights.scale.map(() => 1e-3) } }, now: () => 0 })(req(profiles[0]), { mode: 'active' })
e4.outOfDistributionAbstain = { fallbackReason: ood.fallbackReason, abstainReason: ood.model?.abstainReason }
e4.untrainedBundledWeights = { fallbackReason: createCdmService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, weights: { ok: false, reason: 'MODEL_NOT_TRAINED' }, now: () => 0 })(req(profiles[0]), { mode: 'active' }).fallbackReason }
e4.missingTrustedData = { note: 'rules-mode requests carry no history/report: state history/report = missing; H/R features are 0 by construction (tested)', historyStatus: svc(req(profiles[0]), { mode: 'active' }).model?.stateOrigin }

// ---------------- E5 performance ----------------
const lat: number[] = []
for (const p of profiles.slice(0, 2000)) svc(req(p), { mode: 'active' })
for (const p of profiles) { const t = performance.now(); svc(req(p), { mode: 'active' }); lat.push(performance.now() - t) }
const rulesLat: number[] = []
for (const p of profiles) { const t = performance.now(); getCoachWebRecommendation(req(p)); rulesLat.push(performance.now() - t) }
const batchStart = performance.now(); for (const p of profiles.slice(0, 5000)) svc(req(p), { mode: 'active' }); const batchMs = performance.now() - batchStart
let bundle: Record<string, unknown> = { status: 'not_measured' }
try {
  const esbuildPath = resolve(import.meta.dirname, '../../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js')
  const esbuild = await import(/* @vite-ignore */ `file:///${esbuildPath.replace(/\\/g, '/')}`)
  const build = async (entry: string) => { const res = await esbuild.build({ entryPoints: [resolve(import.meta.dirname, entry)], bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' }); const b = res.outputFiles[0].contents as Uint8Array; return { minifiedBytes: b.length, gzipBytes: gzipSync(b).length } }
  bundle = { p0WebService: await build('../../../src/features/coachAgent/recommendation/webService.ts'), cdmIndexIncludingP0AndPr49: await build('../../../src/features/coachAgent/decisionModel/cdm/index.ts') }
} catch (error) { bundle = { status: 'failed', error: String(error) } }
const e5 = {
  weightsKind, weightsFileBytes: weightsPath ? statSync(weightsPath).size : null, parameters: weights.coef.length * 3 + 4,
  singleRequestMs: { n: lat.length, p50: r4(q(lat, 0.5)), p95: r4(q(lat, 0.95)), max: r4(Math.max(...lat)) },
  rulesOnlyMs: { p50: r4(q(rulesLat, 0.5)), p95: r4(q(rulesLat, 0.95)) },
  batch5000: { totalMs: r4(batchMs), perRequestMs: r4(batchMs / 5000) },
  heapUsedMB: r4(process.memoryUsage().heapUsed / 1e6), cpu: 'single thread, Node, development laptop', gpu: 'not used', network: 'none', bundle,
  coldStart: 'measured separately by scripts/decision-model/cdm/cold-start.mjs (fresh process import + first call)',
}

// ---------------- E2 personalisation (real weights only) ----------------
let e2: Record<string, unknown> = { status: 'NOT_REPORTED_FOR_FIXTURE_WEIGHTS' }
if (weightsKind === 'trained') {
  const sys = { rules_p0: new Map<string, number>(), pr49: new Map<string, number>(), cdm: new Map<string, number>() }
  const covs = { rules_p0: [] as number[], pr49: [] as number[], cdm: [] as number[] }, progs = { rules_p0: [] as number[], pr49: [] as number[], cdm: [] as number[] }
  let abstained = 0
  for (const p of profiles) {
    const rules = getCoachWebRecommendation(req(p)).result
    const pr = getCoachDecisionRecommendation(req(p), { mode: 'active' }).active.result
    const c = svc(req(p), { mode: 'active' })
    if (c.decisionOrigin !== 'model') abstained += 1
    const cdm = c.decisionOrigin === 'model' ? c.active.result : null
    for (const [k, r] of [['rules_p0', rules], ['pr49', pr], ['cdm', cdm]] as const) {
      sys[k].set(slateKey(r), (sys[k].get(slateKey(r)) ?? 0) + 1)
      if (r) { covs[k].push(cover(p, r)); progs[k].push(new Set(r.chapters.map(x => x.entry.programId)).size) }
    }
  }
  const ent = (m: Map<string, number>, n: number) => { let h = 0; for (const v of m.values()) { const x = v / n; h -= x * Math.log2(x) } return r4(h / Math.log2(n)) }
  const mean = (v: number[]) => r4(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length))
  e2 = { profiles: profiles.length, cdmAbstainedOrFellBack: abstained,
    distinctSlates: Object.fromEntries(Object.entries(sys).map(([k, m]) => [k, m.size])), normalisedEntropy: Object.fromEntries(Object.entries(sys).map(([k, m]) => [k, ent(m, profiles.length)])),
    meanRegionCoverage: Object.fromEntries(Object.entries(covs).map(([k, v]) => [k, mean(v)])), meanDistinctProgrammes: Object.fromEntries(Object.entries(progs).map(([k, v]) => [k, mean(v)])) }
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), weightsKind, weightsPath: weightsPath ?? null, scope: 'self-report profile space (synthetic enumeration), not real users', e2, e4, e5 }
writeFileSync(resolve(OUT, `cdm-e2-e4-e5-${weightsKind}.json`), `${JSON.stringify(report, null, 1)}\n`)
console.log(JSON.stringify({ weightsKind, e4, e5: { ...e5, bundle: e5.bundle }, e2 }, null, 1))
