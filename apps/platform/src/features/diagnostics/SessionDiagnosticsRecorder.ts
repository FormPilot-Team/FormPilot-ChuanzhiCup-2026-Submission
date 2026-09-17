import type { BaseMotionFeatures, KneeRaiseFeatures, MotionFeatures, ShoulderRotationFeatures, StepJackFeatures, SquatFeatures } from '../motion/types'
import { isKneeRaiseRep, isLateralRaiseRep, isOverheadRaiseRep, isStepJackRep, isSquatRep, type ExerciseId, type ExerciseState, type RepSummary, type RuleResult } from '../exercises/types'
import type { ThresholdVersion } from '../exercises/thresholdVersioning'
import type { PerformanceSnapshot } from './PerformanceTracker'
import type { TrainingCaptureSource } from '../training/types'

export type DiagnosticsDataSource = 'camera' | 'demo_image' | 'demo_image_sequence' | 'synthetic_fixture'

export interface DiagnosticFrame {
  timestamp: number
  exerciseId: ExerciseId
  poseConfidence: number
  phase: string
  phaseTransition?: string
  repIndex: number
  currentScore: number
  activeErrors: string
  primaryFeedback: string
  leftShoulderAngle?: number
  rightShoulderAngle?: number
  leftElbowAngle?: number
  rightElbowAngle?: number
  symmetryDiff?: number
  torsoLean: number
  openRatio?: number
  leftStepOffset?: number
  rightStepOffset?: number
  armAngle?: number
  armLegSyncGapMs?: number
  currentSide?: string
  hipDrop?: number
  standingHipY?: number
  kneeSpreadRatio?: number
  kneeHeightDiff?: number
  hipVelocity?: number
  baselineReady?: boolean
  leftKneeHeight?: number
  rightKneeHeight?: number
  leftKneeVelocity?: number
  rightKneeVelocity?: number
  hipShift?: number
  lastCompletedSide?: string
  cycleCount?: number
  leftExcursion?: number
  rightExcursion?: number
  motionSync?: number
  motionContinuity?: number
  activeMotionMs?: number
}

export interface DiagnosticRep {
  exerciseId: ExerciseId
  repIndex: number
  startTime: number
  topTime?: number
  endTime: number
  peakShoulderLeft?: number
  peakShoulderRight?: number
  minimumElbowLeft?: number
  minimumElbowRight?: number
  maxSymmetryDiff?: number
  maxTorsoLean: number
  duration: number
  finalRepScore: number
  side?: string
  peakOpenRatio?: number
  peakMeanShoulderAngle?: number
  maxArmAngleDiff?: number
  syncGapMs?: number
  bottomTime?: number
  maxHipDrop?: number
  minKneeSpreadRatio?: number
  maxKneeHeightDiff?: number
  depthScore?: number
  stabilityScore?: number
  symmetryScore?: number
  completionScore?: number
  tempoScore?: number
  peakKneeHeight?: number
  hipShiftMax?: number
  alternationScore?: number
}

export interface SessionDiagnosticsExport {
  schemaVersion: 1
  privacy: 'derived-pose-metrics-only-no-video'
  generatedAt: string
  specVersion: string
  thresholdVersion: ThresholdVersion
  dataSource: DiagnosticsDataSource
  captureSource: TrainingCaptureSource
  units: {
    angle: 'degree'
    time: 'ms'
    ratio: 'dimensionless'
  }
  frames: DiagnosticFrame[]
  repetitions: DiagnosticRep[]
  performance: PerformanceSnapshot
}

export interface DiagnosticsExportContext {
  specVersion: string
  thresholdVersion: ThresholdVersion
  dataSource: DiagnosticsDataSource
  captureSource: TrainingCaptureSource
}

export class SessionDiagnosticsRecorder {
  private frames: DiagnosticFrame[] = []
  private repetitions: DiagnosticRep[] = []
  private previousPhase = new Map<ExerciseId, string>()
  private seenReps = new Set<string>()

  reset(): void {
    this.frames = []
    this.repetitions = []
    this.previousPhase.clear()
    this.seenReps.clear()
  }

  record(features: BaseMotionFeatures, state: ExerciseState, result: RuleResult): void {
    const previous = this.previousPhase.get(result.exerciseId)
    const transition = previous && previous !== state.phase ? `${previous}->${state.phase}` : undefined
    this.previousPhase.set(result.exerciseId, state.phase)
    const lateral = this.isLateral(features) ? features : undefined
    const step = this.isStepJack(features) ? features : undefined
    const squat = this.isSquat(features) ? features : undefined
    const kneeRaise = this.isKneeRaise(features) ? features : undefined
    const rotation = this.isShoulderRotation(features) ? features : undefined
    const syncGap = 'armOpenAt' in state && typeof state.armOpenAt === 'number' && 'legOpenAt' in state && typeof state.legOpenAt === 'number'
      ? Math.abs(state.armOpenAt - state.legOpenAt)
      : undefined
    this.frames.push({
      timestamp: features.timestamp, exerciseId: result.exerciseId, poseConfidence: features.confidence,
      phase: state.phase, phaseTransition: transition, repIndex: state.repCount, currentScore: result.currentScore,
      activeErrors: result.errors.map((item) => item.code).join('|'), primaryFeedback: result.primaryFeedback?.message ?? '',
      leftShoulderAngle: lateral?.shoulderAngleL ?? step?.leftShoulderAngle,
      rightShoulderAngle: lateral?.shoulderAngleR ?? step?.rightShoulderAngle,
      leftElbowAngle: lateral?.elbowAngleL, rightElbowAngle: lateral?.elbowAngleR,
      symmetryDiff: lateral?.symmetryDiff ?? step?.armAngleDiff, torsoLean: features.torsoLean,
      openRatio: step?.openRatio, leftStepOffset: step?.leftStepOffset, rightStepOffset: step?.rightStepOffset,
      armAngle: step?.meanShoulderAngle, armLegSyncGapMs: syncGap,
      currentSide: 'activeSide' in state && typeof state.activeSide === 'string' ? state.activeSide
        : 'currentSide' in state && typeof state.currentSide === 'string' ? state.currentSide : undefined,
      hipDrop: squat?.hipDrop, standingHipY: squat?.baselineReady ? squat.standingHipY : undefined,
      kneeSpreadRatio: squat?.kneeSpreadRatio, kneeHeightDiff: squat?.kneeHeightDiff,
      hipVelocity: squat?.hipVerticalVelocity, baselineReady: squat?.baselineReady ?? kneeRaise?.baselineReady,
      leftKneeHeight: kneeRaise?.leftKneeHeight, rightKneeHeight: kneeRaise?.rightKneeHeight,
      leftKneeVelocity: kneeRaise?.leftKneeVelocity, rightKneeVelocity: kneeRaise?.rightKneeVelocity,
      hipShift: kneeRaise?.hipHorizontalShift,
      lastCompletedSide: 'lastCompletedSide' in state && typeof state.lastCompletedSide === 'string' ? state.lastCompletedSide : undefined,
      cycleCount: 'cycleCount' in state && typeof state.cycleCount === 'number' ? state.cycleCount : undefined,
      leftExcursion: rotation?.leftExcursion, rightExcursion: rotation?.rightExcursion,
      motionSync: rotation?.motionSync, motionContinuity: rotation?.motionContinuity,
      activeMotionMs: 'activeMotionMs' in state && typeof state.activeMotionMs === 'number' ? state.activeMotionMs : undefined,
    })
    if (this.frames.length > 6000) this.frames.shift()
    if (state.completedRep) this.recordRep(state.completedRep, result.currentScore)
  }

  export(performance: PerformanceSnapshot, context: DiagnosticsExportContext): SessionDiagnosticsExport {
    return {
      schemaVersion: 1,
      privacy: 'derived-pose-metrics-only-no-video',
      generatedAt: new Date().toISOString(),
      specVersion: context.specVersion,
      thresholdVersion: context.thresholdVersion,
      dataSource: context.dataSource,
      captureSource: context.captureSource,
      units: { angle: 'degree', time: 'ms', ratio: 'dimensionless' },
      frames: structuredClone(this.frames),
      repetitions: structuredClone(this.repetitions),
      performance,
    }
  }

  downloadJson(performance: PerformanceSnapshot, context: DiagnosticsExportContext): void {
    this.download(`ai-coach-diagnostics-${Date.now()}.json`, JSON.stringify(this.export(performance, context), null, 2), 'application/json')
  }

  downloadCsv(): void {
    const headers: Array<keyof DiagnosticFrame> = [
      'timestamp', 'exerciseId', 'poseConfidence', 'phase', 'phaseTransition', 'repIndex', 'currentScore',
      'activeErrors', 'primaryFeedback', 'leftShoulderAngle', 'rightShoulderAngle', 'leftElbowAngle',
      'rightElbowAngle', 'symmetryDiff', 'torsoLean', 'openRatio', 'leftStepOffset', 'rightStepOffset',
      'armAngle', 'armLegSyncGapMs', 'currentSide',
      'hipDrop', 'standingHipY', 'kneeSpreadRatio', 'kneeHeightDiff', 'hipVelocity', 'baselineReady',
      'leftKneeHeight', 'rightKneeHeight', 'leftKneeVelocity', 'rightKneeVelocity', 'hipShift', 'lastCompletedSide', 'cycleCount',
      'leftExcursion', 'rightExcursion', 'motionSync', 'motionContinuity', 'activeMotionMs',
    ]
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const csv = [headers.join(','), ...this.frames.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\n')
    this.download(`ai-coach-diagnostics-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  private recordRep(rep: RepSummary, score: number): void {
    const key = `${rep.exerciseId}:${rep.repIndex}`
    if (this.seenReps.has(key)) return
    this.seenReps.add(key)
    this.repetitions.push({
      exerciseId: rep.exerciseId,
      repIndex: rep.repIndex,
      startTime: rep.startedAt,
      topTime: isLateralRaiseRep(rep) && rep.topHoldMs ? rep.completedAt - rep.topHoldMs : isKneeRaiseRep(rep) ? rep.topTime : undefined,
      endTime: rep.completedAt,
      peakShoulderLeft: isLateralRaiseRep(rep) || isOverheadRaiseRep(rep) ? rep.peakShoulderL : undefined,
      peakShoulderRight: isLateralRaiseRep(rep) || isOverheadRaiseRep(rep) ? rep.peakShoulderR : undefined,
      minimumElbowLeft: isLateralRaiseRep(rep) || isOverheadRaiseRep(rep) ? rep.minElbowL : undefined,
      minimumElbowRight: isLateralRaiseRep(rep) || isOverheadRaiseRep(rep) ? rep.minElbowR : undefined,
      maxSymmetryDiff: isLateralRaiseRep(rep) || isOverheadRaiseRep(rep) ? rep.maxSymmetryDiff : isStepJackRep(rep) ? rep.maxArmAngleDiff : undefined,
      maxTorsoLean: rep.maxTorsoLean,
      duration: rep.durationMs,
      finalRepScore: score,
      side: isStepJackRep(rep) || isKneeRaiseRep(rep) ? rep.side : undefined,
      peakOpenRatio: isStepJackRep(rep) ? rep.peakOpenRatio : undefined,
      peakMeanShoulderAngle: isStepJackRep(rep) ? rep.peakMeanShoulderAngle : undefined,
      maxArmAngleDiff: isStepJackRep(rep) ? rep.maxArmAngleDiff : undefined,
      syncGapMs: isStepJackRep(rep) ? rep.syncGapMs : undefined,
      bottomTime: isSquatRep(rep) ? rep.bottomTime : undefined,
      maxHipDrop: isSquatRep(rep) ? rep.maxHipDrop : undefined,
      minKneeSpreadRatio: isSquatRep(rep) ? rep.minKneeSpreadRatio : undefined,
      maxKneeHeightDiff: isSquatRep(rep) ? rep.maxKneeHeightDiff : undefined,
      depthScore: isSquatRep(rep) ? rep.depthScore : undefined,
      stabilityScore: isSquatRep(rep) ? rep.stabilityScore : undefined,
      symmetryScore: isSquatRep(rep) ? rep.symmetryScore : undefined,
      completionScore: isSquatRep(rep) ? rep.completionScore : undefined,
      tempoScore: isSquatRep(rep) ? rep.tempoScore : undefined,
      peakKneeHeight: isKneeRaiseRep(rep) ? rep.peakKneeHeight : undefined,
      hipShiftMax: isKneeRaiseRep(rep) ? rep.hipShiftMax : undefined,
      alternationScore: isKneeRaiseRep(rep) ? rep.alternationScore : undefined,
    })
  }

  private isLateral(features: BaseMotionFeatures): features is MotionFeatures {
    return 'shoulderAngleL' in features && !('openRatio' in features)
  }

  private isStepJack(features: BaseMotionFeatures): features is StepJackFeatures {
    return 'openRatio' in features
  }

  private isSquat(features: BaseMotionFeatures): features is SquatFeatures {
    return 'hipDrop' in features
  }

  private isKneeRaise(features: BaseMotionFeatures): features is KneeRaiseFeatures {
    return 'leftKneeHeight' in features
  }

  private isShoulderRotation(features: BaseMotionFeatures): features is ShoulderRotationFeatures {
    return 'leftExcursion' in features
  }

  private download(filename: string, content: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }
}
