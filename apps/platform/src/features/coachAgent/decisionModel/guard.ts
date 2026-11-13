import type { CoachProfile, KnowledgeEntry } from '../recommendation/types'
import { DESCRIPTOR_USAGE, MOTION_DESCRIPTORS } from './descriptors'
import { DECISION_MODEL_ID, DECISION_MODEL_VERSION, type CatalogueAvailability, type DecisionModelOutput } from './types'

const LIMITS = { chapters: 3, games: 2, programmes: 2 }

/**
 * Output guard, written independently of the ranker's candidate pool. Any violation means the
 * model slate is withheld and the P0 rules result stays active. The guard never repairs output.
 */
export function guardModelOutput(output: DecisionModelOutput, profile: CoachProfile, catalogue: readonly KnowledgeEntry[], availability: CatalogueAvailability | null): string[] {
  const violations: string[] = []
  const byId = new Map(catalogue.map(entry => [entry.id, entry]))
  // Same conservative predicate as the P0 engine, restated here on purpose.
  const limited = profile.difficulties.includes('reach_difficulty') || profile.difficulties.includes('soreness') || profile.goals.includes('rehab_support')
  const unavailable = new Set(availability?.unavailableIds ?? [])
  if (output.model.id !== DECISION_MODEL_ID || output.model.version !== DECISION_MODEL_VERSION || output.model.trainedWeights !== false) violations.push('MODEL_IDENTITY')
  if (profile.risk !== 'none') violations.push('RISK_PROFILE_REACHED_MODEL')

  const chapterIds = output.result.chapters.map(item => item.entry.id)
  const gameIds = output.result.games.map(item => item.entry.id)
  const priorityIds = output.priority.map(item => item.id)
  if (new Set(priorityIds).size !== priorityIds.length) violations.push('DUPLICATE_ITEM')
  if (chapterIds.length > LIMITS.chapters || gameIds.length > LIMITS.games) violations.push('SLATE_LIMIT')
  if ([...chapterIds, ...gameIds].sort().join('|') !== [...priorityIds].sort().join('|')) violations.push('PRIORITY_RESULT_MISMATCH')
  output.priority.forEach((item, index) => {
    if (item.rank !== index + 1 || !Number.isFinite(item.utility)) violations.push(`PRIORITY_FIELD:${item.id}`)
  })

  for (const [kind, ids] of [['chapter', chapterIds], ['game', gameIds]] as const) {
    for (const id of ids) {
      const entry = byId.get(id)
      if (!entry || entry.kind !== kind) { violations.push(`UNKNOWN_OR_WRONG_KIND:${id}`); continue }
      if (entry.verification !== 'project_verified') violations.push(`UNVERIFIED:${id}`)
      if (limited && entry.caution.length > 0) violations.push(`CAUTION_FOR_LIMITED:${id}`)
      if (kind === 'chapter' && entry.href === null) violations.push(`NOT_LAUNCHABLE:${id}`)
      if (unavailable.has(id) || (entry.programId && unavailable.has(entry.programId))) violations.push(`UNAVAILABLE:${id}`)
      if (limited && kind === 'chapter') {
        const descriptor = MOTION_DESCRIPTORS.get(id)
        if (descriptor?.reliable && DESCRIPTOR_USAGE.cautionUnion.some(flag => descriptor.flags[flag].flagged)) violations.push(`MEASURED_CAUTION_FOR_LIMITED:${id}`)
      }
      const priority = output.priority.find(item => item.id === id)
      if (priority && (priority.href !== entry.href || priority.kind !== kind)) violations.push(`PRIORITY_ENTRY_MISMATCH:${id}`)
    }
  }
  const programmes = new Set(chapterIds.map(id => byId.get(id)?.programId))
  if (programmes.size > LIMITS.programmes) violations.push('PROGRAMME_LIMIT')
  for (const routine of output.result.routines) {
    if (routine.entry.kind !== 'routine' || !programmes.has(routine.entry.programId) || routine.entry.href !== null) violations.push(`ROUTINE:${routine.entry.id}`)
  }
  const evidenceIds = new Set(output.result.evidence.map(item => item.id))
  for (const item of [...output.result.routines, ...output.result.chapters, ...output.result.games]) {
    if (!item.evidenceIds.every(id => evidenceIds.has(id))) violations.push(`DANGLING_EVIDENCE:${item.entry.id}`)
    const catalogueEntry = byId.get(item.entry.id)
    if (catalogueEntry && JSON.stringify({ ...catalogueEntry, href: item.entry.kind === 'routine' ? null : catalogueEntry.href }) !== JSON.stringify(item.entry)) violations.push(`ENTRY_ALTERED:${item.entry.id}`)
  }
  if (output.status === 'empty' && priorityIds.length) violations.push('EMPTY_WITH_ITEMS')
  return violations
}
