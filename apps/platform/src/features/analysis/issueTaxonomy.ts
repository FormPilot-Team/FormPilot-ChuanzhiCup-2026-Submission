import { KNEE_RAISE_V1 } from '../exercises/kneeRaise/config'
import { LATERAL_RAISE_V1 } from '../exercises/lateralRaise/config'
import { OVERHEAD_RAISE_V1 } from '../exercises/overheadRaise/config'
import { SQUAT_V1 } from '../exercises/squat/config'
import { STEP_JACK_V1 } from '../exercises/stepJack/config'
import type { MotionErrorCode } from '../exercises/types'
import { seconds } from './copy'
import type {
  AnalysisHighlightRegion, CapabilityDimension, IssueSide, IssueThemeId, NonReportableIssueDefinition,
  ReportIssueDefinition, ScoredExerciseId,
} from './types'

interface DefinitionInput {
  exerciseId: ScoredExerciseId
  issue: string
  side?: IssueSide
  runtimeCodes: MotionErrorCode[]
  bodyRegion: AnalysisHighlightRegion
  dimension: CapabilityDimension
  reportLabel: string
  cue: string
  weight: 1 | 2 | 3
  themeId?: IssueThemeId
  evidenceSource?: 'rep' | 'derived'
  sideModel?: ReportIssueDefinition['sideModel']
}

function define(input: DefinitionInput): ReportIssueDefinition {
  const groupId = `${input.exerciseId}.${input.issue}`
  return Object.freeze({
    canonicalId: input.side ? `${groupId}.${input.side}` : groupId,
    exerciseId: input.exerciseId,
    runtimeCodes: Object.freeze([...input.runtimeCodes]) as MotionErrorCode[],
    bodyRegion: input.bodyRegion,
    dimension: input.dimension,
    reportLabel: input.reportLabel,
    cue: input.cue,
    reportable: true,
    trendable: true,
    evidenceSource: input.evidenceSource ?? 'rep',
    groupId,
    side: input.side ?? null,
    themeId: input.themeId ?? null,
    technicalPriorityWeight: input.weight,
    sideModel: input.sideModel ?? (input.side ? 'SIDE_SPECIFIC' : 'NONE'),
  })
}

function sided(
  input: Omit<DefinitionInput, 'side' | 'runtimeCodes' | 'bodyRegion' | 'reportLabel' | 'cue'>,
  bySide: Record<IssueSide, Pick<DefinitionInput, 'runtimeCodes' | 'bodyRegion' | 'reportLabel' | 'cue'>>,
): ReportIssueDefinition[] {
  return (['left', 'right'] as const).map((side) => define({ ...input, side, ...bySide[side] }))
}

function tempoRange(config: { repDurationMinMs: number; repDurationMaxMs: number }): string {
  return `${seconds(config.repDurationMinMs)}–${seconds(config.repDurationMaxMs)}`
}

const OVERHEAD_TEMPO = tempoRange(OVERHEAD_RAISE_V1)
const LATERAL_TEMPO = tempoRange(LATERAL_RAISE_V1)
const STEP_TEMPO = tempoRange(STEP_JACK_V1)
const SQUAT_TEMPO = tempoRange(SQUAT_V1)
const KNEE_TEMPO = tempoRange(KNEE_RAISE_V1)

/**
 * Frozen analysis-v1 report whitelist (8F-1A §6-A): 32 reportable entries after left/right expansion.
 * Pose-quality codes and every shoulder-rotation code are deliberately absent.
 */
export const REPORT_ISSUE_TAXONOMY: readonly ReportIssueDefinition[] = Object.freeze([
  define({ exerciseId: 'overhead_raise', issue: 'arm_height', runtimeCodes: ['ARMS_TOO_LOW'], bodyRegion: 'both_arms', dimension: 'AMPLITUDE',
    reportLabel: '双臂上举高度不足', cue: '双臂继续向上，举到头顶正上方', weight: 2 }),
  ...sided({ exerciseId: 'overhead_raise', issue: 'elbow_extension', dimension: 'FORM', weight: 2, themeId: 'ELBOW_EXTENSION' }, {
    left: { runtimeCodes: ['ELBOW_TOO_BENT_L'], bodyRegion: 'left_elbow', reportLabel: '举到顶部时左肘未伸直', cue: '举到头顶时把左肘伸直' },
    right: { runtimeCodes: ['ELBOW_TOO_BENT_R'], bodyRegion: 'right_elbow', reportLabel: '举到顶部时右肘未伸直', cue: '举到头顶时把右肘伸直' },
  }),
  define({ exerciseId: 'overhead_raise', issue: 'arm_symmetry', runtimeCodes: ['ASYMMETRY'], bodyRegion: 'both_arms', dimension: 'COORDINATION',
    reportLabel: '双臂高度不一致', cue: '两臂同时上举，保持同一高度', weight: 2, themeId: 'ARM_SYMMETRY' }),
  define({ exerciseId: 'overhead_raise', issue: 'torso_lean', runtimeCodes: ['TORSO_LEAN'], bodyRegion: 'core', dimension: 'STABILITY',
    reportLabel: '上举时躯干倾斜', cue: '收紧核心，上举时躯干保持直立', weight: 2, themeId: 'TORSO_STABILITY' }),
  define({ exerciseId: 'overhead_raise', issue: 'too_fast', runtimeCodes: ['TOO_FAST'], bodyRegion: 'both_arms', dimension: 'TEMPO',
    reportLabel: '动作节奏偏快', cue: `放慢速度，每次上举加下放用 ${OVERHEAD_TEMPO} 秒`, weight: 1, themeId: 'TEMPO_TOO_FAST' }),

  ...sided({ exerciseId: 'lateral_raise', issue: 'arm_height', dimension: 'AMPLITUDE', weight: 2 }, {
    left: { runtimeCodes: ['ARM_TOO_LOW_L'], bodyRegion: 'left_arm', reportLabel: '左臂抬高不足', cue: '把左臂抬到与肩同高' },
    right: { runtimeCodes: ['ARM_TOO_LOW_R'], bodyRegion: 'right_arm', reportLabel: '右臂抬高不足', cue: '把右臂抬到与肩同高' },
  }),
  ...sided({ exerciseId: 'lateral_raise', issue: 'elbow_extension', dimension: 'FORM', weight: 2, themeId: 'ELBOW_EXTENSION' }, {
    left: { runtimeCodes: ['ELBOW_TOO_BENT_L'], bodyRegion: 'left_elbow', reportLabel: '左肘弯曲较多', cue: '抬臂过程中左臂保持伸直，手肘只微弯' },
    right: { runtimeCodes: ['ELBOW_TOO_BENT_R'], bodyRegion: 'right_elbow', reportLabel: '右肘弯曲较多', cue: '抬臂过程中右臂保持伸直，手肘只微弯' },
  }),
  define({ exerciseId: 'lateral_raise', issue: 'arm_symmetry', runtimeCodes: ['ASYMMETRY'], bodyRegion: 'both_arms', dimension: 'COORDINATION',
    reportLabel: '双臂高度不一致', cue: '两臂同时抬起，到顶时保持同一高度', weight: 2, themeId: 'ARM_SYMMETRY' }),
  define({ exerciseId: 'lateral_raise', issue: 'torso_lean', runtimeCodes: ['TORSO_LEAN'], bodyRegion: 'core', dimension: 'STABILITY',
    reportLabel: '抬臂时身体侧倾', cue: '身体保持直立，不要侧倾借力', weight: 2, themeId: 'TORSO_STABILITY' }),
  define({ exerciseId: 'lateral_raise', issue: 'too_fast', runtimeCodes: ['TOO_FAST'], bodyRegion: 'both_arms', dimension: 'TEMPO',
    reportLabel: '动作节奏偏快', cue: `放慢速度，每次抬起加放下用 ${LATERAL_TEMPO} 秒`, weight: 1, themeId: 'TEMPO_TOO_FAST' }),

  define({ exerciseId: 'step_jack', issue: 'step_width', runtimeCodes: ['STEP_TOO_SMALL'], bodyRegion: 'full_body', dimension: 'AMPLITUDE',
    reportLabel: '侧步幅度不足', cue: '侧步迈得更开，双脚明显宽于髋部', weight: 2, sideModel: 'REP_SIDE_BREAKDOWN' }),
  define({ exerciseId: 'step_jack', issue: 'arm_height', runtimeCodes: ['ARM_TOO_LOW'], bodyRegion: 'both_arms', dimension: 'AMPLITUDE',
    reportLabel: '开步时手臂抬高不足', cue: '开步时双臂向上举成 V 字', weight: 2 }),
  define({ exerciseId: 'step_jack', issue: 'limb_sync', runtimeCodes: ['ARM_LEG_UNSYNCED'], bodyRegion: 'full_body', dimension: 'COORDINATION',
    reportLabel: '手脚打开不同步', cue: '迈步和举臂同时开始、同时到位', weight: 1, evidenceSource: 'derived' }),
  define({ exerciseId: 'step_jack', issue: 'arm_symmetry', runtimeCodes: ['ARM_LEG_UNSYNCED'], bodyRegion: 'both_arms', dimension: 'COORDINATION',
    reportLabel: '双臂打开不一致', cue: '两臂同时举起，保持同一高度', weight: 2, themeId: 'ARM_SYMMETRY' }),
  define({ exerciseId: 'step_jack', issue: 'alternation', runtimeCodes: ['WRONG_SIDE_SEQUENCE'], bodyRegion: 'full_body', dimension: 'FORM',
    reportLabel: '左右顺序不交替', cue: '按左、右、左、右交替侧步', weight: 1, themeId: 'ALTERNATION' }),
  define({ exerciseId: 'step_jack', issue: 'body_sway', runtimeCodes: ['BODY_SWAY'], bodyRegion: 'core', dimension: 'STABILITY',
    reportLabel: '侧步时身体晃动', cue: '收紧核心，侧步时上身保持居中', weight: 2, themeId: 'TORSO_STABILITY' }),
  define({ exerciseId: 'step_jack', issue: 'too_fast', runtimeCodes: ['TOO_FAST'], bodyRegion: 'full_body', dimension: 'TEMPO',
    reportLabel: '动作节奏偏快', cue: `放慢节奏，每次开合用 ${STEP_TEMPO} 秒`, weight: 1, themeId: 'TEMPO_TOO_FAST' }),

  define({ exerciseId: 'squat', issue: 'depth', runtimeCodes: ['DEPTH_INSUFFICIENT'], bodyRegion: 'hip_depth', dimension: 'AMPLITUDE',
    reportLabel: '下蹲深度不足', cue: '臀部向后向下坐，蹲得再低一些', weight: 2 }),
  define({ exerciseId: 'squat', issue: 'knee_alignment', runtimeCodes: ['KNEE_VALGUS'], bodyRegion: 'knees', dimension: 'FORM',
    reportLabel: '下蹲时膝盖内扣', cue: '下蹲时膝盖对准脚尖方向，不要向内夹', weight: 3 }),
  define({ exerciseId: 'squat', issue: 'lateral_balance', runtimeCodes: ['LEFT_RIGHT_ASYMMETRY'], bodyRegion: 'knees', dimension: 'COORDINATION',
    reportLabel: '下蹲时左右不均衡', cue: '两侧均匀用力，重心保持在两脚中间', weight: 2 }),
  define({ exerciseId: 'squat', issue: 'torso_lean', runtimeCodes: ['TORSO_LATERAL_LEAN'], bodyRegion: 'core', dimension: 'STABILITY',
    reportLabel: '下蹲时身体侧倾', cue: '下蹲和起身时躯干保持居中，不向一侧倾斜', weight: 3, themeId: 'TORSO_STABILITY' }),
  define({ exerciseId: 'squat', issue: 'too_fast', runtimeCodes: ['TOO_FAST'], bodyRegion: 'full_body', dimension: 'TEMPO',
    reportLabel: '动作节奏偏快', cue: `放慢速度，每次下蹲加起身用 ${SQUAT_TEMPO} 秒`, weight: 1, themeId: 'TEMPO_TOO_FAST' }),

  ...sided({ exerciseId: 'knee_raise', issue: 'knee_height', dimension: 'AMPLITUDE', weight: 2 }, {
    left: { runtimeCodes: ['KNEE_TOO_LOW_L'], bodyRegion: 'left_knee', reportLabel: '左膝抬高不足', cue: '把左膝抬到接近髋部高度' },
    right: { runtimeCodes: ['KNEE_TOO_LOW_R'], bodyRegion: 'right_knee', reportLabel: '右膝抬高不足', cue: '把右膝抬到接近髋部高度' },
  }),
  define({ exerciseId: 'knee_raise', issue: 'height_gap', runtimeCodes: ['LEFT_RIGHT_HEIGHT_GAP'], bodyRegion: 'knees', dimension: 'COORDINATION',
    reportLabel: '左右提膝高度差较大', cue: '两侧膝盖抬到相近高度', weight: 2, evidenceSource: 'derived' }),
  define({ exerciseId: 'knee_raise', issue: 'body_sway', runtimeCodes: ['BODY_SWAY'], bodyRegion: 'core', dimension: 'STABILITY',
    reportLabel: '提膝时身体晃动', cue: '支撑腿站稳，上身保持居中不晃动', weight: 2, themeId: 'TORSO_STABILITY' }),
  define({ exerciseId: 'knee_raise', issue: 'alternation', runtimeCodes: ['WRONG_SIDE_SEQUENCE'], bodyRegion: 'full_body', dimension: 'FORM',
    reportLabel: '左右顺序不交替', cue: '按左、右、左、右交替提膝', weight: 1, themeId: 'ALTERNATION' }),
  define({ exerciseId: 'knee_raise', issue: 'return_to_center', runtimeCodes: ['INCOMPLETE_RETURN'], bodyRegion: 'full_body', dimension: 'FORM',
    reportLabel: '未回到站立位就换腿', cue: '放下后先回到站立位，再抬另一侧', weight: 1 }),
  define({ exerciseId: 'knee_raise', issue: 'too_fast', runtimeCodes: ['TOO_FAST'], bodyRegion: 'full_body', dimension: 'TEMPO',
    reportLabel: '动作节奏偏快', cue: `放慢节奏，每次提膝加放下用 ${KNEE_TEMPO} 秒`, weight: 1, themeId: 'TEMPO_TOO_FAST' }),
])

/** 8F-1A §6-B: codes kept only so every runtime code is accounted for. They never produce issues or denominators. */
export const NON_REPORTABLE_ISSUES: readonly NonReportableIssueDefinition[] = Object.freeze(([
  { canonicalId: 'overhead_raise.incomplete_attempt', exerciseId: 'overhead_raise', runtimeCodes: ['INCOMPLETE_REP'], reason: 'Timed-out attempts never produce a repetition, so there is no denominator.' },
  { canonicalId: 'lateral_raise.slow_rep', exerciseId: 'lateral_raise', runtimeCodes: ['INCOMPLETE_REP'], reason: 'On a completed rep this only means durationMs ≥ incompleteTimeoutMs; covered by the tempo direction.' },
  { canonicalId: 'squat.slow_rep', exerciseId: 'squat', runtimeCodes: ['INCOMPLETE_REP'], reason: 'On a completed rep this only means durationMs ≥ incompleteTimeoutMs; covered by the tempo direction.' },
  { canonicalId: 'step_jack.slow_return', exerciseId: 'step_jack', runtimeCodes: ['INCOMPLETE_RETURN'], reason: 'Equivalent to durationMs > incompleteReturnTimeoutMs; it cannot prove the user did not return to center.' },
  { canonicalId: 'shoulder_rotation.motion_small', exerciseId: 'shoulder_rotation', runtimeCodes: ['MOTION_TOO_SMALL'], reason: 'Guidance exercise.' },
  { canonicalId: 'shoulder_rotation.arms_unsynced', exerciseId: 'shoulder_rotation', runtimeCodes: ['ARMS_UNSYNCED'], reason: 'Guidance exercise.' },
  { canonicalId: 'shoulder_rotation.motion_paused', exerciseId: 'shoulder_rotation', runtimeCodes: ['MOTION_PAUSED'], reason: 'Guidance exercise.' },
  { canonicalId: 'shoulder_rotation.torso_lean', exerciseId: 'shoulder_rotation', runtimeCodes: ['TORSO_LEAN'], reason: 'Guidance exercise.' },
] as const).map((item) => Object.freeze({
  ...item,
  runtimeCodes: [...item.runtimeCodes] as MotionErrorCode[],
  reportable: false as const,
  trendable: false as const,
  evidenceSource: 'reminder' as const,
})))

const BY_ID = new Map(REPORT_ISSUE_TAXONOMY.map((item) => [item.canonicalId, item]))

export function issueDefinition(canonicalId: string): ReportIssueDefinition | null {
  return BY_ID.get(canonicalId) ?? null
}

export function definitionsFor(exerciseId: ScoredExerciseId): ReportIssueDefinition[] {
  return REPORT_ISSUE_TAXONOMY.filter((item) => item.exerciseId === exerciseId)
}

const TEMPO_CONFIG: Record<ScoredExerciseId, { repDurationMinMs: number; repDurationMaxMs: number }> = {
  overhead_raise: OVERHEAD_RAISE_V1,
  lateral_raise: LATERAL_RAISE_V1,
  step_jack: STEP_JACK_V1,
  squat: SQUAT_V1,
  knee_raise: KNEE_RAISE_V1,
}

export function tempoBandMs(exerciseId: ScoredExerciseId): [number, number] {
  const config = TEMPO_CONFIG[exerciseId]
  return [config.repDurationMinMs, config.repDurationMaxMs]
}

const TEMPO_MOTION: Record<ScoredExerciseId, string> = {
  overhead_raise: '每次上举加下放',
  lateral_raise: '每次抬起加放下',
  step_jack: '每次开合',
  squat: '每次下蹲加起身',
  knee_raise: '每次提膝加放下',
}

/** Cue for a slow tempo direction (weak TEMPO capability fallback). The fast cue lives on the too_fast entry. */
export function tooSlowCue(exerciseId: ScoredExerciseId): string {
  return `动作不要拖太久，${TEMPO_MOTION[exerciseId]}用 ${tempoRange(TEMPO_CONFIG[exerciseId])} 秒`
}

export function tempoRangeText(exerciseId: ScoredExerciseId): string {
  return tempoRange(TEMPO_CONFIG[exerciseId])
}
