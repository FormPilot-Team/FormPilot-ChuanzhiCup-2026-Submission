import type { BodyRegion, KnowledgeEntry } from '../recommendation/types'
import raw from './motionDescriptors.json'

export type MeasuredFlag = 'overhead' | 'bending' | 'balance' | 'twist' | 'deepKnee' | 'weightBearing'

export interface ChapterDescriptor {
  chapterId: string
  programId: string
  reliable: boolean
  window: { startSeconds: number; endSeconds: number }
  validFraction: number
  flags: Record<MeasuredFlag, { sustainedSeconds: number; frameFraction: number; flagged: boolean }>
  involvement: Record<BodyRegion, number | null>
}

export const DESCRIPTORS_ID = 'fp-motion-descriptors/v1'
export const DESCRIPTORS_EXTRACTOR_VERSION = '1.0.1'
export const DESCRIPTORS_SOURCE = 'apps/platform/src/features/coachAgent/decisionModel/motionDescriptors.json'

/**
 * Usage decided by the pre-declared rules U1–U4 (evidence: 20261107-coach-decision-model/experiments).
 * U1 caution channels used in the conservative union: fire on >=3 reliable chapters with precision >=0.6 vs tags.
 *    overhead (0.44), twist (0.29), weight_bearing (0.20) stayed audit-only.
 * U2 regions refined by measured involvement: AUC vs region tags >= 0.70 (arms 0.86, trunk 0.75, legs 0.87).
 *    shoulders (0.61) and neck (0.46) use catalogue tags only.
 * U3 deepKnee has no catalogue caution category: load descriptor only.
 * U4 measurement may only add exclusions.
 * tests/coach-decision-model-descriptors.test.ts recomputes these rules from the data and fails on drift.
 */
export const DESCRIPTOR_USAGE = Object.freeze({
  cautionUnion: Object.freeze(['bending', 'balance'] as const),
  rankingRegions: Object.freeze(['arms', 'trunk', 'legs'] as const satisfies readonly BodyRegion[]),
  loadOnly: Object.freeze(['deepKnee'] as const),
})

/** Measured caution channel -> catalogue caution tag it was validated against. */
export const MEASURED_TO_CAUTION: Readonly<Record<'overhead' | 'bending' | 'balance' | 'twist' | 'weightBearing', KnowledgeEntry['caution'][number]>> = {
  overhead: 'overhead', bending: 'bending', balance: 'balance', twist: 'twist', weightBearing: 'weight_bearing',
}

interface RawFile {
  id: string
  extractorVersion: string
  configSha256: string
  tracks: Array<{ programId: string; path: string; sha256: string }>
  chapters: ChapterDescriptor[]
}
const file = raw as unknown as RawFile

export const MOTION_DESCRIPTORS: ReadonlyMap<string, ChapterDescriptor> = new Map(file.chapters.map(item => [item.chapterId, item]))
export const DESCRIPTOR_META = Object.freeze({
  id: file.id,
  extractorVersion: file.extractorVersion,
  configSha256: file.configSha256,
  tracks: file.tracks.map(track => ({ ...track })),
})

/** Integrity check: the bundled descriptors must be the version validated for this model and match the catalogue chapters. */
export function descriptorIntegrity(catalogue: readonly KnowledgeEntry[]): string[] {
  const problems: string[] = []
  if (DESCRIPTOR_META.id !== DESCRIPTORS_ID) problems.push(`descriptor id ${DESCRIPTOR_META.id}`)
  if (DESCRIPTOR_META.extractorVersion !== DESCRIPTORS_EXTRACTOR_VERSION) problems.push(`extractor ${DESCRIPTOR_META.extractorVersion}`)
  const chapterIds = catalogue.filter(entry => entry.kind === 'chapter').map(entry => entry.id).sort()
  const described = [...MOTION_DESCRIPTORS.keys()].sort()
  if (chapterIds.join('|') !== described.join('|')) problems.push('chapter set differs from catalogue')
  for (const item of MOTION_DESCRIPTORS.values()) {
    const entry = catalogue.find(candidate => candidate.id === item.chapterId)
    if (entry && entry.programId !== item.programId) problems.push(`programme mismatch ${item.chapterId}`)
  }
  return problems
}

export function sourceRef(descriptor: ChapterDescriptor): string {
  const track = DESCRIPTOR_META.tracks.find(item => item.programId === descriptor.programId)
  return `${DESCRIPTORS_SOURCE}#${descriptor.chapterId} (${track?.path ?? 'track?'} sha256:${track?.sha256.slice(0, 12) ?? '?'} t=${descriptor.window.startSeconds}–${descriptor.window.endSeconds}s)`
}
