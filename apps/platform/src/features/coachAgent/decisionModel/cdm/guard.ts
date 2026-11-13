import type { CoachProfile, KnowledgeEntry } from '../../recommendation/types'
import { DESCRIPTOR_USAGE, MOTION_DESCRIPTORS } from '../descriptors'
import type { CatalogueAvailability } from '../types'
import { CDM_MODEL_ID, type CdmOutput } from './model'

/** Independent output guard: recomputes the safe pool itself and never repairs output. */
export function guardCdmOutput(out: CdmOutput, profile: CoachProfile, catalogue: readonly KnowledgeEntry[], availability: CatalogueAvailability | null): string[] {
  const v: string[] = []
  const byId = new Map(catalogue.map(e => [e.id, e]))
  const limited = profile.difficulties.includes('reach_difficulty') || profile.difficulties.includes('soreness') || profile.goals.includes('rehab_support')
  const unavailable = new Set(availability?.unavailableIds ?? [])
  if (out.model.id !== CDM_MODEL_ID || out.model.trainedWeights !== true) v.push('MODEL_IDENTITY')
  if (profile.risk !== 'none') v.push('RISK_PROFILE_REACHED_MODEL')
  if (out.confidence !== null && !(out.confidence >= 0 && out.confidence <= 1)) v.push('CONFIDENCE_RANGE')
  for (let i = 0; i < out.candidates.length; i += 1) {
    const c = out.candidates[i]
    const e = byId.get(c.id)
    if (!e || e.kind === 'routine') { v.push(`UNKNOWN:${c.id}`); continue }
    if (!(c.suitability >= 0 && c.suitability <= 1) || !Number.isFinite(c.score)) v.push(`SCORE:${c.id}`)
    if (i > 0 && out.candidates[i - 1].score < c.score) v.push('NOT_SORTED')
    if (e.verification !== 'project_verified') v.push(`UNVERIFIED:${c.id}`)
    if (limited && e.caution.length) v.push(`CAUTION_FOR_LIMITED:${c.id}`)
    if (e.kind === 'chapter' && e.href === null) v.push(`NOT_LAUNCHABLE:${c.id}`)
    if (unavailable.has(c.id) || (e.programId && unavailable.has(e.programId))) v.push(`UNAVAILABLE:${c.id}`)
    const d = MOTION_DESCRIPTORS.get(c.id)
    if (limited && d?.reliable && DESCRIPTOR_USAGE.cautionUnion.some(f => d.flags[f].flagged)) v.push(`MEASURED_CAUTION_FOR_LIMITED:${c.id}`)
  }
  if (new Set(out.candidates.map(c => c.id)).size !== out.candidates.length) v.push('DUPLICATE')
  if (out.status === 'ready') {
    if (!out.result) v.push('READY_WITHOUT_RESULT')
    else {
      const ids = [...out.result.chapters, ...out.result.games].map(x => x.entry.id)
      if (out.result.chapters.length > 3 || out.result.games.length > 2) v.push('SLATE_LIMIT')
      if (new Set(out.result.chapters.map(x => x.entry.programId)).size > 2) v.push('PROGRAMME_LIMIT')
      if ([...ids].sort().join() !== [...out.priority].sort().join()) v.push('PRIORITY_RESULT_MISMATCH')
      if (!ids.every(id => out.candidates.some(c => c.id === id))) v.push('SLATE_OUTSIDE_CANDIDATES')
      for (const item of [...out.result.chapters, ...out.result.games]) {
        const e = byId.get(item.entry.id)
        if (!e || JSON.stringify(e) !== JSON.stringify(item.entry)) v.push(`ENTRY_ALTERED:${item.entry.id}`)
      }
    }
  } else if (out.result !== null || out.priority.length) v.push('ABSTAIN_WITH_RESULT')
  return v
}
