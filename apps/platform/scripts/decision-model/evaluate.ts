/**
 * Offline evaluation: P0 rules (getCoachWebRecommendation) vs fp-coach-ranker under identical inputs.
 *
 *   node <vite-node.mjs> scripts/decision-model/evaluate.ts --out <dir> [--personas dev|frozen]
 *
 * Everything here is synthetic or rule-consistency evaluation: self-report profiles are enumerated
 * exhaustively, personas are CC-authored requirement rubrics. Nothing measures real recommendation
 * quality or rehabilitation effect. The frozen persona set is evaluated only with --personas frozen.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { COACH_KNOWLEDGE } from '../../src/features/coachAgent/recommendation/catalogue'
import { getCoachWebRecommendation } from '../../src/features/coachAgent/recommendation/webService'
import type { BodyRegion, CoachProfile, CoachRecommendationResult, Focus, KnowledgeEntry } from '../../src/features/coachAgent/recommendation/types'
import { createCoachDecisionService, getCoachDecisionRecommendation, VALIDATED_CATALOGUE_FINGERPRINT } from '../../src/features/coachAgent/decisionModel/adapter'
import { rankCoachDecision, isLimitedProfile, type RankerTrace } from '../../src/features/coachAgent/decisionModel/ranker'
import { MOTION_DESCRIPTORS } from '../../src/features/coachAgent/decisionModel/descriptors'
import type { CatalogueAvailability, CoachDecisionResponse, DecisionModelOutput } from '../../src/features/coachAgent/decisionModel/types'

const args = process.argv.slice(2)
const argValue = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const OUT = resolve(argValue('--out') ?? resolve(import.meta.dirname, '../../test-results/decision-model'))
const PERSONA_SET = argValue('--personas') ?? 'dev'
mkdirSync(OUT, { recursive: true })

const GOALS = ['mobility', 'upper_limb', 'daily', 'rehab_support'] as const
const DIFFICULTIES = ['stiffness', 'reach_difficulty', 'soreness', 'sedentary'] as const
const REGIONS: BodyRegion[] = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
const PREFERENCES = ['routine', 'game', 'mixed'] as const
const RISKS = ['none', 'acute_pain', 'dizziness', 'recent_injury'] as const
const byId = new Map(COACH_KNOWLEDGE.map(entry => [entry.id, entry]))
const subsets = <T>(items: readonly T[]): T[][] => Array.from({ length: (1 << items.length) - 1 }, (_, mask) => items.filter((_, bit) => ((mask + 1) >> bit) & 1))
const difficultySets: Array<CoachProfile['difficulties']> = [['none'], ...subsets(DIFFICULTIES)]

function* allProfiles(): Generator<CoachProfile> {
  for (const goals of subsets(GOALS)) for (const difficulties of difficultySets) for (const regions of subsets(REGIONS))
    for (const preference of PREFERENCES) for (const risk of RISKS)
      yield { version: 1, goals: [...goals], difficulties: [...difficulties], regions: [...regions], preference, risk, acknowledged: true }
}
const keyOf = (p: CoachProfile) => `${p.goals.join(',')}|${p.difficulties.join(',')}|${p.regions.join(',')}|${p.preference}|${p.risk}`
const request = (profile: unknown, source: 'rules' | 'synthetic' = 'rules') => ({ schemaVersion: 1, source, profile })
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const quantile = (values: number[], q: number) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] }
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN
const r4 = (value: number) => Number(value.toFixed(4))

// ---------------- P0 replica (only to classify ties; validated against P0 output for every profile) ----------------
function p0ProfileFocus(profile: CoachProfile): Focus[] {
  const out: Focus[] = []
  if (profile.goals.includes('mobility') || profile.goals.includes('upper_limb')) out.push('reach', 'coordination')
  if (profile.difficulties.includes('reach_difficulty') || profile.difficulties.includes('soreness')) out.push('stability', 'coordination')
  if (profile.goals.includes('daily') || profile.difficulties.includes('sedentary')) out.push('general', 'rhythm')
  if (profile.goals.includes('rehab_support')) out.push('general', 'stability')
  return [...new Set(out.length ? out : ['general' as const])]
}
function p0Replica(profile: CoachProfile) {
  const focuses = p0ProfileFocus(profile)
  const limited = isLimitedProfile(profile)
  const safe = (e: KnowledgeEntry) => e.verification === 'project_verified' && (!limited || e.caution.length === 0)
  const score = (e: KnowledgeEntry) => e.regions.filter(r => profile.regions.includes(r)).length * 10 + e.focuses.filter(f => focuses.includes(f)).length
  const sort = (list: KnowledgeEntry[]) => list.map(entry => ({ entry, score: score(entry) })).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  const chapters = sort(COACH_KNOWLEDGE.filter(e => e.kind === 'chapter' && e.href !== null && safe(e)))
  const programmes = [...new Set(chapters.map(item => item.entry.programId))].slice(0, 2)
  const selected = chapters.filter(item => programmes.includes(item.entry.programId)).slice(0, 3)
  const games = sort(COACH_KNOWLEDGE.filter(e => e.kind === 'game' && safe(e)))
  const gameSel = games.slice(0, 2)
  // Membership decided purely by id: an unselected candidate has exactly the score of a selected one.
  const chapterIdTies = selected.filter(item => chapters.some(other => !selected.includes(other) && other.score === item.score)).length
  const gameIdTies = gameSel.filter(item => games.some(other => !gameSel.includes(other) && other.score === item.score)).length
  return { chapters: selected.map(i => i.entry.id), games: gameSel.map(i => i.entry.id), chapterIdTies, gameIdTies }
}

// ---------------- slate metrics ----------------
function slateOf(result: CoachRecommendationResult | null) {
  return { chapters: result?.chapters.map(i => i.entry) ?? [], games: result?.games.map(i => i.entry) ?? [], routines: result?.routines.map(i => i.entry) ?? [] }
}
function coverage(profile: CoachProfile, result: CoachRecommendationResult | null) {
  const s = slateOf(result)
  const covered = new Set([...s.chapters, ...s.games].flatMap(e => e.regions))
  return profile.regions.filter(r => covered.has(r)).length / profile.regions.length
}
function chapterPrecision(profile: CoachProfile, result: CoachRecommendationResult | null) {
  const chapters = slateOf(result).chapters
  return chapters.length ? mean(chapters.map(e => e.regions.filter(r => profile.regions.includes(r)).length / e.regions.length)) : Number.NaN
}
function coverableRegions(profile: CoachProfile, unavailable: Set<string> = new Set()) {
  const limited = isLimitedProfile(profile)
  const pool = COACH_KNOWLEDGE.filter(e => e.kind !== 'routine' && e.verification === 'project_verified' && (!limited || e.caution.length === 0)
    && !(e.kind === 'chapter' && e.href === null) && !unavailable.has(e.id) && !(e.programId && unavailable.has(e.programId)))
  return new Set(pool.flatMap(e => e.regions))
}
const slateKey = (result: CoachRecommendationResult | null) => { const s = slateOf(result); return `${s.chapters.map(e => e.id).join(',')}|${s.games.map(e => e.id).join(',')}` }
function entropy(counts: Map<string, number>, total: number) {
  let h = 0
  for (const count of counts.values()) { const p = count / total; h -= p * Math.log2(p) }
  return { bits: r4(h), normalised: r4(total > 1 ? h / Math.log2(total) : 0) }
}

// ---------------- 1. exhaustive profile space ----------------
console.log('enumerating profile space...')
const responses = new Map<string, { profile: CoachProfile; response: CoachDecisionResponse; trace: RankerTrace }>()
const tracedService = (trace: RankerTrace) => createCoachDecisionService({ catalogue: COACH_KNOWLEDGE, ranker: input => rankCoachDecision(input, trace), rules: getCoachWebRecommendation, validatedFingerprint: VALIDATED_CATALOGUE_FINGERPRINT })
let total = 0
const safety = { riskProfiles: 0, rulesHold: 0, modelHold: 0, modelExecutedOnRisk: 0 }
const leak = { limitedProfiles: 0, rulesCautionItems: 0, modelCautionItems: 0, rulesHrefNull: 0, modelHrefNull: 0, rulesMeasuredUnionItems: 0, modelMeasuredUnionItems: 0, rulesAuditOnlyMeasuredItems: 0, modelAuditOnlyMeasuredItems: 0 }
let replicaMismatches = 0
for (const profile of allProfiles()) {
  total += 1
  const trace: RankerTrace = { steps: [] }
  const response = tracedService(trace)(request(profile), { mode: 'active' })
  if (profile.risk !== 'none') {
    safety.riskProfiles += 1
    if (response.rules.status === 'safety_hold') safety.rulesHold += 1
    if (response.active.status === 'safety_hold' && response.decisionOrigin === 'rules') safety.modelHold += 1
    if (response.modelExecution === 'executed') safety.modelExecutedOnRisk += 1
    continue
  }
  responses.set(keyOf(profile), { profile, response, trace })
  const replica = p0Replica(profile)
  const rulesSlate = slateOf(response.rules.result)
  if (replica.chapters.join() !== rulesSlate.chapters.map(e => e.id).join() || replica.games.join() !== rulesSlate.games.map(e => e.id).join()) replicaMismatches += 1
  const modelSlate = slateOf(response.active.result)
  const items = { rules: [...rulesSlate.chapters, ...rulesSlate.games], model: [...modelSlate.chapters, ...modelSlate.games] }
  for (const [name, list] of Object.entries(items) as Array<['rules' | 'model', KnowledgeEntry[]]>) {
    leak[`${name}HrefNull`] += list.filter(e => e.kind === 'chapter' && e.href === null).length
    if (!isLimitedProfile(profile)) continue
    leak[`${name}CautionItems`] += list.filter(e => e.caution.length > 0).length
    for (const e of list.filter(item => item.kind === 'chapter')) {
      const d = MOTION_DESCRIPTORS.get(e.id)
      if (!d?.reliable) continue
      if (d.flags.bending.flagged || d.flags.balance.flagged) leak[`${name}MeasuredUnionItems`] += 1
      if (d.flags.overhead.flagged || d.flags.twist.flagged || d.flags.weightBearing.flagged) leak[`${name}AuditOnlyMeasuredItems`] += 1
    }
  }
  if (isLimitedProfile(profile)) leak.limitedProfiles += 1
}
const riskNone = [...responses.values()]
console.log(`profiles ${total}, risk-none ${riskNone.length}, replica mismatches ${replicaMismatches}`)

// discrimination
const distinct = (pick: (r: CoachDecisionResponse) => string) => { const m = new Map<string, number>(); for (const { response } of riskNone) { const k = pick(response); m.set(k, (m.get(k) ?? 0) + 1) } return m }
const rulesSlates = distinct(r => slateKey(r.rules.result)), modelSlates = distinct(r => slateKey(r.active.result))
const modelPriority = distinct(r => r.model?.priority.map(i => i.id).join(',') ?? '')
const discrimination = {
  profiles: riskNone.length,
  rules: { distinctSlates: rulesSlates.size, entropy: entropy(rulesSlates, riskNone.length), largestSlateShare: r4(Math.max(...rulesSlates.values()) / riskNone.length) },
  model: { distinctSlates: modelSlates.size, distinctPriorityOrders: modelPriority.size, entropy: entropy(modelSlates, riskNone.length), largestSlateShare: r4(Math.max(...modelSlates.values()) / riskNone.length) },
}

// single-field sensitivity
type Field = 'goals' | 'difficulties' | 'regions' | 'preference'
function neighbours(p: CoachProfile): Array<[Field, CoachProfile]> {
  const out: Array<[Field, CoachProfile]> = []
  for (const preference of PREFERENCES) if (preference !== p.preference) out.push(['preference', { ...p, preference }])
  const toggle = <T>(list: readonly T[], item: T) => list.includes(item) ? list.filter(x => x !== item) : [...list, item]
  for (const g of GOALS) { const goals = toggle(p.goals, g); if (goals.length) out.push(['goals', { ...p, goals: GOALS.filter(x => goals.includes(x)) }]) }
  for (const r of REGIONS) { const regions = toggle(p.regions, r); if (regions.length) out.push(['regions', { ...p, regions: REGIONS.filter(x => regions.includes(x)) }]) }
  const nonNone = p.difficulties.filter(d => d !== 'none')
  for (const d of DIFFICULTIES) { const next = toggle(nonNone, d); out.push(['difficulties', { ...p, difficulties: next.length ? DIFFICULTIES.filter(x => next.includes(x)) : ['none'] }]) }
  return out
}
const sensitivity: Record<Field, { pairs: number; rulesSlateChanged: number; modelSlateChanged: number; modelPriorityChanged: number }> = {
  goals: { pairs: 0, rulesSlateChanged: 0, modelSlateChanged: 0, modelPriorityChanged: 0 }, difficulties: { pairs: 0, rulesSlateChanged: 0, modelSlateChanged: 0, modelPriorityChanged: 0 },
  regions: { pairs: 0, rulesSlateChanged: 0, modelSlateChanged: 0, modelPriorityChanged: 0 }, preference: { pairs: 0, rulesSlateChanged: 0, modelSlateChanged: 0, modelPriorityChanged: 0 },
}
for (const { profile, response } of riskNone) {
  for (const [field, other] of neighbours(profile)) {
    const neighbour = responses.get(keyOf(other))
    if (!neighbour) continue
    const s = sensitivity[field]
    s.pairs += 1
    if (slateKey(response.rules.result) !== slateKey(neighbour.response.rules.result)) s.rulesSlateChanged += 1
    if (slateKey(response.active.result) !== slateKey(neighbour.response.active.result)) s.modelSlateChanged += 1
    if ((response.model?.priority.map(i => i.id).join() ?? '') !== (neighbour.response.model?.priority.map(i => i.id).join() ?? '')) s.modelPriorityChanged += 1
  }
}
const sensitivityRates = Object.fromEntries(Object.entries(sensitivity).map(([field, s]) => [field, { pairs: s.pairs, rulesSlate: r4(s.rulesSlateChanged / s.pairs), modelSlate: r4(s.modelSlateChanged / s.pairs), modelPriorityOrder: r4(s.modelPriorityChanged / s.pairs) }]))

// ties, coverage, precision, programme bias, load, preference conformance, comparison
const decided = { utility: 0, load: 0, order: 0, id: 0, tier: 0, single: 0 }
let rulesIdTieItems = 0, rulesItems = 0, modelItems = 0
const topProgramme = { rules: new Map<string, number>(), model: new Map<string, number>() }
const gapStats = { profilesWithGap: 0, modelDisclosed: 0, rulesStructuredDisclosure: 0 }
const cov = { rules: [] as number[], model: [] as number[], rulesFullWhenCoverable: 0, modelFullWhenCoverable: 0, coverableProfiles: 0 }
const prec = { rules: [] as number[], model: [] as number[], rulesSingleRegion: [] as number[], modelSingleRegion: [] as number[] }
const load = { rules: [] as number[], model: [] as number[] }
const prefConf = { checked: 0, pass: 0 }
const effects = new Map<string, number>()
const programmes = { rules: [] as number[], model: [] as number[] }
for (const { profile, response, trace } of riskNone) {
  const replica = p0Replica(profile)
  rulesIdTieItems += replica.chapterIdTies + replica.gameIdTies
  const rs = slateOf(response.rules.result), ms = slateOf(response.active.result)
  rulesItems += rs.chapters.length + rs.games.length
  modelItems += ms.chapters.length + ms.games.length
  for (const step of trace.steps) decided[step.decidedBy] += 1
  const rp = rs.chapters[0]?.programId ?? 'none', mp = ms.chapters[0]?.programId ?? 'none'
  topProgramme.rules.set(rp, (topProgramme.rules.get(rp) ?? 0) + 1); topProgramme.model.set(mp, (topProgramme.model.get(mp) ?? 0) + 1)
  programmes.rules.push(new Set(rs.chapters.map(e => e.programId)).size); programmes.model.push(new Set(ms.chapters.map(e => e.programId)).size)
  const coverable = coverableRegions(profile)
  const uncoverable = profile.regions.filter(r => !coverable.has(r))
  if (uncoverable.length) {
    gapStats.profilesWithGap += 1
    if (uncoverable.every(r => response.model?.coverage.gaps.some(g => g.region === r))) gapStats.modelDisclosed += 1
  } else {
    cov.coverableProfiles += 1
    if (coverage(profile, response.rules.result) === 1) cov.rulesFullWhenCoverable += 1
    if (coverage(profile, response.active.result) === 1) cov.modelFullWhenCoverable += 1
  }
  cov.rules.push(coverage(profile, response.rules.result)); cov.model.push(coverage(profile, response.active.result))
  prec.rules.push(chapterPrecision(profile, response.rules.result)); prec.model.push(chapterPrecision(profile, response.active.result))
  if (profile.regions.length === 1) { prec.rulesSingleRegion.push(chapterPrecision(profile, response.rules.result)); prec.modelSingleRegion.push(chapterPrecision(profile, response.active.result)) }
  if (!isLimitedProfile(profile)) { load.rules.push(mean(rs.chapters.map(e => e.caution.length))); load.model.push(mean(ms.chapters.map(e => e.caution.length))) }
  const first = response.model?.priority[0]
  if (first && ms.chapters.length && ms.games.length) { prefConf.checked += 1; if ((profile.preference === 'game') === (first.kind === 'game')) prefConf.pass += 1 }
  effects.set(response.comparison.rankingEffect, (effects.get(response.comparison.rankingEffect) ?? 0) + 1)
}
const share = (m: Map<string, number>) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r4(v / riskNone.length)]))
const decidedTotal = Object.values(decided).reduce((a, b) => a + b, 0)

// ---------------- 2. availability perturbation ----------------
const availabilityCases = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing', 'apple', 'boating', 'archery', 'racing'].map(id => {
  const availability: CatalogueAvailability = { snapshotRef: `eval:unavailable:${id}`, unavailableIds: [id] }
  let modelLeaks = 0, rulesShows = 0, fallbacks = 0
  for (const { profile } of riskNone) {
    const response = getCoachDecisionRecommendation(request(profile), { mode: 'active', availability })
    if (response.decisionOrigin !== 'model') fallbacks += 1
    const s = slateOf(response.active.result)
    if ([...s.chapters, ...s.games, ...s.routines].some(e => e.id === id || e.programId === id)) modelLeaks += 1
    if (response.rulesAvailabilityConflicts.length) rulesShows += 1
  }
  return { unavailableId: id, profiles: riskNone.length, modelProfilesShowingUnavailable: modelLeaks, rulesProfilesShowingUnavailable: rulesShows, rulesShare: r4(rulesShows / riskNone.length), modelFallbacks: fallbacks }
})

// ---------------- 3. fallback / fault injection ----------------
const sample = riskNone.filter((_, index) => index % 37 === 0).map(item => item.profile)
const deepEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function faultCase(name: string, run: (p: CoachProfile) => CoachDecisionResponse, expected: string) {
  let correct = 0
  const reasons = new Map<string, number>()
  for (const profile of sample) {
    const response = run(profile)
    reasons.set(String(response.fallbackReason), (reasons.get(String(response.fallbackReason)) ?? 0) + 1)
    const rules = getCoachWebRecommendation(request(profile))
    if (response.decisionOrigin === 'rules' && response.fallbackReason === expected && deepEqual(response.active.result, rules.result) && deepEqual(response.rules, rules)) correct += 1
  }
  return { case: name, profiles: sample.length, expectedFallback: expected, correctFallbacks: correct, reasons: Object.fromEntries(reasons) }
}
const tamper = (mutate: (o: DecisionModelOutput, p: CoachProfile) => void) => createCoachDecisionService({
  catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, validatedFingerprint: VALIDATED_CATALOGUE_FINGERPRINT,
  ranker: input => { const out = structuredClone(rankCoachDecision(input)); mutate(out, input.profile); return out },
})
const cautionEntry = byId.get('bdj-1') as KnowledgeEntry, hrefNull = byId.get('bdj-open') as KnowledgeEntry
const driftCatalogue = COACH_KNOWLEDGE.map(e => e.id === 'tjq-1' ? { ...e, caution: [] as KnowledgeEntry['caution'], regions: [...e.regions, 'neck' as const] } : e)
const faults = [
  faultCase('mode off (default)', p => getCoachDecisionRecommendation(request(p)), 'MODEL_DISABLED'),
  faultCase('mode shadow keeps rules active', p => getCoachDecisionRecommendation(request(p), { mode: 'shadow' }), 'SHADOW_MODE'),
  faultCase('unknown mode string', p => getCoachDecisionRecommendation(request(p), { mode: 'on' as never }), 'MODEL_DISABLED'),
  faultCase('ranker throws', p => createCoachDecisionService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, validatedFingerprint: VALIDATED_CATALOGUE_FINGERPRINT, ranker: () => { throw new Error('boom') } })(request(p), { mode: 'active' }), 'MODEL_ERROR'),
  faultCase('ranker injects caution chapter', p => tamper((o, profile) => { if (o.result.chapters[0]) { o.result.chapters[0] = { ...o.result.chapters[0], entry: isLimitedProfile(profile) ? cautionEntry : hrefNull } } })(request(p), { mode: 'active' }), 'OUTPUT_GUARD_REJECTED'),
  faultCase('ranker duplicates an item', p => tamper(o => { o.priority.push({ ...o.priority[0], rank: o.priority.length + 1 }) })(request(p), { mode: 'active' }), 'OUTPUT_GUARD_REJECTED'),
  faultCase('ranker invents unknown id', p => tamper(o => { if (o.result.games[0]) o.result.games[0] = { ...o.result.games[0], entry: { ...o.result.games[0].entry, id: 'invented-game' } }; else o.priority.push({ ...o.priority[0], id: 'invented-game', rank: o.priority.length + 1 }) })(request(p), { mode: 'active' }), 'OUTPUT_GUARD_REJECTED'),
  faultCase('ranker changes model identity', p => tamper(o => { (o.model as { trainedWeights: boolean }).trainedWeights = true })(request(p), { mode: 'active' }), 'OUTPUT_GUARD_REJECTED'),
  faultCase('host passes unknown availability id', p => tamper(() => undefined)(request(p), { mode: 'active', availability: { snapshotRef: 'x', unavailableIds: ['__unknown__'] } }), 'INVALID_AVAILABILITY'),
  faultCase('catalogue drift', p => createCoachDecisionService({ catalogue: driftCatalogue, rules: getCoachWebRecommendation, validatedFingerprint: VALIDATED_CATALOGUE_FINGERPRINT, ranker: rankCoachDecision })(request(p), { mode: 'active' }), 'INTEGRITY_MISMATCH'),
]
const guardBypass = (() => {
  // availability honoured by guard even if a ranker ignores it
  const service = createCoachDecisionService({ catalogue: COACH_KNOWLEDGE, rules: getCoachWebRecommendation, validatedFingerprint: VALIDATED_CATALOGUE_FINGERPRINT, ranker: input => rankCoachDecision({ ...input, availability: null }) })
  let rejected = 0, applicable = 0
  for (const profile of sample) {
    const plain = rankCoachDecision({ profile, evidence: [], availability: null, catalogue: COACH_KNOWLEDGE })
    const target = plain.result.chapters[0]?.entry.programId
    if (!target) continue
    applicable += 1
    const response = service(request(profile), { mode: 'active', availability: { snapshotRef: 'eval', unavailableIds: [target] } })
    if (response.fallbackReason === 'OUTPUT_GUARD_REJECTED') rejected += 1
  }
  return { case: 'ranker ignores availability; guard must reject', applicable, rejected }
})()
const invalidRequests = [
  { name: 'extra modelOutput field', value: { ...request({}), modelOutput: {} } },
  { name: 'client evidence field', value: { ...request({}), evidence: [] } },
  { name: 'source startlux', value: { schemaVersion: 1, source: 'startlux', profile: {} } },
  { name: 'null', value: null },
].map(({ name, value }) => { const response = getCoachDecisionRecommendation(value, { mode: 'active' }); return { name, status: response.active.status, fallbackReason: response.fallbackReason, modelExecution: response.modelExecution } })

// ---------------- 4. latency, memory, bundle ----------------
function timeIt(fn: () => unknown, profiles: CoachProfile[]) {
  const samples: number[] = []
  for (const profile of profiles) { const start = performance.now(); fn.call(null, profile as never); samples.push(performance.now() - start) }
  return { n: samples.length, p50ms: r4(quantile(samples, 0.5)), p95ms: r4(quantile(samples, 0.95)), maxms: r4(Math.max(...samples)) }
}
const latencyProfiles = riskNone.map(item => item.profile)
for (let i = 0; i < 2000; i += 1) getCoachDecisionRecommendation(request(latencyProfiles[i]), { mode: 'active' })
const heapBefore = process.memoryUsage().heapUsed
const latency = {
  rulesOnly: timeIt(((p: CoachProfile) => getCoachWebRecommendation(request(p))) as () => unknown, latencyProfiles),
  adapterOff: timeIt(((p: CoachProfile) => getCoachDecisionRecommendation(request(p))) as () => unknown, latencyProfiles),
  adapterActive: timeIt(((p: CoachProfile) => getCoachDecisionRecommendation(request(p), { mode: 'active' })) as () => unknown, latencyProfiles),
  rankerOnly: timeIt(((p: CoachProfile) => rankCoachDecision({ profile: p, evidence: [], availability: null, catalogue: COACH_KNOWLEDGE })) as () => unknown, latencyProfiles),
  note: 'single-threaded Node on the development laptop, warm JIT; includes P0 call inside the adapter; no GPU, no network',
}
const heapAfter = process.memoryUsage().heapUsed
let bundle: Record<string, unknown> = { status: 'not_measured' }
try {
  const esbuildPath = resolve(import.meta.dirname, '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js')
  const esbuild = await import(/* @vite-ignore */ `file:///${esbuildPath.replace(/\\/g, '/')}`)
  const build = async (entry: string) => {
    const result = await esbuild.build({ entryPoints: [resolve(import.meta.dirname, entry)], bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent', external: [] })
    const bytes = result.outputFiles[0].contents as Uint8Array
    return { minifiedBytes: bytes.length, gzipBytes: gzipSync(bytes).length }
  }
  bundle = { p0WebService: await build('../../src/features/coachAgent/recommendation/webService.ts'), decisionModelIndexIncludingP0: await build('../../src/features/coachAgent/decisionModel/index.ts'), tool: 'esbuild 0.28.2 minify, browser ESM' }
} catch (error) { bundle = { status: 'failed', error: String(error) } }

// ---------------- 5. personas ----------------
interface Persona { id: string; profile?: unknown; request?: unknown; availability?: { unavailableIds: string[] }; expect: Record<string, unknown> }
const personaFile = resolve(import.meta.dirname, PERSONA_SET === 'frozen' ? 'personas.frozen-test.json' : 'personas.dev.json')
const personaText = readFileSync(personaFile, 'utf8')
const personas = (JSON.parse(personaText) as { personas: Persona[] }).personas
const personaResults = personas.map(persona => {
  const availability = persona.availability ? { snapshotRef: `persona:${persona.id}`, unavailableIds: persona.availability.unavailableIds } : undefined
  const response = getCoachDecisionRecommendation(persona.request ?? request(persona.profile), { mode: 'active', availability })
  const profile = persona.profile as CoachProfile
  const checks: Array<{ property: string; rules: 'pass' | 'fail' | 'unsupported'; model: 'pass' | 'fail' | 'unsupported' }> = []
  const both = (property: string, test: (result: CoachRecommendationResult | null, status: string) => boolean) => checks.push({ property, rules: test(response.rules.result, response.rules.status) ? 'pass' : 'fail', model: test(response.active.result, response.active.status) ? 'pass' : 'fail' })
  const e = persona.expect
  both('status', (_, status) => status === e.status)
  if (e.noCautionTags) both('noCautionTags', r => [...slateOf(r).chapters, ...slateOf(r).games].every(x => x.caution.length === 0))
  if (Array.isArray(e.coverRegions)) both('coverRegions', r => (e.coverRegions as BodyRegion[]).every(region => [...slateOf(r).chapters, ...slateOf(r).games].some(x => x.regions.includes(region))))
  if (typeof e.minDistinctPrograms === 'number') both('minDistinctPrograms', r => new Set(slateOf(r).chapters.map(x => x.programId)).size >= (e.minDistinctPrograms as number))
  if (typeof e.minChapterRegionPrecision === 'number') both('minChapterRegionPrecision', r => chapterPrecision(profile, r) >= (e.minChapterRegionPrecision as number))
  if (Array.isArray(e.excludeIds)) both('excludeIds', r => { const s = slateOf(r); return ![...s.chapters, ...s.games, ...s.routines].some(x => (e.excludeIds as string[]).includes(x.id) || (e.excludeIds as string[]).includes(x.programId ?? '')) })
  if (Array.isArray(e.discloseGaps)) checks.push({ property: 'discloseGaps', rules: 'unsupported', model: (e.discloseGaps as string[]).every(region => response.model?.coverage.gaps.some(g => g.region === region)) ? 'pass' : 'fail' })
  if (typeof e.topKind === 'string') checks.push({ property: 'topKind', rules: 'unsupported', model: response.model?.priority[0]?.kind === e.topKind ? 'pass' : 'fail' })
  return { id: persona.id, decisionOrigin: response.decisionOrigin, fallbackReason: response.fallbackReason, checks,
    rulesSlate: slateKey(response.rules.result), modelSlate: slateKey(response.active.result), modelPriority: response.model?.priority.map(i => `${i.kind[0]}:${i.id}`) ?? [] }
})
const tally = (who: 'rules' | 'model') => {
  const all = personaResults.flatMap(p => p.checks)
  return { pass: all.filter(c => c[who] === 'pass').length, fail: all.filter(c => c[who] === 'fail').length, unsupported: all.filter(c => c[who] === 'unsupported').length, total: all.length,
    personasAllPass: personaResults.filter(p => p.checks.every(c => c[who] === 'pass')).length }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: 'offline synthetic / rule-consistency evaluation; no real users, no expert labels, no clinical claims',
  model: { id: 'fp-coach-ranker', version: '1.0.0', trainedWeights: false, catalogueFingerprint: VALIDATED_CATALOGUE_FINGERPRINT },
  profileSpace: { totalProfiles: total, riskNoneProfiles: riskNone.length, p0ReplicaMismatches: replicaMismatches },
  safety, leakage: leak, discrimination, sensitivity: sensitivityRates,
  ties: {
    rulesItemsDecidedOnlyById: rulesIdTieItems, rulesItems, rulesShare: r4(rulesIdTieItems / rulesItems),
    modelGreedySteps: decidedTotal, modelDecidedBy: decided, modelIdShare: r4(decided.id / decidedTotal), modelItems,
  },
  topChapterProgrammeShare: { rules: share(topProgramme.rules), model: share(topProgramme.model) },
  distinctProgrammesPerSlate: { rulesMean: r4(mean(programmes.rules)), modelMean: r4(mean(programmes.model)) },
  regionCoverage: { rulesMean: r4(mean(cov.rules)), modelMean: r4(mean(cov.model)), coverableProfiles: cov.coverableProfiles, rulesFullCoverage: r4(cov.rulesFullWhenCoverable / cov.coverableProfiles), modelFullCoverage: r4(cov.modelFullWhenCoverable / cov.coverableProfiles) },
  chapterRegionPrecision: { rulesMean: r4(mean(prec.rules.filter(Number.isFinite))), modelMean: r4(mean(prec.model.filter(Number.isFinite))), singleRegionRules: r4(mean(prec.rulesSingleRegion.filter(Number.isFinite))), singleRegionModel: r4(mean(prec.modelSingleRegion.filter(Number.isFinite))) },
  coverageGapDisclosure: { profilesWithUncoverableRegion: gapStats.profilesWithGap, modelStructuredDisclosure: gapStats.modelDisclosed, rulesStructuredDisclosure: 'not supported by P0 contract' },
  meanCautionTagsPerChapterNonLimited: { rules: r4(mean(load.rules)), model: r4(mean(load.model)) },
  preferenceConformance: { checked: prefConf.checked, pass: prefConf.pass, note: 'model unified order only; P0 leaves cross-category order to the UI' },
  rankingEffectVsRules: Object.fromEntries([...effects.entries()].map(([k, v]) => [k, { profiles: v, share: r4(v / riskNone.length) }])),
  availability: availabilityCases,
  fallback: { cases: faults, guardBypass, invalidRequests },
  performance: { latency, heapDeltaBytesAfterRuns: heapAfter - heapBefore, bundle },
  personas: { set: PERSONA_SET, file: personaFile.replace(/\\/g, '/'), sha256: sha256(personaText), rules: tally('rules'), model: tally('model'), results: personaResults },
}
const name = `evaluation-${PERSONA_SET}.json`
writeFileSync(resolve(OUT, name), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ written: resolve(OUT, name), personas: report.personas.rules, personasModel: report.personas.model, discrimination, sensitivity: sensitivityRates, ties: report.ties, coverage: report.regionCoverage, precision: report.chapterRegionPrecision, effects: report.rankingEffectVsRules, safety, leak, latency: latency.adapterActive, bundle }, null, 1))
