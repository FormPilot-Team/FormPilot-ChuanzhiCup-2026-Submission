// Freezes / verifies the fp-cdm release manifest (src/features/coachAgent/decisionModel/engine/release.ts).
//   node $VN scripts/decision-model/cdm/freeze-release.ts            # verify: exit 1 when release.ts is out of step
//   node $VN scripts/decision-model/cdm/freeze-release.ts --write    # write fingerprints + SHA-256 into release.ts
//   node $VN scripts/decision-model/cdm/freeze-release.ts --manifest <out.json>   # full model-file manifest (delivery)
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COACH_KNOWLEDGE } from '../../../src/features/coachAgent/recommendation/catalogue'
import { catalogueFingerprint } from '../../../src/features/coachAgent/decisionModel/ranker'
import { loadWeights } from '../../../src/features/coachAgent/decisionModel/cdm/model'
import { contentTableFingerprint, FP_CDM_RELEASE, weightsFingerprint } from '../../../src/features/coachAgent/decisionModel/engine/release'

const repo = resolve('../..')
const sha = (rel: string) => createHash('sha256').update(readFileSync(resolve(repo, rel))).digest('hex')
const weightsRaw = JSON.parse(readFileSync(resolve(repo, FP_CDM_RELEASE.m2.weightsFile), 'utf8'))
const loaded = loadWeights(weightsRaw)
if (!loaded.ok) throw new Error(`bundled weights do not load: ${loaded.reason}`)
const computed = {
  weightsFingerprint: weightsFingerprint(loaded.weights),
  weightsSha256: sha(FP_CDM_RELEASE.m2.weightsFile),
  contentTableFingerprint: contentTableFingerprint(),
  contentTableSha256: sha(FP_CDM_RELEASE.m1.contentTableFile),
  catalogueFingerprint: catalogueFingerprint(COACH_KNOWLEDGE),
}
const argv = process.argv.slice(2)
const releasePath = resolve('src/features/coachAgent/decisionModel/engine/release.ts')
if (argv.includes('--write')) {
  let text = readFileSync(releasePath, 'utf8')
  const set = (key: string, value: string) => {
    const re = new RegExp(`(${key}: ')[^']*(')`)
    if (!re.test(text)) throw new Error(`key ${key} not found`)
    text = text.replace(re, `$1${value}$2`)
  }
  set('weightsFingerprint', computed.weightsFingerprint); set('weightsSha256', computed.weightsSha256)
  set('contentTableFingerprint', computed.contentTableFingerprint); set('contentTableSha256', computed.contentTableSha256)
  set('catalogueFingerprint', computed.catalogueFingerprint)
  writeFileSync(releasePath, text)
  console.log('release.ts written', computed)
} else {
  const current = { weightsFingerprint: FP_CDM_RELEASE.m2.weightsFingerprint, weightsSha256: FP_CDM_RELEASE.m2.weightsSha256, contentTableFingerprint: FP_CDM_RELEASE.m1.contentTableFingerprint,
    contentTableSha256: FP_CDM_RELEASE.m1.contentTableSha256, catalogueFingerprint: FP_CDM_RELEASE.catalogueFingerprint }
  const diff = Object.entries(computed).filter(([k, v]) => current[k as keyof typeof current] !== v)
  console.log(diff.length ? `MISMATCH ${JSON.stringify(diff)}` : 'release.ts matches the bundled files')
  if (diff.length) process.exitCode = 1
}
const mi = argv.indexOf('--manifest')
if (mi >= 0) {
  const files = [
    FP_CDM_RELEASE.m2.weightsFile, FP_CDM_RELEASE.m1.contentTableFile,
    'apps/platform/src/features/coachAgent/decisionModel/motionDescriptors.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m2-ai-experiment/fp-cdm-m2.ai-experiment.weights.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m2-ai-experiment/fp-cdm-m2.ai-experiment.weights+ranges.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m2-ai-experiment/fp-cdm-m2.ai-experiment.report.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m1/fp-cdm-m1.metrics.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m1/fp-cdm-m1.model.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m1/fp-cdm-m1.oof-content-features.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m1-v11/fp-cdm-m1-v11.report.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m1-v11/fp-cdm-m1-v11.oof-content-features.json',
    'apps/platform/scripts/decision-model/cdm/artifacts/m1-v11/fp-cdm-m1-robustness.json',
    'apps/platform/scripts/decision-model/cdm/data/scenarios.v1.json',
    'apps/platform/scripts/decision-model/cdm/labels-ai/fp-cdm-ai-labels-v1.json',
    'apps/platform/scripts/decision-model/cdm/annotation-kit/GUIDELINES.md',
    'apps/platform/src/features/coachAgent/decisionModel/cdm/features.ts',
    'apps/platform/src/features/coachAgent/decisionModel/cdm/model.ts',
    'apps/platform/src/features/coachAgent/decisionModel/engine/contract.ts',
  ]
  const manifest = {
    release: FP_CDM_RELEASE.release, generatedAt: new Date().toISOString(), computed,
    m2: { ...FP_CDM_RELEASE.m2, tier: loaded.tier, labels: loaded.weights.trainedOn.labels.kind, labelsSha256: loaded.weights.trainedOn.labels.file_sha256, matrixSha256: loaded.weights.trainedOn.matrixSha256, parameters: loaded.weights.coef.length * 3 + 4 },
    m1: FP_CDM_RELEASE.m1,
    files: files.filter(f => existsSync(resolve(repo, f))).map(f => ({ path: f, bytes: readFileSync(resolve(repo, f)).length, sha256: sha(f) })),
    rollback: [
      { to: 'rules (Agent Web P0)', how: 'mode "off" (default) — no code change' },
      { to: 'fp-coach-ranker v1 (PR #49, deterministic, no trained weights)', how: 'getCoachDecisionRecommendation from decisionModel/adapter.ts (unchanged)' },
      { to: 'fp-cdm runtime 1.1.0 with placeholder weights (always rules)', how: 'git show 34818ec:apps/platform/src/features/coachAgent/decisionModel/cdm/fp-cdm-m2.weights.json' },
    ],
  }
  writeFileSync(argv[mi + 1], JSON.stringify(manifest, null, 1))
  console.log('manifest', argv[mi + 1], manifest.files.length, 'files')
}
