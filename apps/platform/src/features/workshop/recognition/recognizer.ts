import { normalizePoseFrame, type NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import type { LandmarkName, PoseLandmark } from '../../pose/types'
import { PROFILE_OPTIONS, REQUIREMENTS } from '../catalog'
import type { CapturedPose, CustomActionDefinition, FeatureTemplateId, PhaseThresholds, RequirementId } from '../types'
import { isFinitePoint, isUsable, landmark } from './geometry'
import { bodyCoords, buildPoseMatch, readPoseMatch, type PoseMatchIssue, type PoseMatchModel } from './poseMatch'
import { effectiveRequirements, evaluateRequirement, measureRequirements, type EffectiveRequirement, type RequirementMeasures } from './requirements'
import { FEATURE_TEMPLATES, PROFILE_BOUNDS, templateSignalThresholds, type TemplateCounting } from './templates'
import { templateSignal } from './templateSignal'

// 自定义动作识别：纯函数、按帧驱动，工坊测试、训练页和单测共用同一份代码

export type RecognizerMode = 'pose-match' | 'template-calibrated' | 'template'
export type RecognizerPhase = 'READY' | 'MOVING' | 'PEAK' | 'RETURNING' | 'HOLDING'
export type RecognizerQuality = 'good' | 'degraded' | 'lost'

export interface RequirementResult {
  id: RequirementId
  /** null：所需部位不可见 */
  passed: boolean | null
}

export interface RepEvent {
  index: number
  durationMs: number
  peakProgress: number
  requirements: RequirementResult[]
  failed: RequirementId[]
  passed: boolean
}

export interface RecognizerFeedback {
  code: string
  message: string
  tone: 'info' | 'success' | 'warning'
}

export interface RecognizerSnapshot {
  quality: RecognizerQuality
  phase: RecognizerPhase
  /** 0 = 起始姿势，1 = 结束姿势（模板模式为峰值）；无法判断时为 null */
  progress: number | null
  reps: number
  passedReps: number
  holdMs: number
  /** 只在完成一次（或保持满一秒）的那一帧出现 */
  repEvent?: RepEvent
  lastRep?: RepEvent
  feedback: RecognizerFeedback | null
  framingHint?: string
  metrics: Record<string, number>
}

export interface RecognitionSetup {
  mode: RecognizerMode
  counting: TemplateCounting
  ready: boolean
  issue?: string
  template: FeatureTemplateId | null
  model?: PoseMatchModel
  calibration?: { start: number; finish: number }
  thresholds: PhaseThresholds
  requirements: EffectiveRequirement[]
  /** 必须可见且在画面内的关键点 */
  bounds: LandmarkName[]
  framingLabel: string
}

/** A workshop test passes only when complete repetitions also satisfy every visible requirement. */
export function workshopTestPasses(snapshot: Pick<RecognizerSnapshot, 'reps' | 'passedReps' | 'holdMs'>, goal: CustomActionDefinition['goal']): boolean {
  return goal.type === 'duration' ? snapshot.holdMs >= 3000 && snapshot.passedReps >= 3 : snapshot.passedReps >= Math.min(3, goal.target)
}

const POSE_MATCH_ISSUE: Readonly<Record<PoseMatchIssue, string>> = {
  'not-captured': '请先记录开始姿势和完成姿势。',
  'missing-body': '记录的姿势没有看清肩膀和髋部，请重新记录。',
  'too-similar': '开始姿势和完成姿势太接近，请把完成姿势做得更明显后重新记录。',
}

const TORSO_ANCHORS: ReadonlyArray<LandmarkName> = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip']

function capturedFrame(pose: CapturedPose): NormalizedPoseFrame | null {
  return normalizePoseFrame({ timestamp: 0, landmarks: pose.landmarks.map((point) => ({ ...point, presence: point.visibility })), confidence: 1 })
}

/** 根据信号来源和已录制的姿势决定测量方式 */
export function resolveRecognition(definition: CustomActionDefinition): RecognitionSetup {
  const { recognition, startPose, finishPose } = definition
  const requirements = effectiveRequirements(definition)
  const framingLabel = PROFILE_OPTIONS[recognition.profile].framing
  const holdGoal = definition.goal.type === 'duration'
  const poseMatch = buildPoseMatch(startPose.capture, finishPose.capture)
  const usePoseMatch = recognition.source === 'pose-match' || (recognition.source === 'generic' && poseMatch.model)
  if (usePoseMatch) {
    const bounds = [...new Set([...TORSO_ANCHORS, ...(poseMatch.model?.joints.map((joint) => joint.name) ?? [])])]
    return {
      mode: 'pose-match',
      counting: holdGoal ? 'hold' : 'pulse',
      ready: Boolean(poseMatch.model),
      issue: poseMatch.issue ? POSE_MATCH_ISSUE[poseMatch.issue] : undefined,
      template: null,
      model: poseMatch.model,
      thresholds: recognition.thresholds,
      requirements,
      bounds,
      framingLabel,
    }
  }
  const templateId = recognition.source as FeatureTemplateId
  const template = FEATURE_TEMPLATES[templateId]
  if (holdGoal && (template.counting === 'orbit' || template.counting === 'alternate')) {
    return { mode: 'template', counting: template.counting, ready: false, issue: '这个动作模板按完整次数识别；请改为按次数，或选择可保持的识别方式。', template: templateId, thresholds: recognition.thresholds, requirements, bounds: [...template.bounds], framingLabel }
  }
  const counting: TemplateCounting = holdGoal && template.counting === 'pulse' ? 'hold' : template.counting
  const bounds = [...(templateId === 'generic' ? PROFILE_BOUNDS[recognition.profile] : template.bounds)]
  let calibration: RecognitionSetup['calibration']
  if ((counting === 'pulse' || counting === 'hold') && startPose.capture && finishPose.capture) {
    const start = capturedFrame(startPose.capture)
    const finish = capturedFrame(finishPose.capture)
    if (start && finish) {
      const a = templateSignal(start, recognition.profile, templateId).raw
      const b = templateSignal(finish, recognition.profile, templateId).raw
      if (Math.abs(b - a) >= 0.05) calibration = { start: a, finish: b }
    }
  }
  return {
    mode: calibration ? 'template-calibrated' : 'template',
    counting,
    ready: true,
    template: templateId,
    calibration,
    thresholds: recognition.thresholds,
    requirements,
    bounds,
    framingLabel,
  }
}

const FRAME_MARGIN = 0.02

/** 所需关键点是否可见且在画面内；不满足时返回提示 */
export function framingHintFor(landmarks: ReadonlyArray<PoseLandmark>, setup: Pick<RecognitionSetup, 'bounds' | 'framingLabel'>): string | undefined {
  let outVertically = false
  let outSideways = false
  let missing = false
  for (const name of setup.bounds) {
    const point = landmark(landmarks, name)
    if (!isFinitePoint(point) || point.visibility < 0.35) { missing = true; continue }
    if (point.y < FRAME_MARGIN || point.y > 1 - FRAME_MARGIN) outVertically = true
    if (point.x < FRAME_MARGIN || point.x > 1 - FRAME_MARGIN) outSideways = true
  }
  if (outSideways) return `请向画面中间移动一些，让${setup.framingLabel}完整入镜`
  if (outVertically || missing) return `请后退一些，让${setup.framingLabel}完整入镜`
  return undefined
}

const ORBIT_TRAVEL = 4.5
const MAX_PATH_DEVIATION = 0.45
const SHORT_OCCLUSION_MS = 150
const MAX_RESUME_PROGRESS_CHANGE = 0.3
const FLASH_MS = { success: 1600, warning: 2800 }

interface RepTracking {
  startedAt: number
  maxProgress: number
  peakMeasures: RequirementMeasures | null
  maxLean: number | null
}

export class CustomActionRecognizer {
  readonly setup: RecognitionSetup
  private phase: RecognizerPhase = 'READY'
  private reps = 0
  private passedReps = 0
  private holdMs = 0
  private movingFrames = 0
  private startFrames = 0
  private returnFrames = 0
  private rep?: RepTracking
  private lastRep?: RepEvent
  private lastTimestamp?: number
  private lastGoodProgress?: number
  private occlusionAt?: number
  private flash?: { feedback: RecognizerFeedback; until: number }
  private neutralSignal?: number
  private neutralHipY?: number
  private orbit?: { left: number; right: number }
  private orbitTravel = 0
  private orbitDirection = 0
  private orbitSide?: 'left' | 'right'
  private side?: number
  private armed = true
  private holdStartedAt?: number
  private holdSecondsCounted = 0
  private holdSegmentMs = 0
  private lastHoldingAt?: number

  constructor(private readonly definition: CustomActionDefinition, private readonly recoverBriefOcclusion = true) {
    this.setup = resolveRecognition(definition)
  }

  reset(): void {
    this.phase = 'READY'
    this.reps = 0
    this.passedReps = 0
    this.holdMs = 0
    this.movingFrames = 0
    this.startFrames = 0
    this.returnFrames = 0
    this.rep = undefined
    this.lastRep = undefined
    this.lastTimestamp = undefined
    this.lastGoodProgress = undefined
    this.occlusionAt = undefined
    this.flash = undefined
    this.neutralSignal = undefined
    this.neutralHipY = undefined
    this.orbit = undefined
    this.orbitTravel = 0
    this.orbitDirection = 0
    this.orbitSide = undefined
    this.side = undefined
    this.armed = true
    this.holdStartedAt = undefined
    this.holdSecondsCounted = 0
    this.holdSegmentMs = 0
    this.lastHoldingAt = undefined
  }

  process(frame: NormalizedPoseFrame | null, timestamp: number, aspect: number): RecognizerSnapshot {
    const previousTimestamp = this.lastTimestamp
    this.lastTimestamp = timestamp
    if (!this.setup.ready) return this.snapshot('lost', null, {}, timestamp, undefined, { code: 'NOT_READY', message: this.setup.issue ?? '请先完成识别设置。', tone: 'info' })
    if (previousTimestamp !== undefined && timestamp - previousTimestamp > SHORT_OCCLUSION_MS && this.phase !== 'READY') {
      this.gap(timestamp, 'lost', '识别中断，请重新从开始姿势做一次')
    }
    if (!frame || !this.hasTorso(frame.landmarks)) return this.missing(timestamp, 'lost', '请回到画面中，让身体完整入镜')

    const framing = this.framingHint(frame.landmarks)
    const reading = this.read(frame, aspect)
    if (reading.progress === null || framing) {
      const offPath = this.setup.mode === 'pose-match' && (reading.metrics.deviation ?? -1) > MAX_PATH_DEVIATION
      const hint = framing ?? (offPath ? '动作轨迹与示范差别较大，请按示范路线完成' : `请让${this.setup.framingLabel}完整入镜`)
      return offPath ? this.gap(timestamp, 'degraded', hint, reading.metrics) : this.missing(timestamp, 'degraded', hint, reading.metrics)
    }

    if (this.occlusionAt !== undefined) {
      const discontinuous = timestamp - this.occlusionAt > SHORT_OCCLUSION_MS
        || this.lastGoodProgress === undefined || Math.abs(reading.progress - this.lastGoodProgress) > MAX_RESUME_PROGRESS_CHANGE
      this.occlusionAt = undefined
      if (discontinuous) return this.gap(timestamp, 'degraded', '遮挡期间动作位置变化过大，请重新从开始姿势做一次', reading.metrics)
    }
    this.lastGoodProgress = reading.progress

    const measures = measureRequirements(frame.landmarks, aspect)
    let repEvent: RepEvent | undefined
    switch (this.setup.counting) {
      case 'orbit': repEvent = this.countOrbit(reading.metrics, measures, timestamp); break
      case 'alternate': repEvent = this.countAlternate(reading.metrics, measures, timestamp); break
      case 'hold': repEvent = this.countHold(reading.progress, measures, timestamp); break
      default: repEvent = this.countPulse(reading.progress, measures, timestamp)
    }
    const progress = this.setup.counting === 'orbit' ? Math.min(1, this.orbitTravel / ORBIT_TRAVEL) : reading.progress
    return this.snapshot('good', progress, reading.metrics, timestamp, repEvent)
  }

  /** 姿势匹配需要双肩双髋；模板（侧平板、坐姿）各一侧即可 */
  private hasTorso(landmarks: ReadonlyArray<PoseLandmark>): boolean {
    const usable = (name: LandmarkName) => isUsable(landmark(landmarks, name))
    if (this.setup.mode === 'pose-match') return TORSO_ANCHORS.every(usable)
    return (usable('leftShoulder') || usable('rightShoulder')) && (usable('leftHip') || usable('rightHip'))
  }

  private framingHint(landmarks: ReadonlyArray<PoseLandmark>): string | undefined {
    return framingHintFor(landmarks, this.setup)
  }

  private read(frame: NormalizedPoseFrame, aspect: number): { progress: number | null; metrics: Record<string, number> } {
    if (this.setup.mode === 'pose-match' && this.setup.model) {
      const reading = readPoseMatch(this.setup.model, bodyCoords(frame.landmarks, aspect))
      return {
        progress: reading.deviation !== null && reading.deviation > MAX_PATH_DEVIATION ? null : reading.progress,
        metrics: { visibleShare: reading.visibleShare, deviation: reading.deviation ?? -1 },
      }
    }
    const templateId = this.setup.template as FeatureTemplateId
    const template = FEATURE_TEMPLATES[templateId]
    const signal = templateSignal(frame, this.definition.recognition.profile, templateId)
    const qualityOk = template.qualityGroups.every((group) => group.some((name) => isUsable(landmark(frame.landmarks, name))))
    const metrics = { ...signal.metrics, raw: signal.raw }
    if (!qualityOk) return { progress: null, metrics }
    if (this.setup.calibration) {
      const { start, finish } = this.setup.calibration
      return { progress: (signal.raw - start) / (finish - start), metrics }
    }
    // 未标定的模板以用户自己的准备姿势为基准，峰值阈值记为 100%；
    // 否则绝对模板在静止时可能已高于回落阈值，一次动作永远不会结束
    if (this.phase === 'READY') {
      if (this.neutralSignal === undefined) this.neutralSignal = signal.raw
      else if (Math.abs(signal.raw - this.neutralSignal) <= Math.min(template.baseline.range, 0.05)) this.neutralSignal = this.neutralSignal * 0.9 + signal.raw * 0.1
    }
    const neutral = this.neutralSignal ?? signal.raw
    let value = template.baseline.mode === 'difference'
      ? Math.min(1, Math.abs(signal.raw - neutral) / template.baseline.range)
      : Math.max(0, signal.raw - neutral)
    if (this.neutralHipY === undefined) this.neutralHipY = signal.hipMidY
    else if (this.phase === 'READY' && Math.abs(signal.hipMidY - this.neutralHipY) / signal.torsoLength <= 0.08) this.neutralHipY = this.neutralHipY * 0.9 + signal.hipMidY * 0.1
    const hipDrop = Math.min(1, Math.max(0, (signal.hipMidY - this.neutralHipY) / Math.max(signal.torsoLength * 0.45, 1e-6)))
    if (templateId === 'squat-depth' || templateId === 'lunge-single-leg') value = Math.max(value, hipDrop)
    if (templateId === 'generic') {
      const profile = this.definition.recognition.profile
      if (profile === 'lower-body') value = Math.max(value, hipDrop)
      if (profile === 'full-body' || profile === 'mixed') value = Math.max(value, Math.min(1, hipDrop * 0.7 + value * 0.3))
    }
    const peak = templateSignalThresholds(templateId, this.definition.recognition.profile).peak
    return { progress: value / peak, metrics: { ...metrics, signal: value, hipDrop } }
  }

  private track(progress: number, measures: RequirementMeasures, timestamp: number): void {
    this.rep ??= { startedAt: timestamp, maxProgress: -Infinity, peakMeasures: null, maxLean: null }
    if (progress >= this.rep.maxProgress) {
      this.rep.maxProgress = progress
      this.rep.peakMeasures = measures
    }
    if (measures.torsoLean !== null) this.rep.maxLean = Math.max(this.rep.maxLean ?? 0, measures.torsoLean)
  }

  private evaluate(): RequirementResult[] {
    const peak = this.rep?.peakMeasures
    return this.setup.requirements.map(({ id, threshold }) => {
      if (id === 'full-return') return { id, passed: true }
      if (!peak) return { id, passed: null }
      const measures = REQUIREMENTS[id].timing === 'throughout' ? { ...peak, torsoLean: this.rep?.maxLean ?? peak.torsoLean } : peak
      return { id, passed: evaluateRequirement(id, measures, threshold, this.definition.bodyArea) }
    })
  }

  private complete(timestamp: number): RepEvent {
    const requirements = this.evaluate()
    const failed = requirements.filter((item) => item.passed !== true).map((item) => item.id)
    this.reps += 1
    if (!failed.length) this.passedReps += 1
    const event: RepEvent = {
      index: this.reps,
      durationMs: Math.max(0, timestamp - (this.rep?.startedAt ?? timestamp)),
      peakProgress: Number.isFinite(this.rep?.maxProgress) ? Math.round((this.rep?.maxProgress ?? 0) * 100) / 100 : 0,
      requirements,
      failed,
      passed: !failed.length,
    }
    this.lastRep = event
    this.rep = undefined
    this.flash = failed.length
      ? { feedback: { code: `REQUIREMENT_${failed[0].toUpperCase().replaceAll('-', '_')}`, message: REQUIREMENTS[failed[0]].feedback, tone: 'warning' }, until: timestamp + FLASH_MS.warning }
      : { feedback: { code: 'REP_GOOD', message: this.definition.goal.type === 'duration' ? '保持得很好' : `很好，第 ${event.index} 次`, tone: 'success' }, until: timestamp + FLASH_MS.success }
    return event
  }

  private countPulse(progress: number, measures: RequirementMeasures, timestamp: number): RepEvent | undefined {
    const { moving, peak, returnThreshold } = this.setup.thresholds
    if (this.phase === 'READY') {
      if (progress <= returnThreshold) {
        this.startFrames += 1
        this.movingFrames = 0
        this.rep = undefined
        return undefined
      }
      if (this.startFrames < 2) return undefined
      if (progress >= moving) {
        this.movingFrames += 1
        this.track(progress, measures, timestamp)
        if (this.movingFrames >= 2) this.phase = progress >= peak ? 'PEAK' : 'MOVING'
      } else {
        this.movingFrames = 0
        this.rep = undefined
      }
      return undefined
    }
    this.track(progress, measures, timestamp)
    if (this.phase === 'MOVING') {
      if (progress >= peak) this.phase = 'PEAK'
      else if (progress <= returnThreshold) {
        // 未到结束姿势就回来，不计次
        this.phase = 'READY'
        this.movingFrames = 0
        this.rep = undefined
        this.flash = { feedback: { code: 'MOTION_TOO_SMALL', message: '动作幅度再大一些，做到完成姿势', tone: 'warning' }, until: timestamp + FLASH_MS.warning }
      }
      return undefined
    }
    if (progress < peak) this.phase = 'RETURNING'
    if (progress <= returnThreshold) {
      this.returnFrames += 1
      if (this.returnFrames >= 2) {
        const tooShort = timestamp - (this.rep?.startedAt ?? timestamp) < this.definition.recognition.minRepMs
        this.phase = 'READY'
        this.returnFrames = 0
        this.movingFrames = 0
        if (tooShort) {
          this.rep = undefined
          return undefined
        }
        return this.complete(timestamp)
      }
    } else {
      this.returnFrames = 0
    }
    return undefined
  }

  private countHold(progress: number, measures: RequirementMeasures, timestamp: number): RepEvent | undefined {
    const { peak, returnThreshold } = this.setup.thresholds
    const holdRequired = this.definition.recognition.holdSeconds * 1000
    const durationGoal = this.definition.goal.type === 'duration'
    const holding = this.phase === 'HOLDING' ? progress >= peak - 0.1 : progress >= peak
    if (!holding) {
      if (this.phase === 'HOLDING') {
        this.phase = progress <= returnThreshold ? 'READY' : 'RETURNING'
        this.holdStartedAt = undefined
        this.lastHoldingAt = undefined
        this.holdSegmentMs = 0
        this.rep = undefined
      } else if (this.phase === 'RETURNING' && progress <= returnThreshold) {
        this.phase = 'READY'
      } else if (this.phase === 'READY' && progress > returnThreshold) {
        this.phase = 'MOVING'
      } else if (this.phase === 'MOVING' && progress <= returnThreshold) {
        this.phase = 'READY'
      }
      return undefined
    }
    if (this.phase !== 'HOLDING') {
      // 新的保持必须从起始姿势重新开始（第一次除外）
      if (!durationGoal && this.phase === 'RETURNING') return undefined
      this.phase = 'HOLDING'
      this.holdStartedAt = timestamp
      this.holdSecondsCounted = 0
      this.holdSegmentMs = 0
      this.lastHoldingAt = timestamp
      this.rep = undefined
    }
    this.track(progress, measures, timestamp)
    if (durationGoal) {
      const elapsed = this.lastHoldingAt === undefined ? 0 : Math.min(250, Math.max(0, timestamp - this.lastHoldingAt))
      this.lastHoldingAt = timestamp
      this.holdMs += elapsed
      this.holdSegmentMs += elapsed
      const heldSeconds = Math.floor(this.holdSegmentMs / 1000)
      if (heldSeconds > this.holdSecondsCounted) {
        // 每满一秒按一次计，报告可以给出达标比例
        this.holdSecondsCounted = heldSeconds
        const event = this.complete(timestamp)
        this.rep = { startedAt: timestamp, maxProgress: -Infinity, peakMeasures: null, maxLean: null }
        return event
      }
      return undefined
    }
    if (timestamp - (this.holdStartedAt ?? timestamp) >= holdRequired && this.rep) {
      const event = this.complete(timestamp)
      this.phase = 'RETURNING'
      this.holdStartedAt = undefined
      return event
    }
    return undefined
  }

  private countOrbit(metrics: Record<string, number>, measures: RequirementMeasures, timestamp: number): RepEvent | undefined {
    const left = metrics.leftOrbitValid ? metrics.leftOrbitAngle : undefined
    const right = metrics.rightOrbitValid ? metrics.rightOrbitAngle : undefined
    if (left === undefined && right === undefined) return undefined
    if (!this.orbit) {
      this.orbit = { left: left ?? 0, right: right ?? 0 }
      return undefined
    }
    const unwrap = (current: number, before: number) => {
      let delta = current - before
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      return delta
    }
    const side = this.orbitSide ?? (left !== undefined ? 'left' : 'right')
    this.orbitSide = side
    const current = side === 'left' ? left : right
    const before = this.orbit[side]
    this.orbit = { left: left ?? this.orbit.left, right: right ?? this.orbit.right }
    if (current === undefined) return undefined
    const delta = unwrap(current, before)
    if (Math.abs(delta) > 0.02 && Math.abs(delta) <= 0.5) {
      const direction = Math.sign(delta)
      if (this.orbitDirection !== 0 && direction !== this.orbitDirection) this.orbitTravel = Math.max(0, this.orbitTravel - Math.abs(delta))
      else this.orbitTravel += Math.abs(delta)
      if (this.orbitTravel === 0 || this.orbitDirection === 0) this.orbitDirection = direction
      this.phase = 'MOVING'
      this.track(this.orbitTravel / ORBIT_TRAVEL, measures, timestamp)
    }
    if (this.orbitTravel >= ORBIT_TRAVEL) {
      this.orbitTravel = 0
      this.orbitDirection = 0
      this.phase = 'READY'
      return this.complete(timestamp)
    }
    return undefined
  }

  private countAlternate(metrics: Record<string, number>, measures: RequirementMeasures, timestamp: number): RepEvent | undefined {
    const punch = this.setup.template === 'punch-horizontal'
    const strength = punch ? metrics.punchExtension : metrics.plankCross
    const side = punch ? metrics.punchSide : metrics.plankSide
    const active = punch ? strength >= 0.11 && metrics.punchAsymmetry >= 0.02 : strength >= 0.45
    if (!active) {
      this.armed = true
      this.phase = 'READY'
      return undefined
    }
    this.phase = 'PEAK'
    this.track(1, measures, timestamp)
    if (this.side === undefined) {
      this.side = side
      this.armed = false
      return undefined
    }
    if (this.armed && this.side !== side) {
      this.side = side
      this.armed = false
      return this.complete(timestamp)
    }
    return undefined
  }

  private missing(timestamp: number, quality: RecognizerQuality, hint: string, metrics: Record<string, number> = {}): RecognizerSnapshot {
    if (this.recoverBriefOcclusion && this.setup.mode === 'pose-match' && this.setup.counting === 'pulse'
      && this.phase !== 'READY' && this.lastGoodProgress !== undefined) {
      this.occlusionAt ??= timestamp
      if (timestamp - this.occlusionAt <= SHORT_OCCLUSION_MS) {
        return this.snapshot(quality, null, metrics, timestamp, undefined, { code: 'SHORT_OCCLUSION', message: '暂时看不到动作，保持姿势并回到画面', tone: 'warning' }, hint)
      }
    }
    return this.gap(timestamp, quality, hint, metrics)
  }

  private gap(timestamp: number, quality: RecognizerQuality, hint: string, metrics: Record<string, number> = {}): RecognizerSnapshot {
    // Any unobserved part of a repetition cannot be stitched to later frames.
    this.phase = 'READY'
    this.rep = undefined
    this.movingFrames = 0
    this.startFrames = 0
    this.returnFrames = 0
    this.holdStartedAt = undefined
    this.lastHoldingAt = undefined
    this.holdSegmentMs = 0
    this.orbit = undefined
    this.orbitSide = undefined
    this.orbitDirection = 0
    this.orbitTravel = 0
    this.lastGoodProgress = undefined
    this.occlusionAt = undefined
    return this.snapshot(quality, null, metrics, timestamp, undefined, { code: quality === 'lost' ? 'POSE_LOST' : 'FRAMING', message: hint, tone: 'warning' }, hint)
  }

  private snapshot(
    quality: RecognizerQuality,
    progress: number | null,
    metrics: Record<string, number>,
    timestamp: number,
    repEvent?: RepEvent,
    override?: RecognizerFeedback,
    framingHint?: string,
  ): RecognizerSnapshot {
    const flash = this.flash && this.flash.until > timestamp ? this.flash.feedback : undefined
    return {
      quality,
      phase: this.phase,
      progress: progress === null ? null : Math.round(progress * 1000) / 1000,
      reps: this.reps,
      passedReps: this.passedReps,
      holdMs: Math.round(this.holdMs),
      repEvent,
      lastRep: this.lastRep,
      feedback: override ?? flash ?? this.phaseCue(),
      framingHint,
      metrics,
    }
  }

  private phaseCue(): RecognizerFeedback {
    const duration = this.definition.goal.type === 'duration'
    switch (this.phase) {
      case 'MOVING': return { code: 'MOVING', message: '继续，做到完成姿势', tone: 'info' }
      case 'PEAK': return { code: 'PEAK', message: this.setup.counting === 'alternate' ? '换另一侧' : '到位了，回到开始姿势', tone: 'info' }
      case 'RETURNING': return { code: 'RETURNING', message: '回到开始姿势', tone: 'info' }
      case 'HOLDING': return { code: 'HOLDING', message: duration ? '保持住，继续' : '保持住…', tone: 'info' }
      default: return { code: 'READY', message: duration ? '做到完成姿势并保持住' : '从开始姿势出发，做到完成姿势', tone: 'info' }
    }
  }
}
