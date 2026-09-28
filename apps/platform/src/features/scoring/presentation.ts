import { getScoringSource, sourceCitation } from './sources'
import type { EvaluationCriterion, EvidenceLevel, Observability, ScoringRole, SourceType } from './types'

/** Internal / document labels. The product UI names sources, not letters. */
export const SOURCE_TYPE_LABEL: Readonly<Record<SourceType, string>> = Object.freeze({
  OFFICIAL_STANDARD: '国家 / 团体标准',
  OFFICIAL_GUIDANCE: '官方动作规范与科学健身指导',
  COMPETITION_RULE: '竞赛规则',
  ACADEMIC_EVIDENCE: '学术研究',
  FORMPILOT_CALIBRATED: 'FormPilot 标定',
})

export const EVIDENCE_LEVEL_LABEL: Readonly<Record<EvidenceLevel, string>> = Object.freeze({
  A: 'A · 官方标准 / 官方动作规范直接支持',
  B: 'B · 同行评议研究 / 教材 / 官方一般性原则',
  C: 'C · FormPilot 标准示范与工程标定',
})

export const OBSERVABILITY_LABEL: Readonly<Record<Observability, string>> = Object.freeze({
  OBSERVABLE: '二维姿态可直接测量',
  PROXY: '二维姿态间接估计',
  NOT_OBSERVABLE: '需要人工观察',
})

export const SCORING_ROLE_LABEL: Readonly<Record<ScoringRole, string>> = Object.freeze({
  SCORED: '计入动作规范评价',
  ADVISORY: '只作提示，不计分',
  REFERENCE_ONLY: '规范参考，不进入视觉评分',
})

/**
 * The two-part basis line the report shows under a deduction: where the movement requirement comes from, and that
 * the number is FormPilot's own calibration. Never merges the two.
 */
export function criterionBasisText(criterion: EvaluationCriterion): { requirement: string; threshold: string | null } {
  const source = getScoringSource(criterion.sourceId)
  const requirement = source.type === 'FORMPILOT_CALIBRATED'
    ? '动作要求依据 FormPilot 标准示范与运动学原则（暂无直接的官方动作标准）'
    : `动作要求依据${sourceCitation(source)}`
  const threshold = criterion.thresholdSource === 'FORMPILOT_CALIBRATED'
    ? criterion.mode === 'warm-up'
      ? '数值阈值为 FormPilot 工程标定（真人测试修正），不是官方规定的数值'
      : '数值阈值由 FormPilot 按标准示范实测值标定，不是官方规定的数值'
    : null
  return { requirement, threshold }
}
