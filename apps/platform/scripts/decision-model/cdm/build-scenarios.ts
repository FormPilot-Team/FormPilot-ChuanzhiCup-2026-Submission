/**
 * Builds the synthetic scenario set for human annotation (fp-cdm labels v1).
 *   node <vite-node.mjs> scripts/decision-model/cdm/build-scenarios.ts
 * Deterministic (seeded). Users, histories and reports are synthetic designs; the split is fixed
 * here, BEFORE any label exists, by scenario family (all conditions of one base profile stay together).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'
import { recommendCoach } from '../../../src/features/coachAgent/recommendation/engine'
import type { BodyRegion, CoachProfile, Focus, KnowledgeEntry } from '../../../src/features/coachAgent/recommendation/types'
import { rankCoachDecision, isLimitedProfile } from '../../../src/features/coachAgent/decisionModel/ranker'
import { scenarioEvidence } from './evidence'
import type { Scenario, ScenarioFile, SyntheticHistory, SyntheticReport } from './scenarioTypes'

export const SEED = 20261107
const POOL_SIZE = 12
const OUT_DIR = resolve(import.meta.dirname, 'data')

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const GOALS = ['mobility', 'upper_limb', 'daily', 'rehab_support'] as const
const DIFFICULTIES = ['stiffness', 'reach_difficulty', 'soreness', 'sedentary'] as const
const REGIONS: BodyRegion[] = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
const PREFERENCES = ['routine', 'game', 'mixed'] as const
const subsets = <T>(items: readonly T[]): T[][] => Array.from({ length: (1 << items.length) - 1 }, (_, mask) => items.filter((_, bit) => ((mask + 1) >> bit) & 1))

function allProfiles(): CoachProfile[] {
  const out: CoachProfile[] = []
  for (const goals of subsets(GOALS)) for (const difficulties of [['none'] as CoachProfile['difficulties'], ...subsets(DIFFICULTIES)]) for (const regions of subsets(REGIONS))
    for (const preference of PREFERENCES) out.push({ version: 1, goals: [...goals], difficulties: [...difficulties], regions: [...regions], preference, risk: 'none', acknowledged: true })
  return out
}
function safePool(profile: CoachProfile): KnowledgeEntry[] {
  const limited = isLimitedProfile(profile)
  return COACH_KNOWLEDGE.filter(e => e.kind !== 'routine' && e.verification === 'project_verified' && (!limited || e.caution.length === 0) && !(e.kind === 'chapter' && e.href === null))
}

function main() {
  const rand = mulberry32(SEED)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]
  const shuffle = <T>(items: T[]): T[] => { const a = [...items]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
  const profiles = allProfiles()
  // 18 strata: limited × region-count bucket × preference; one family each, plus 6 extra uniform draws.
  const bucket = (p: CoachProfile) => `${isLimitedProfile(p) ? 'L' : 'N'}|${Math.min(p.regions.length, 3)}|${p.preference}`
  const strata = new Map<string, CoachProfile[]>()
  for (const p of profiles) { const key = bucket(p); strata.set(key, [...(strata.get(key) ?? []), p]) }
  const bases: Array<{ profile: CoachProfile; stratum: string }> = []
  for (const key of [...strata.keys()].sort()) bases.push({ profile: pick(strata.get(key)!), stratum: key })
  // Extras balanced 3 limited + 3 non-limited (uniform draws would be ~88% limited).
  for (const wantLimited of [true, true, true, false, false, false]) {
    for (;;) {
      const p = pick(profiles)
      if (isLimitedProfile(p) !== wantLimited || bases.some(b => JSON.stringify(b.profile) === JSON.stringify(p))) continue
      bases.push({ profile: p, stratum: `extra:${bucket(p)}` }); break
    }
  }
  // Frozen test families: 6 of 24, chosen before labels exist, 3 limited + 3 non-limited.
  const order = shuffle(bases.map((_, i) => i))
  const testIdx = [...order.filter(i => bases[i].profile && isLimitedProfile(bases[i].profile)).slice(0, 3), ...order.filter(i => !isLimitedProfile(bases[i].profile)).slice(0, 3)]

  const scenarios: Scenario[] = []
  bases.forEach(({ profile }, index) => {
    const familyId = `F${String(index + 1).padStart(2, '0')}`
    const pool = safePool(profile)
    const chapters = pool.filter(e => e.kind === 'chapter'), games = pool.filter(e => e.kind === 'game')
    const practised = shuffle(chapters).slice(0, Math.min(chapters.length, 1 + Math.floor(rand() * 3)))
    const history: SyntheticHistory = {
      dataOrigin: 'synthetic_scenario',
      sessionsLast28d: 0,
      routines: practised.map(e => {
        const sessions = 1 + Math.floor(rand() * 6)
        return { chapterId: e.id, programId: e.programId!, sessions, completedSessions: Math.max(0, sessions - Math.floor(rand() * 3)), lastDaysAgo: 1 + Math.floor(rand() * 20), meanScore: 55 + Math.floor(rand() * 38), trend: pick(['up', 'flat', 'down'] as const) }
      }),
      games: games.length && rand() < 0.6 ? [{ gameId: pick(games).id, plays: 1 + Math.floor(rand() * 5), completedPlays: 0, lastDaysAgo: 1 + Math.floor(rand() * 14) }] : [],
    }
    for (const g of history.games) g.completedPlays = Math.max(0, g.plays - Math.floor(rand() * 2))
    history.sessionsLast28d = history.routines.reduce((s, r) => s + r.sessions, 0) + history.games.reduce((s, g) => s + g.plays, 0)
    const latest = [...history.routines].sort((a, b) => a.lastDaysAgo - b.lastDaysAgo)[0]
    const latestEntry = COACH_KNOWLEDGE.find(e => e.id === latest?.chapterId)
    const focusChoices = (latestEntry?.focuses.filter(f => f !== 'general') ?? []) as Array<Exclude<Focus, 'general'>>
    const FOCUS_TEXT: Record<Exclude<Focus, 'general'>, string> = { reach: '动作幅度待关注', stability: '姿势与支撑稳定待关注', coordination: '左右/手脚配合待关注', rhythm: '动作节奏待关注' }
    const findingFocus = [pick(focusChoices.length ? focusChoices : ['rhythm', 'stability', 'reach', 'coordination'] as const), ...(rand() < 0.4 ? [pick(['rhythm', 'stability', 'reach', 'coordination'] as const)] : [])]
    const report: SyntheticReport | null = latest ? {
      dataOrigin: 'synthetic_scenario', subjectId: latest.chapterId, daysAgo: latest.lastDaysAgo,
      findings: [...new Set(findingFocus)].map(focus => ({ focus, subjectId: latest.chapterId, score: 45 + Math.floor(rand() * 36), trend: pick(['worse', 'same', 'better'] as const), label: `${latestEntry?.title ?? latest.chapterId}：${FOCUS_TEXT[focus]}` })),
    } : null
    const conditions: Array<[Scenario['condition'], SyntheticHistory | null, SyntheticReport | null]> = [['A_profile', null, null], ['B_history', history, null], ['C_history_report', history, report]]
    // One candidate pool per family so the three conditions are judged on identical candidates (needed for E3).
    const pooled: Scenario['pooledFrom'] = {}
    for (const [, h, r] of conditions) {
      const evidence = scenarioEvidence(h, r)
      const rules = recommendCoach(profile, { evidence, limitations: [], decisionStatus: 'synthetic' })
      for (const item of [...rules.chapters, ...rules.games]) pooled[item.entry.id] = [...new Set([...(pooled[item.entry.id] ?? []), 'rules_p0' as const])]
      const ranker = rankCoachDecision({ profile, evidence, availability: null, catalogue: COACH_KNOWLEDGE })
      for (const item of ranker.priority) pooled[item.id] = [...new Set([...(pooled[item.id] ?? []), 'pr49_ranker' as const])]
    }
    for (const entry of shuffle(pool)) {
      if (Object.keys(pooled).length >= POOL_SIZE) break
      if (!pooled[entry.id]) pooled[entry.id] = ['random_fill']
    }
    const candidates = shuffle(Object.keys(pooled))
    for (const [condition, h, r] of conditions) {
      scenarios.push({ id: `${familyId}-${condition[0]}`, familyId, condition, split: testIdx.includes(index) ? 'test' : 'dev', profile, history: h, report: r, candidates, pooledFrom: pooled })
    }
  })
  const file: ScenarioFile = { schemaVersion: 1, id: 'fp-cdm-scenarios/v1', seed: SEED, generatedBy: 'scripts/decision-model/cdm/build-scenarios.ts', dataOrigin: 'synthetic_scenarios_for_human_annotation', families: bases.length, scenarios }
  mkdirSync(OUT_DIR, { recursive: true })
  const text = `${JSON.stringify(file, null, 1)}\n`
  writeFileSync(resolve(OUT_DIR, 'scenarios.v1.json'), text)
  const judgments = scenarios.reduce((s, x) => s + x.candidates.length, 0)
  console.log(JSON.stringify({ families: bases.length, scenarios: scenarios.length, judgmentsPerAnnotator: judgments, test: scenarios.filter(s => s.split === 'test').length,
    strata: bases.map(b => b.stratum), sha256: createHash('sha256').update(text).digest('hex') }))
}
main()
