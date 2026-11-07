import type { BodyRegion, Focus, KnowledgeEntry } from '../../recommendation/types'
import { MOTION_DESCRIPTORS } from '../descriptors'
import m1 from './m1ContentFeatures.json'
import type { DecisionState } from './state'

/**
 * fp-cdm feature builder v1. Single source of truth for training export AND browser inference.
 * Groups: P = content + profile×content crosses, H = history×content, R = report×content.
 * Only features that vary between candidates of the same user are included (a pairwise ranker cancels the rest).
 */
export const FEATURE_SET_VERSION = 'fp-cdm-features/v1'
const REGIONS: BodyRegion[] = ['shoulders', 'neck', 'arms', 'trunk', 'legs']
const FOCUSES: Focus[] = ['reach', 'stability', 'coordination', 'rhythm', 'general']
const CAUTIONS = ['overhead', 'balance', 'twist', 'bending', 'weight_bearing'] as const
const PROGRAMS = ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing'] as const
const GOALS = ['mobility', 'upper_limb', 'daily', 'rehab_support'] as const
const DIFFICULTIES = ['stiffness', 'reach_difficulty', 'soreness', 'sedentary', 'none'] as const
const M1_REGION = REGIONS.map(r => `region:${r}`)
const M1_CAUTION = ['caution:overhead', 'caution:balance', 'caution:twist', 'caution:bending']
const M1 = (m1 as unknown as { chapters: Record<string, Record<string, number>> }).chapters

export type FeatureGroup = 'P' | 'H' | 'R'
interface Spec { name: string; group: FeatureGroup }
const specs: Spec[] = []
const add = (group: FeatureGroup, ...names: string[]) => { for (const name of names) specs.push({ name, group }) }
add('P', 'c_is_game', ...PROGRAMS.map(p => `c_prog_${p}`), ...REGIONS.map(r => `c_region_${r}`), ...FOCUSES.map(f => `c_focus_${f}`), 'c_caution_count', ...CAUTIONS.map(c => `c_caution_${c}`))
add('P', ...M1_REGION.map(k => `c_m1_${k.replace(':', '_')}`), ...M1_CAUTION.map(k => `c_m1_${k.replace(':', '_')}`), 'c_m1_missing', 'c_deepknee_s', 'c_form_position')
add('P', 'x_region_overlap', 'x_region_recall', 'x_region_precision', 'x_region_f1', ...REGIONS.map(r => `x_region_match_${r}`), 'x_m1_region_selected_mean')
add('P', ...GOALS.flatMap(g => FOCUSES.map(f => `x_goal_${g}_focus_${f}`)), ...DIFFICULTIES.flatMap(d => FOCUSES.map(f => `x_diff_${d}_focus_${f}`)), ...DIFFICULTIES.map(d => `x_diff_${d}_caution_count`))
add('P', 'x_pref_kind_match', 'x_pref_mixed_game')
add('H', 'h_practised_this_log', 'h_completion_this', 'h_score_this', 'h_trend_this', 'h_recency_this', 'h_practised_programme_log', 'h_next_in_programme', 'h_novel', 'h_game_played_this_log', 'h_game_completion_this', 'h_focus_overlap_practised')
add('R', 'r_focus_match', 'r_focus_need_weighted', 'r_same_subject', 'r_same_programme', 'r_worse_focus_match')

export const FEATURE_NAMES: readonly string[] = Object.freeze(specs.map(s => s.name))
export const FEATURE_GROUPS: Readonly<Record<string, FeatureGroup>> = Object.freeze(Object.fromEntries(specs.map(s => [s.name, s.group])))

const H_NAMES = FEATURE_NAMES.filter(n => FEATURE_GROUPS[n] === 'H')
const R_NAMES = FEATURE_NAMES.filter(n => FEATURE_GROUPS[n] === 'R')
interface CatalogueIndex { byId: Map<string, KnowledgeEntry>; siblings: Map<string, KnowledgeEntry[]> }
const indexCache = new WeakMap<readonly KnowledgeEntry[], CatalogueIndex>()
/** Per-catalogue lookups computed once (pure; keyed by the catalogue array identity). */
function catalogueIndex(catalogue: readonly KnowledgeEntry[]): CatalogueIndex {
  let index = indexCache.get(catalogue)
  if (!index) {
    const siblings = new Map<string, KnowledgeEntry[]>()
    for (const e of catalogue) if (e.kind === 'chapter' && e.programId) siblings.set(e.programId, [...(siblings.get(e.programId) ?? []), e])
    index = { byId: new Map(catalogue.map(e => [e.id, e])), siblings }
    indexCache.set(catalogue, index)
  }
  return index
}
/** Position of a chapter inside its programme (0 = first), from the catalogue order. */
function formPosition(entry: KnowledgeEntry, catalogue: readonly KnowledgeEntry[]): number {
  if (entry.kind !== 'chapter' || !entry.programId) return 0
  const siblings = catalogueIndex(catalogue).siblings.get(entry.programId) ?? []
  return siblings.length > 1 ? siblings.indexOf(entry) / (siblings.length - 1) : 0
}

export function buildFeatures(state: DecisionState, entry: KnowledgeEntry, catalogue: readonly KnowledgeEntry[]): Float64Array {
  const v: Record<string, number> = {}
  const p = state.profile
  const sel = new Set(p.regions)
  v.c_is_game = entry.kind === 'game' ? 1 : 0
  for (const prog of PROGRAMS) v[`c_prog_${prog}`] = entry.programId === prog ? 1 : 0
  for (const r of REGIONS) v[`c_region_${r}`] = entry.regions.includes(r) ? 1 : 0
  for (const f of FOCUSES) v[`c_focus_${f}`] = entry.focuses.includes(f) ? 1 : 0
  v.c_caution_count = entry.caution.length
  for (const c of CAUTIONS) v[`c_caution_${c}`] = entry.caution.includes(c) ? 1 : 0
  const m = entry.kind === 'chapter' ? M1[entry.id] : undefined
  for (const k of [...M1_REGION, ...M1_CAUTION]) v[`c_m1_${k.replace(':', '_')}`] = m?.[k] ?? 0
  v.c_m1_missing = m ? 0 : 1
  const d = entry.kind === 'chapter' ? MOTION_DESCRIPTORS.get(entry.id) : undefined
  v.c_deepknee_s = d?.reliable ? Math.min(1, d.flags.deepKnee.sustainedSeconds / 10) : 0
  v.c_form_position = formPosition(entry, catalogue)

  const overlap = entry.regions.filter(r => sel.has(r)).length
  const recall = overlap / p.regions.length, precision = entry.regions.length ? overlap / entry.regions.length : 0
  v.x_region_overlap = overlap; v.x_region_recall = recall; v.x_region_precision = precision
  v.x_region_f1 = overlap ? (2 * recall * precision) / (recall + precision) : 0
  for (const r of REGIONS) v[`x_region_match_${r}`] = sel.has(r) && entry.regions.includes(r) ? 1 : 0
  v.x_m1_region_selected_mean = m ? p.regions.reduce((s, r) => s + (m[`region:${r}`] ?? 0), 0) / p.regions.length : 0
  for (const g of GOALS) for (const f of FOCUSES) v[`x_goal_${g}_focus_${f}`] = p.goals.includes(g) && entry.focuses.includes(f) ? 1 : 0
  for (const dd of DIFFICULTIES) {
    for (const f of FOCUSES) v[`x_diff_${dd}_focus_${f}`] = p.difficulties.includes(dd) && entry.focuses.includes(f) ? 1 : 0
    v[`x_diff_${dd}_caution_count`] = p.difficulties.includes(dd) ? entry.caution.length : 0
  }
  v.x_pref_kind_match = (p.preference === 'game' && entry.kind === 'game') || (p.preference === 'routine' && entry.kind !== 'game') ? 1 : 0
  v.x_pref_mixed_game = p.preference === 'mixed' && entry.kind === 'game' ? 1 : 0

  const h = state.history
  const idx = catalogueIndex(catalogue)
  for (const name of H_NAMES) v[name] = 0
  if (h.status === 'present') {
    const mine = h.routines.find(r => r.chapterId === entry.id)
    const programmeSessions = h.routines.filter(r => r.programId === entry.programId && r.chapterId !== entry.id).reduce((s, r) => s + r.sessions, 0)
    v.h_practised_this_log = mine ? Math.log1p(mine.sessions) : 0
    v.h_completion_this = mine && mine.completedSessions !== null && mine.sessions > 0 ? mine.completedSessions / mine.sessions : 0
    v.h_score_this = mine && mine.meanScore !== null ? mine.meanScore / 100 : 0
    v.h_trend_this = mine?.trend === 'up' ? 1 : mine?.trend === 'down' ? -1 : 0
    v.h_recency_this = mine && mine.lastDaysAgo !== null ? Math.exp(-mine.lastDaysAgo / 7) : 0
    v.h_practised_programme_log = entry.kind === 'chapter' ? Math.log1p(programmeSessions) : 0
    if (entry.kind === 'chapter') {
      const siblings = idx.siblings.get(entry.programId ?? '') ?? []
      const index = siblings.indexOf(entry)
      v.h_next_in_programme = index > 0 && h.routines.some(r => r.chapterId === siblings[index - 1].id) && !mine ? 1 : 0
    }
    const game = h.games.find(g => g.gameId === entry.id)
    v.h_novel = !mine && !game ? 1 : 0
    v.h_game_played_this_log = game ? Math.log1p(game.plays) : 0
    v.h_game_completion_this = game && game.completedPlays !== null && game.plays > 0 ? game.completedPlays / game.plays : 0
    const practisedFocus = new Set(h.routines.flatMap(r => idx.byId.get(r.chapterId)?.focuses ?? []))
    v.h_focus_overlap_practised = entry.focuses.filter(f => practisedFocus.has(f)).length / Math.max(1, entry.focuses.length)
  }
  const r = state.report
  for (const name of R_NAMES) v[name] = 0
  if (r.status === 'present') {
    const hits = r.findings.filter(f => entry.focuses.includes(f.focus))
    v.r_focus_match = hits.length
    v.r_focus_need_weighted = hits.reduce((s, f) => s + (f.score === null ? 0.5 : (100 - f.score) / 100), 0)
    v.r_same_subject = r.findings.some(f => f.subjectId === entry.id) ? 1 : 0
    const subjectProgrammes = new Set(r.findings.map(f => idx.byId.get(f.subjectId)?.programId).filter(Boolean))
    v.r_same_programme = entry.programId && subjectProgrammes.has(entry.programId) ? 1 : 0
    v.r_worse_focus_match = hits.filter(f => f.trend === 'worse').length
  }
  const out = new Float64Array(FEATURE_NAMES.length)
  FEATURE_NAMES.forEach((name, i) => {
    const value = v[name]
    if (!Number.isFinite(value)) throw new Error(`feature ${name} not finite for ${entry.id}`)
    out[i] = value
  })
  return out
}
