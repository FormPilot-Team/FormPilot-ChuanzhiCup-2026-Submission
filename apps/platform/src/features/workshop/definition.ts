import { BODY_AREAS, CALIBRATED_THRESHOLDS, GOAL_LIMITS, REQUIREMENT_ORDER, REQUIREMENTS } from './catalog'
import { FEATURE_TEMPLATES, templateProgressThresholds } from './recognition/templates'
import {
  CUSTOM_ACTION_SCHEMA_VERSION, type CapturedLandmark, type CapturedPose, type CustomActionBodyArea, type CustomActionDefinition,
  type CustomActionGoal, type CustomActionSourceKind, type CustomActionTestStatus, type FeatureTemplateId, type PhaseThresholds,
  type PoseStep, type RecognitionProfile, type RequirementId, type RequirementSetting, type SignalSource,
} from './types'

export const NAME_MAX = 20
export const DESCRIPTION_MAX = 80
export const POSE_DESCRIPTION_MAX = 40

export function createActionId(now = Date.now(), random = Math.random): string {
  return `custom-${now.toString(36)}-${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`
}

export function defaultRequirements(area: CustomActionBodyArea): RequirementSetting[] {
  const enabled = new Set(BODY_AREAS[area].requirements)
  return REQUIREMENT_ORDER.map((id) => ({ id, enabled: id === 'full-return' || enabled.has(id) }))
}

/** A new, empty action as the 创建动作 step starts it. */
export function createDraftAction(now = new Date(), id = createActionId(now.getTime())): CustomActionDefinition {
  const iso = now.toISOString()
  return {
    schemaVersion: CUSTOM_ACTION_SCHEMA_VERSION,
    id,
    name: '',
    description: '',
    bodyArea: 'upper',
    goal: { type: 'reps', target: GOAL_LIMITS.reps.defaultValue },
    startPose: { description: '' },
    finishPose: { description: '' },
    requirements: defaultRequirements('upper'),
    recognition: { source: 'pose-match', profile: BODY_AREAS.upper.profile, thresholds: { ...CALIBRATED_THRESHOLDS }, minRepMs: 400, holdSeconds: 2 },
    test: { status: 'not-tested' },
    source: { kind: 'workshop' },
    createdAt: iso,
    updatedAt: iso,
  }
}

/** Changing the body area re-suggests its requirements and camera region, keeping what the user set manually. */
export function withBodyArea(action: CustomActionDefinition, area: CustomActionBodyArea): CustomActionDefinition {
  return { ...action, bodyArea: area, requirements: defaultRequirements(area), recognition: { ...action.recognition, profile: BODY_AREAS[area].profile } }
}

/** Switching the signal source resets thresholds to that source's defaults (calibrated vs. template units). */
export function withSignalSource(action: CustomActionDefinition, source: SignalSource): CustomActionDefinition {
  const thresholds = source === 'pose-match' ? { ...CALIBRATED_THRESHOLDS } : defaultThresholdsFor(source, action.recognition.profile, Boolean(action.startPose.capture && action.finishPose.capture))
  return { ...action, recognition: { ...action.recognition, source, thresholds }, test: { status: 'not-tested' } }
}

export function defaultThresholdsFor(template: FeatureTemplateId, profile: RecognitionProfile, calibrated: boolean): PhaseThresholds {
  return calibrated && (FEATURE_TEMPLATES[template].counting === 'pulse' || FEATURE_TEMPLATES[template].counting === 'hold')
    ? { ...CALIBRATED_THRESHOLDS }
    : templateProgressThresholds(template, profile)
}

export function goalText(goal: CustomActionGoal): string {
  return goal.type === 'reps' ? `${goal.target} 次` : `保持 ${goal.seconds} 秒`
}

export function isRecognitionReady(action: CustomActionDefinition): boolean {
  if (action.recognition.source === 'pose-match') return Boolean(action.startPose.capture && action.finishPose.capture)
  return true
}

// ---- validation ------------------------------------------------------------------------------------------------------

export class CustomActionValidationError extends Error {}

const BODY_AREA_SET = new Set<CustomActionBodyArea>(['upper', 'lower', 'full', 'core'])
const PROFILE_SET = new Set<RecognitionProfile>(['upper-body', 'hip-lateral', 'hip-rotation', 'lower-body', 'full-body', 'mixed'])
const SOURCE_SET = new Set<SignalSource>(['pose-match', ...Object.keys(FEATURE_TEMPLATES) as FeatureTemplateId[]])
const TEST_SET = new Set<CustomActionTestStatus>(['not-tested', 'passed', 'needs-adjustment'])
const SOURCE_KIND_SET = new Set<CustomActionSourceKind>(['workshop', 'imported-file', 'legacy-library'])

function fail(message: string): never {
  throw new CustomActionValidationError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) fail(`${field}不能为空`)
    return ''
  }
  if (typeof value !== 'string') fail(`${field}必须是文字`)
  const trimmed = value.trim()
  if (required && !trimmed) fail(`${field}不能为空`)
  if (trimmed.length > max) fail(`${field}最多 ${max} 个字`)
  return trimmed
}

function finite(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${field}超出范围`)
  return value
}

function isoDate(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback
}

function capturedPose(value: unknown, field: string): CapturedPose | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value) || !Array.isArray(value.landmarks)) fail(`${field}格式不正确`)
  if (value.landmarks.length !== 33) fail(`${field}需要 33 个关键点`)
  const landmarks: CapturedLandmark[] = value.landmarks.map((point, index) => {
    if (!isRecord(point)) fail(`${field}第 ${index + 1} 个关键点格式不正确`)
    return {
      x: finite(point.x, `${field}坐标`, -1, 2),
      y: finite(point.y, `${field}坐标`, -1, 2),
      z: typeof point.z === 'number' && Number.isFinite(point.z) ? point.z : 0,
      visibility: finite(point.visibility, `${field}可见度`, 0, 1),
    }
  })
  return {
    landmarks,
    aspect: finite(value.aspect, `${field}画面比例`, 0.2, 5),
    frames: Math.round(finite(value.frames ?? 1, `${field}帧数`, 1, 10_000)),
    capturedAt: isoDate(value.capturedAt, new Date(0).toISOString()),
  }
}

function poseStep(value: unknown, field: string): PoseStep {
  if (!isRecord(value)) return { description: '' }
  const capture = capturedPose(value.capture, field)
  return { description: text(value.description, `${field}说明`, POSE_DESCRIPTION_MAX), ...(capture ? { capture } : {}) }
}

function goal(value: unknown): CustomActionGoal {
  if (!isRecord(value)) fail('计数方式格式不正确')
  if (value.type === 'reps') return { type: 'reps', target: Math.round(finite(value.target, '目标次数', GOAL_LIMITS.reps.min, GOAL_LIMITS.reps.max)) }
  if (value.type === 'duration') return { type: 'duration', seconds: Math.round(finite(value.seconds, '目标时间', GOAL_LIMITS.duration.min, GOAL_LIMITS.duration.max)) }
  return fail('计数方式只能是按次数或按时间')
}

function requirements(value: unknown, area: CustomActionBodyArea): RequirementSetting[] {
  if (!Array.isArray(value)) return defaultRequirements(area)
  const byId = new Map<RequirementId, RequirementSetting>()
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || !(item.id in REQUIREMENTS)) continue
    const id = item.id as RequirementId
    const limits = REQUIREMENTS[id].threshold
    const threshold = limits && typeof item.threshold === 'number' && Number.isFinite(item.threshold)
      ? Math.min(limits.max, Math.max(limits.min, item.threshold))
      : undefined
    byId.set(id, { id, enabled: id === 'full-return' ? true : Boolean(item.enabled), ...(threshold !== undefined ? { threshold } : {}) })
  }
  return REQUIREMENT_ORDER.map((id) => byId.get(id) ?? { id, enabled: id === 'full-return' })
}

function thresholds(value: unknown): PhaseThresholds {
  if (!isRecord(value)) fail('识别阈值格式不正确')
  const moving = finite(value.moving, '开始动作阈值', 0.01, 2)
  const peak = finite(value.peak, '到位阈值', 0.02, 2)
  const returnThreshold = finite(value.returnThreshold, '回到起始阈值', 0, 2)
  if (!(returnThreshold <= moving && moving < peak)) fail('阈值需要满足：回到起始 ≤ 开始动作 < 到位')
  return { moving, peak, returnThreshold }
}

/** Validates and normalises one stored or imported action. Throws CustomActionValidationError with user-facing text. */
export function normalizeCustomAction(raw: unknown): CustomActionDefinition {
  if (!isRecord(raw)) fail('动作数据格式不正确')
  if (raw.schemaVersion !== CUSTOM_ACTION_SCHEMA_VERSION) fail('动作数据版本不受支持')
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9:_-]{1,80}$/.test(raw.id)) fail('动作编号格式不正确')
  const bodyArea = BODY_AREA_SET.has(raw.bodyArea as CustomActionBodyArea) ? raw.bodyArea as CustomActionBodyArea : fail('训练部位不正确')
  const recognition = isRecord(raw.recognition) ? raw.recognition : fail('识别设置缺失')
  const source = SOURCE_SET.has(recognition.source as SignalSource) ? recognition.source as SignalSource : fail('识别方式不正确')
  const profile = PROFILE_SET.has(recognition.profile as RecognitionProfile) ? recognition.profile as RecognitionProfile : fail('身体区域不正确')
  const test = isRecord(raw.test) && TEST_SET.has(raw.test.status as CustomActionTestStatus) ? raw.test : { status: 'not-tested' }
  const sourceInfo = isRecord(raw.source) && SOURCE_KIND_SET.has(raw.source.kind as CustomActionSourceKind) ? raw.source : { kind: 'workshop' }
  const now = new Date().toISOString()
  return {
    schemaVersion: CUSTOM_ACTION_SCHEMA_VERSION,
    id: raw.id,
    name: text(raw.name, '动作名称', NAME_MAX, true),
    description: text(raw.description, '动作描述', DESCRIPTION_MAX),
    bodyArea,
    goal: goal(raw.goal),
    startPose: poseStep(raw.startPose, '开始姿势'),
    finishPose: poseStep(raw.finishPose, '完成姿势'),
    requirements: requirements(raw.requirements, bodyArea),
    recognition: {
      source,
      profile,
      thresholds: thresholds(recognition.thresholds),
      minRepMs: Math.round(finite(recognition.minRepMs ?? 400, '单次最短时间', 0, 10_000)),
      holdSeconds: finite(recognition.holdSeconds ?? 2, '保持时间', 0.5, 30),
    },
    test: {
      status: test.status as CustomActionTestStatus,
      ...(typeof test.testedAt === 'string' ? { testedAt: isoDate(test.testedAt, now) } : {}),
      ...(typeof test.repsDetected === 'number' && Number.isFinite(test.repsDetected) ? { repsDetected: Math.max(0, Math.round(test.repsDetected)) } : {}),
      ...(typeof test.repsPassed === 'number' && Number.isFinite(test.repsPassed) ? { repsPassed: Math.max(0, Math.round(test.repsPassed)) } : {}),
    },
    source: {
      kind: sourceInfo.kind as CustomActionSourceKind,
      ...(typeof sourceInfo.legacyId === 'string' ? { legacyId: sourceInfo.legacyId.slice(0, 240) } : {}),
      ...(typeof sourceInfo.importedAt === 'string' ? { importedAt: isoDate(sourceInfo.importedAt, now) } : {}),
    },
    createdAt: isoDate(raw.createdAt, now),
    updatedAt: isoDate(raw.updatedAt, now),
  }
}

/** Problems that block saving, in user language (empty = can save). Recognition readiness is checked separately. */
export function validateForSave(action: CustomActionDefinition): string[] {
  const problems: string[] = []
  if (!action.name.trim()) problems.push('请填写动作名称')
  if (action.name.trim().length > NAME_MAX) problems.push(`动作名称最多 ${NAME_MAX} 个字`)
  if (action.description.length > DESCRIPTION_MAX) problems.push(`动作描述最多 ${DESCRIPTION_MAX} 个字`)
  if (!isRecognitionReady(action)) problems.push('请记录开始姿势和完成姿势，FormPilot 才能识别这个动作')
  if (action.goal.type === 'duration' && action.recognition.source !== 'pose-match' && ['orbit', 'alternate'].includes(FEATURE_TEMPLATES[action.recognition.source].counting)) {
    problems.push('这个动作模板按完整次数识别；请改为按次数，或选择可保持的识别方式。')
  }
  try {
    normalizeCustomAction({ ...action, name: action.name || '未命名' })
  } catch (error) {
    if (error instanceof CustomActionValidationError) problems.push(error.message)
    else throw error
  }
  return [...new Set(problems)]
}
