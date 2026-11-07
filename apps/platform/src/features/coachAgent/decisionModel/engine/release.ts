import type { CdmWeights } from '../cdm/model'
import m1Table from '../cdm/m1ContentFeatures.json'

/**
 * Frozen release manifest of the decision model shipped with this code. The engine computes the fingerprints of the
 * bundled weights, the M1 content table and the trusted catalogue once at start-up; any mismatch means the files and the
 * code are out of step, and the engine falls back to rules (MODEL_VERSION_MISMATCH / CONTENT_FEATURES_MISMATCH /
 * CATALOGUE_MISMATCH). SHA-256 values identify the files byte-for-byte (verified by tests and the delivery manifest;
 * the browser checks the synchronous fingerprints).
 */
export const FP_CDM_RELEASE = Object.freeze({
  release: 'fp-cdm-release/1.0.0',
  frozenAt: '2026-11-08',
  m2: Object.freeze({
    id: 'fp-cdm-m2' as const,
    version: '1.0.0',
    runtimeVersion: '1.2.0',
    featureSet: 'fp-cdm-features/v1',
    tier: 'ai_experimental' as const,
    weightsFile: 'apps/platform/src/features/coachAgent/decisionModel/cdm/fp-cdm-m2.weights.json',
    weightsFingerprint: 'fnv1a32x2:501683ad09c7bd0a',
    weightsSha256: 'd8bfd9ed8ad64d7b7832a4fefd063a6216af65ee3fc156b01b6dada484ac8b5c',
  }),
  m1: Object.freeze({
    id: 'fp-cdm-m1' as const,
    contentTableVersion: '1.0.0',
    contentTableFile: 'apps/platform/src/features/coachAgent/decisionModel/cdm/m1ContentFeatures.json',
    contentTableFingerprint: 'fnv1a32x2:ba463a0d4bd82785',
    contentTableSha256: 'c42f8f521154ff8531cdd84be103c999a1160f88737bd652bebd7d0bbb93d5c2',
    modelOfRecord: 'fp-cdm-m1 v1.1（嵌套留一功法验证 macro AUC 0.777；M2 v1.0 绑定 v1.0 的 out-of-fold 内容表）',
  }),
  catalogueFingerprint: 'fnv1a32x2:e01fd2104d0ef965',
})

/** FNV-1a 32x2 over a string (same construction as the PR #49 catalogue fingerprint). Synchronous and browser-safe. */
export function fingerprintText(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code ^ (index & 0xff), 0x01000193) >>> 0
  }
  return `fnv1a32x2:${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

/** Fingerprint of everything that changes a weights file's behaviour or identity. */
export function weightsFingerprint(w: CdmWeights): string {
  return fingerprintText(JSON.stringify([w.id, w.version, w.family, w.hyperparameter, w.featureSet, w.featureNames, w.mean, w.scale, w.coef,
    w.pairTemperature, w.platt.a, w.platt.b, w.abstainSuitabilityBelow, w.featureRange ?? null, String(w.trainedOn?.labels?.kind),
    w.trainedOn?.labels?.file_sha256 ?? null, w.trainedOn?.matrixSha256 ?? null]))
}

export function contentTableFingerprint(table: unknown = m1Table): string {
  return fingerprintText(JSON.stringify(table))
}
