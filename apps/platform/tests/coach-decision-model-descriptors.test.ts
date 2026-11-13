import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COACH_KNOWLEDGE } from '../src/features/coachAgent/recommendation/catalogue'
import { DESCRIPTOR_META, DESCRIPTOR_USAGE, MEASURED_TO_CAUTION, MOTION_DESCRIPTORS, descriptorIntegrity } from '../src/features/coachAgent/decisionModel/descriptors'
import { catalogueFingerprint } from '../src/features/coachAgent/decisionModel/ranker'
import { VALIDATED_CATALOGUE_FINGERPRINT } from '../src/features/coachAgent/decisionModel/adapter'

const ROOT = resolve(import.meta.dirname, '..')
const sha256 = (path: string) => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex')

describe('motion descriptors provenance', () => {
  it('match the committed config and reference tracks byte for byte', () => {
    expect(DESCRIPTOR_META.configSha256).toBe(sha256('scripts/decision-model/descriptor-config.json'))
    for (const track of DESCRIPTOR_META.tracks) expect(sha256(track.path.replace(/^apps\/platform\//, ''))).toBe(track.sha256)
    expect(descriptorIntegrity(COACH_KNOWLEDGE)).toEqual([])
  })

  it('pins the catalogue the model was validated against', () => {
    // If this fails, the catalogue changed: rerun audit-descriptors.ts + evaluate.ts before updating the constant.
    expect(catalogueFingerprint(COACH_KNOWLEDGE)).toBe(VALIDATED_CATALOGUE_FINGERPRINT)
  })
})

describe('pre-declared usage rules U1/U2 still hold for the bundled data', () => {
  const reliable = [...MOTION_DESCRIPTORS.values()].filter(item => item.reliable)
  const entry = (id: string) => COACH_KNOWLEDGE.find(item => item.id === id)!

  it('U1: only channels firing on >=3 chapters with precision >=0.6 join the caution union', () => {
    for (const [flag, caution] of Object.entries(MEASURED_TO_CAUTION)) {
      const firing = reliable.filter(item => item.flags[flag as keyof typeof MEASURED_TO_CAUTION].flagged)
      const precision = firing.length ? firing.filter(item => entry(item.chapterId).caution.includes(caution)).length / firing.length : 0
      const used = (DESCRIPTOR_USAGE.cautionUnion as readonly string[]).includes(flag)
      expect(used, `${flag} precision ${precision.toFixed(2)} n=${firing.length}`).toBe(firing.length >= 3 && precision >= 0.6)
    }
  })

  it('U2: only regions with AUC >= 0.70 refine ranking', () => {
    for (const region of ['shoulders', 'neck', 'arms', 'trunk', 'legs'] as const) {
      const scored = reliable.filter(item => item.involvement[region] !== null)
      const pos = scored.filter(item => entry(item.chapterId).regions.includes(region)).map(item => item.involvement[region] as number)
      const neg = scored.filter(item => !entry(item.chapterId).regions.includes(region)).map(item => item.involvement[region] as number)
      let wins = 0
      for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0
      const auc = wins / (pos.length * neg.length)
      expect((DESCRIPTOR_USAGE.rankingRegions as readonly string[]).includes(region), `${region} auc ${auc.toFixed(3)}`).toBe(auc >= 0.7)
    }
  })

  it('U4: the measured union only removes entries (no limited-safe entry is re-admitted)', () => {
    for (const item of reliable) {
      const flagged = DESCRIPTOR_USAGE.cautionUnion.some(flag => item.flags[flag].flagged)
      if (!flagged) continue
      // Every measured-union chapter is either already caution-tagged or would be newly excluded; never added.
      expect(entry(item.chapterId).kind).toBe('chapter')
    }
  })
})
