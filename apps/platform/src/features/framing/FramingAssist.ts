import type { NormalizedPoseFrame } from '../pose/PoseNormalizer'
import { LANDMARK_INDEX, type LandmarkName, type PoseLandmark } from '../pose/types'
import { FRAMING_PROFILES, type FramingProfileId } from './framingProfiles'

export type FramingRegion = 'head' | 'shoulders' | 'hands' | 'torso' | 'hips' | 'knees' | 'feet'
export type FramingStatus = 'READY' | 'UNSTABLE' | 'MISSING_REQUIRED' | 'TOO_CLOSE' | 'EDGE_WARNING' | 'TOO_FAR' | 'SPACE_LIMITED'
export type FramingDistance = 'TOO_CLOSE' | 'GOOD' | 'TOO_FAR'
export type FramingEdge = 'top' | 'right' | 'bottom' | 'left'

export interface FramingBodyBox {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export interface FramingAssistState {
  profile: FramingProfileId
  status: FramingStatus
  bodyBox?: FramingBodyBox
  centerOffset: { x: number; y: number }
  requiredRegions: ReadonlyArray<FramingRegion>
  missingRegions: ReadonlyArray<FramingRegion>
  edgeWarnings: ReadonlyArray<FramingEdge>
  distanceState: FramingDistance
  primaryHint: string
  secondaryHint?: string
  isReady: boolean
  confidence: number
}

export interface FramingAssistConfig {
  visibilityThreshold: number
  edgeWarningMargin: number
  hardFrameMargin: number
  enterDelayMs: number
  recoveryDelayMs: number
  spaceLimitedDelayMs: number
}

export const FRAMING_ASSIST_CONFIG: FramingAssistConfig = {
  visibilityThreshold: 0.55,
  edgeWarningMargin: 0.045,
  hardFrameMargin: 0.012,
  enterDelayMs: 350,
  recoveryDelayMs: 600,
  spaceLimitedDelayMs: 6000,
}

const REGION_LANDMARKS: Record<FramingRegion, ReadonlyArray<LandmarkName>> = {
  head: ['nose'],
  shoulders: ['leftShoulder', 'rightShoulder'],
  hands: ['leftWrist', 'rightWrist'],
  torso: ['leftShoulder', 'rightShoulder'],
  hips: ['leftHip', 'rightHip'],
  knees: ['leftKnee', 'rightKnee'],
  feet: ['leftAnkle', 'rightAnkle'],
}

const PROFILE_REGIONS: Record<FramingProfileId, ReadonlyArray<FramingRegion>> = {
  UPPER_BODY: ['head', 'shoulders', 'hands', 'torso'],
  UPPER_BODY_WITH_HIPS: ['head', 'shoulders', 'hands', 'torso', 'hips'],
  FULL_BODY: ['head', 'shoulders', 'hands', 'torso', 'hips', 'knees', 'feet'],
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function validLandmark(point: PoseLandmark | undefined, threshold: number): point is PoseLandmark {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.visibility >= threshold && (point.presence ?? 1) >= threshold)
}

function regionLabel(regions: ReadonlyArray<FramingRegion>): string {
  if (regions.includes('feet') || regions.includes('knees')) return regions.includes('feet') ? '膝盖和脚部' : '膝盖'
  if (regions.includes('hands')) return '双手'
  if (regions.includes('hips')) return '髋部'
  if (regions.includes('head')) return '头部'
  return '身体关键部位'
}

function boxFor(points: ReadonlyArray<PoseLandmark>): FramingBodyBox | undefined {
  if (!points.length) return undefined
  // A 10% trimmed range prevents one unstable landmark from pulling the guide across the frame.
  const sortedX = points.map((point) => point.x).sort((a, b) => a - b)
  const sortedY = points.map((point) => point.y).sort((a, b) => a - b)
  const trim = points.length >= 10 ? 1 : 0
  const left = clamp(sortedX[trim])
  const right = clamp(sortedX[sortedX.length - 1 - trim])
  const top = clamp(sortedY[trim])
  const bottom = clamp(sortedY[sortedY.length - 1 - trim])
  return { left, top, right, bottom, width: right - left, height: bottom - top, centerX: (left + right) / 2, centerY: (top + bottom) / 2 }
}

function missingHint(profile: FramingProfileId, missing: ReadonlyArray<FramingRegion>, explicitOutside: boolean): string {
  const label = regionLabel(missing)
  if (missing.includes('feet') || missing.includes('knees')) return explicitOutside
    ? `请后退一点，让${label}进入画面`
    : `暂未稳定识别到${label}，请后退一点`
  if (missing.includes('hands')) return explicitOutside ? '请让双手保持在取景区域内' : '暂未稳定识别到双手，请调整站位'
  return profile === 'FULL_BODY' ? '请后退一点，让全身进入画面' : `暂未稳定识别到${label}，请调整站位`
}

export function evaluateFraming(profileId: FramingProfileId, frame: NormalizedPoseFrame, config: FramingAssistConfig = FRAMING_ASSIST_CONFIG): FramingAssistState {
  const profile = FRAMING_PROFILES[profileId]
  const requiredRegions = PROFILE_REGIONS[profileId]
  const at = (name: LandmarkName) => frame.landmarks[LANDMARK_INDEX[name]]
  const requiredPoints = profile.bounds.map(at)
  const validPoints = requiredPoints.filter((point) => validLandmark(point, config.visibilityThreshold))
  const bodyBox = boxFor(validPoints)
  const missingRegions = requiredRegions.filter((region) => REGION_LANDMARKS[region].some((name) => {
    const point = at(name)
    return !validLandmark(point, config.visibilityThreshold)
      || point.x < config.hardFrameMargin || point.x > 1 - config.hardFrameMargin
      || point.y < config.hardFrameMargin || point.y > 1 - config.hardFrameMargin
  }))
  const explicitOutside = requiredRegions.some((region) => REGION_LANDMARKS[region].some((name) => {
    const point = at(name)
    return Boolean(point && (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1))
  }))
  const edgeWarnings = new Set<FramingEdge>()
  for (const point of validPoints) {
    if (point.x < config.edgeWarningMargin) edgeWarnings.add('left')
    if (point.x > 1 - config.edgeWarningMargin) edgeWarnings.add('right')
    if (point.y < config.edgeWarningMargin) edgeWarnings.add('top')
    if (point.y > 1 - config.edgeWarningMargin) edgeWarnings.add('bottom')
  }
  const shoulderWidth = frame.body.shoulderWidth
  const torsoLength = frame.body.torsoLength
  const tooClose = Boolean(bodyBox && (bodyBox.height > (profileId === 'FULL_BODY' ? 0.92 : 0.72) || shoulderWidth > 0.48 || torsoLength > 0.46))
  const tooFar = Boolean(bodyBox && (bodyBox.height < (profileId === 'FULL_BODY' ? 0.42 : 0.25) || shoulderWidth < 0.105 || torsoLength < 0.12))
  const distanceState: FramingDistance = tooClose ? 'TOO_CLOSE' : tooFar ? 'TOO_FAR' : 'GOOD'
  const confidence = requiredPoints.length ? requiredPoints.reduce((sum, point) => sum + (validLandmark(point, config.visibilityThreshold) ? point.visibility : 0), 0) / requiredPoints.length : 0
  const centerOffset = bodyBox ? { x: bodyBox.centerX - 0.5, y: bodyBox.centerY - 0.5 } : { x: 0, y: 0 }

  if (missingRegions.length) return {
    profile: profileId, status: 'MISSING_REQUIRED', bodyBox, centerOffset, requiredRegions, missingRegions,
    edgeWarnings: [...edgeWarnings], distanceState, primaryHint: missingHint(profileId, missingRegions, explicitOutside),
    secondaryHint: profile.preparation, isReady: false, confidence,
  }
  if (tooClose) return {
    profile: profileId, status: 'TOO_CLOSE', bodyBox, centerOffset, requiredRegions, missingRegions,
    edgeWarnings: [...edgeWarnings], distanceState, primaryHint: profileId === 'FULL_BODY' ? '请后退一点，让全身留在画面内' : '请后退一点，留出动作空间',
    isReady: false, confidence,
  }
  if (edgeWarnings.size) {
    let primaryHint = '即将出框，请向画面中间移动一点'
    if (edgeWarnings.has('top')) primaryHint = '稍微后退，让头顶和双手留出空间'
    else if (edgeWarnings.has('left')) primaryHint = '向右移动一点'
    else if (edgeWarnings.has('right')) primaryHint = '向左移动一点'
    else if (edgeWarnings.has('bottom')) primaryHint = '请后退一点，让下方留出空间'
    return { profile: profileId, status: 'EDGE_WARNING', bodyBox, centerOffset, requiredRegions, missingRegions, edgeWarnings: [...edgeWarnings], distanceState, primaryHint, secondaryHint: '即将出框', isReady: true, confidence }
  }
  if (tooFar) return {
    profile: profileId, status: 'TOO_FAR', bodyBox, centerOffset, requiredRegions, missingRegions,
    edgeWarnings: [], distanceState, primaryHint: '可以靠近一些',
    secondaryHint: profileId === 'FULL_BODY' ? '请继续保持全身完整入镜' : undefined, isReady: true, confidence,
  }
  return {
    profile: profileId, status: 'READY', bodyBox, centerOffset, requiredRegions, missingRegions,
    edgeWarnings: [], distanceState, primaryHint: `${profile.label}入镜 ✓`, isReady: true, confidence,
  }
}

export function initialFramingAssistState(profile: FramingProfileId): FramingAssistState {
  return {
    profile, status: 'UNSTABLE', centerOffset: { x: 0, y: 0 }, requiredRegions: PROFILE_REGIONS[profile],
    missingRegions: [], edgeWarnings: [], distanceState: 'GOOD', primaryHint: FRAMING_PROFILES[profile].preparation,
    isReady: false, confidence: 0,
  }
}

function sameSignal(a: FramingAssistState, b: FramingAssistState): boolean {
  return a.profile === b.profile && a.status === b.status && a.primaryHint === b.primaryHint
}

export class FramingAssistController {
  private shown: FramingAssistState
  private candidate?: FramingAssistState
  private candidateSince = 0
  private lowerBodyMissingSince?: number
  private smoothedBox?: FramingBodyBox

  constructor(private readonly config: FramingAssistConfig = FRAMING_ASSIST_CONFIG, initialProfile: FramingProfileId = 'FULL_BODY') {
    this.shown = initialFramingAssistState(initialProfile)
  }

  reset(profile: FramingProfileId = this.shown.profile): FramingAssistState {
    this.shown = initialFramingAssistState(profile)
    this.candidate = undefined
    this.lowerBodyMissingSince = undefined
    this.smoothedBox = undefined
    return this.shown
  }

  update(profile: FramingProfileId, frame: NormalizedPoseFrame, now = frame.timestamp): FramingAssistState {
    let next = evaluateFraming(profile, frame, this.config)
    if (next.bodyBox) {
      const alpha = 0.24
      const previous = this.smoothedBox ?? next.bodyBox
      const mix = (a: number, b: number) => a + (b - a) * alpha
      const left = mix(previous.left, next.bodyBox.left); const top = mix(previous.top, next.bodyBox.top)
      const right = mix(previous.right, next.bodyBox.right); const bottom = mix(previous.bottom, next.bodyBox.bottom)
      this.smoothedBox = { left, top, right, bottom, width: right - left, height: bottom - top, centerX: (left + right) / 2, centerY: (top + bottom) / 2 }
      next = { ...next, bodyBox: this.smoothedBox, centerOffset: { x: this.smoothedBox.centerX - 0.5, y: this.smoothedBox.centerY - 0.5 } }
    }

    const missingLower = profile === 'FULL_BODY' && next.missingRegions.some((region) => region === 'knees' || region === 'feet')
    if (missingLower) this.lowerBodyMissingSince ??= now
    else this.lowerBodyMissingSince = undefined
    if (missingLower && this.lowerBodyMissingSince !== undefined && now - this.lowerBodyMissingSince >= this.config.spaceLimitedDelayMs) {
      next = {
        ...next,
        status: 'SPACE_LIMITED',
        primaryHint: '当前镜头范围可能不足以完整拍到全身',
        secondaryHint: '可将摄像头放高或后移，并调整设备角度',
        isReady: false,
      }
    }

    if (this.shown.profile !== profile) return this.commit(next, now)
    if (sameSignal(this.shown, next)) {
      this.candidate = undefined
      this.shown = { ...next, bodyBox: next.bodyBox }
      return this.shown
    }
    if (!this.candidate || !sameSignal(this.candidate, next)) {
      this.candidate = next
      this.candidateSince = now
      return this.shown
    }
    const delay = next.status === 'READY' ? this.config.recoveryDelayMs : this.config.enterDelayMs
    if (now - this.candidateSince >= delay) return this.commit(next, now)
    return this.shown
  }

  private commit(next: FramingAssistState, now: number): FramingAssistState {
    this.shown = next
    this.candidate = undefined
    this.candidateSince = now
    return this.shown
  }
}
