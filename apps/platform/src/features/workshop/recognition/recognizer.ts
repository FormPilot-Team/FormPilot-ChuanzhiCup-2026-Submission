import { normalizePoseFrame, type NormalizedPoseFrame } from '../../pose/PoseNormalizer'
import type { LandmarkName, PoseLandmark } from '../../pose/types'
import { PROFILE_OPTIONS, REQUIREMENTS } from '../catalog'
import type { CapturedPose, CustomActionDefinition, FeatureTemplateId, PhaseThresholds, RequirementId } from '../types'
import { isFinitePoint, isUsable, landmark } from './geometry'
import { bodyCoords, buildPoseMatch, readPoseMatch, type PoseMatchIssue, type PoseMatchModel } from './poseMatch'
import { effectiveRequirements, evaluateRequirement, measureRequirements, type EffectiveRequirement, type RequirementMeasures } from './requirements'
import { FEATURE_TEMPLATES, PROFILE_BOUNDS, templateSignalThresholds, type TemplateCounting } from './templates'
import { templateSignal } from './templateSignal'

/**
 * Recognition of one custom action. Pure and frame driven (no camera, no timers), so the workshop test, the custom
 * training page and the unit tests all run the same code. It never touches the warm-up exercise engines.
 */

export type RecognizerMode = 'pose-match' | 'template-calibrated' | 'template'
export type RecognizerPhase = 'READY' | 'MOVING' | 'PEAK' | 'RETURNING' | 'HOLDING'
export type RecognizerQuality = 'good' | 'degraded' | 'lost'

export interface RequirementResult {
  id: RequirementId
  /** null: the body parts it needs were not visible. */
  passed: boolean | null
}

export interface RepEvent {
  index: number
  durationMs: number
  peakProgress: number
  requirements: RequirementResult[]
  failed: RequirementId[]
  /** Every requirement that could be judged was met. */
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
  /** 0 = start pose, 1 = finish pose (template mode: the template's peak). Null when it cannot be judged. */
  progress: number | null
  reps: number
  passedReps: number
  holdMs: number
  /** Present only on the frame a repetition (or a hold second) completes. */
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
  /** Why recognition cannot start yet, in user language. */
  issue?: string
  template: FeatureTemplateId | null
  model?: PoseMatchModel
  calibration?: { start: number; finish: number }
  thresholds: PhaseThresholds
  requirements: EffectiveRequirement[]
  /** Landmarks that must be visible and inside the picture. */
  bounds: LandmarkName[]
  framingLabel: string
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

/** Decides how an action is measured, from its signal source and whatever poses were recorded. */
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

const GAP_ABORT_MS = 450
const FRAME_MARGIN = 0.02
const ORBIT_TRAVEL = 4.5
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
  private returnFrames = 0
  private rep?: RepTracking
  private lastRep?: RepEvent
  private gapStartedAt?: number
  private lastTimestamp?: number
  private flash?: { feedback: RecognizerFeedback; until: number }
  // template (absolute) state
  private neutralSignal?: number
  private neutralHipY?: number
  // orbit / alternate state
  private orbit?: { left: number; right: number }
  private orbitTravel = 0
  private side?: number
  private armed = true
  // hold state
  private holdStartedAt?: number
  private holdSecondsCounted = 0

  constructor(private readonly definition: CustomActionDefinition) {
    this.setup = resolveRecognition(definition)
  }

  reset(): void {
    this.phase = 'READY'
    this.reps = 0
    this.passedReps = 0
    this.holdMs = 0
    this.movingFrames = 0
    this.returnFrames = 0
    this.rep = undefined
    this.lastRep = undefined
    this.gapStartedAt = undefined
    this.lastTimestamp = undefined
    this.flash = undefined
    this.neutralSignal = undefined
    this.neutralHipY = undefined
    this.orbit = undefined
    this.orbitTravel = 0
    this.side = undefined
    this.armed = true
    this.holdStartedAt = undefined
    this.holdSecondsCounted = 0
  }

  process(frame: NormalizedPoseFrame | null, timestamp: number, aspect: number): RecognizerSnapshot {
    const previous = this.lastTimestamp
    this.lastTimestamp = timestamp
    if (!this.setup.ready) return this.snapshot('lost', null, {}, timestamp, undefined, { code: 'NOT_READY', message: this.setup.issue ?? '请先完成识别设置。', tone: 'info' })
    if (!frame || !this.hasTorso(frame.landmarks)) return this.gap(timestamp, 'lost', '请回到画面中，让身体完整入镜')

    const framing = this.framingHint(frame.landmarks)
    const reading = this.read(frame, aspect)
    if (reading.progress === null || framing) return this.gap(timestamp, 'degraded', framing ?? `请让${this.setup.framingLabel}完整入镜`, reading.metrics)
    this.gapStartedAt = undefined

    const measures = measureRequirements(frame.landmarks, aspect)
    let repEvent: RepEvent | undefined
    switch (this.setup.counting) {
      case 'orbit': repEvent = this.countOrbit(reading.metrics, measures, timestamp); break
      case 'alternate': repEvent = this.countAlternate(reading.metrics, measures, timestamp); break
      case 'hold': repEvent = this.countHold(reading.progress, measures, timestamp, previous); break
      default: repEvent = this.countPulse(reading.progress, measures, timestamp)
    }
    const progress = this.setup.counting === 'orbit' ? Math.min(1, this.orbitTravel / ORBIT_TRAVEL) : reading.progress
    return this.snapshot('good', progress, reading.metrics, timestamp, repEvent)
  }

  // ---- reading --------------------------------------------------------------------------------------------------

  /** Pose match needs both shoulders and hips; a template (side planks, seated moves) can live with one of each. */
  private hasTorso(landmarks: ReadonlyArray<PoseLandmark>): boolean {
    const usable = (name: LandmarkName) => isUsable(landmark(landmarks, name))
    if (this.setup.mode === 'pose-match') return TORSO_ANCHORS.every(usable)
    return (usable('leftShoulder') || usable('rightShoulder')) && (usable('leftHip') || usable('rightHip'))
  }

  private framingHint(landmarks: ReadonlyArray<PoseLandmark>): string | undefined {
    let outVertically = false
    let outSideways = false
    let missing = false
    for (const name of this.setup.bounds) {
      const point = landmark(landmarks, name)
      if (!isFinitePoint(point) || point.visibility < 0.35) { missing = true; continue }
      if (point.y < FRAME_MARGIN || point.y > 1 - FRAME_MARGIN) outVertically = true
      if (point.x < FRAME_MARGIN || point.x > 1 - FRAME_MARGIN) outSideways = true
    }
    if (outSideways) return `请向画面中间移动一些，让${this.setup.framingLabel}完整入镜`
    if (outVertically || missing) return `请后退一些，让${this.setup.framingLabel}完整入镜`
    return undefined
  }

  private read(frame: NormalizedPoseFrame, aspect: number): { progress: number | null; metrics: Record<string, number> } {
    if (this.setup.mode === 'pose-match' && this.setup.model) {
      const reading = readPoseMatch(this.setup.model, bodyCoords(frame.landmarks, aspect))
      return {
        progress: reading.progress,
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
    // Uncalibrated template: measured against the user's own ready pose, then the template's peak threshold is 100 %.
    // The workbench did this only for its 'difference' templates; its absolute ones could sit above their own return
    // threshold at rest (arm-raise: straight elbows alone give 0.2 against a 0.06 return), so a repetition never ended.
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

  // ---- counting -------------------------------------------------------------------------------------------------

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
    const failed = requirements.filter((item) => item.passed === false).map((item) => item.id)
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
        // Went out and came back without reaching the finish pose: not a repetition.
        this.phase = 'READY'
        this.movingFrames = 0
        this.rep = undefined
        this.flash = { feedback: { code: 'MOTION_TOO_SMALL', message: '动作幅度再大一些，做到完成姿势', tone: 'warning' }, until: timestamp + FLASH_MS.warning }
      }
      return undefined
    }
    // PEAK or RETURNING
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

  private countHold(progress: number, measures: RequirementMeasures, timestamp: number, previous: number | undefined): RepEvent | undefined {
    const { peak, returnThreshold } = this.setup.thresholds
    const holdRequired = this.definition.recognition.holdSeconds * 1000
    const durationGoal = this.definition.goal.type === 'duration'
    const holding = this.phase === 'HOLDING' ? progress >= peak - 0.1 : progress >= peak
    if (!holding) {
      if (this.phase === 'HOLDING') {
        this.phase = progress <= returnThreshold ? 'READY' : 'RETURNING'
        this.holdStartedAt = undefined
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
      // A new hold may only start from the start pose again (except the very first one).
      if (!durationGoal && this.phase === 'RETURNING') return undefined
      this.phase = 'HOLDING'
      this.holdStartedAt = timestamp
      this.holdSecondsCounted = 0
      this.rep = undefined
    }
    this.track(progress, measures, timestamp)
    if (durationGoal) {
      if (previous !== undefined) this.holdMs += Math.min(250, Math.max(0, timestamp - previous))
      const heldSeconds = Math.floor((timestamp - (this.holdStartedAt ?? timestamp)) / 1000)
      if (heldSeconds > this.holdSecondsCounted) {
        // Each full second of holding is judged like a repetition, so the report can say how much of it met the requirements.
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
    const delta = Math.max(left === undefined ? 0 : Math.abs(unwrap(left, this.orbit.left)), right === undefined ? 0 : Math.abs(unwrap(right, this.orbit.right)))
    this.orbit = { left: left ?? this.orbit.left, right: right ?? this.orbit.right }
    if (delta > 0.02) {
      this.orbitTravel += Math.min(delta, 0.5)
      this.phase = 'MOVING'
      this.track(this.orbitTravel / ORBIT_TRAVEL, measures, timestamp)
    }
    if (this.orbitTravel >= ORBIT_TRAVEL) {
      this.orbitTravel = 0
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

  // ---- gaps and output --------------------------------------------------------------------------------------------

  private gap(timestamp: number, quality: RecognizerQuality, hint: string, metrics: Record<string, number> = {}): RecognizerSnapshot {
    if (this.phase !== 'READY') {
      this.gapStartedAt ??= timestamp
      if (timestamp - this.gapStartedAt >= GAP_ABORT_MS) {
        // A movement interrupted by lost tracking is never completed by the frames after it.
        this.phase = 'READY'
        this.rep = undefined
        this.movingFrames = 0
        this.returnFrames = 0
        this.holdStartedAt = undefined
        this.orbitTravel = 0
      }
    }
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
