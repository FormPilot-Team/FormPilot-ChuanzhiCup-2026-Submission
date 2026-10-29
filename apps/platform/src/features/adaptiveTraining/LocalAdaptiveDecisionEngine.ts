import { parseTrainingInput, STRATEGIES, type ErrorCode, type InterventionStrategy, type LocalDecisionExplanation, type LocalDecisionFeatures, type TrainingDecision, type TrainingDecisionInput } from './protocol.ts'

export const LOCAL_POLICY = {
  windowMs: 30000, sampleMs: 1000, evaluationMs: 2000, warmupSamples: 4,
  holdMs: 8000, hysteresisMargin: 8,
  cooldownMs: { CONTINUE_STANDARD: 0, SWITCH_CUE: 12000, SHOW_DECOMPOSITION: 16000, SUGGEST_PAUSE: 30000 },
} as const
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
const resting = (phase: TrainingDecisionInput['phase']) => ['START', 'CENTER', 'STANDING', 'READY', 'COMPLETE'].includes(phase)
// Score trends compare the same phase, rather than an idle score with a movement peak.
const phaseKey = (input: TrainingDecisionInput) => input.phase

interface Sample { at: number; phase: string; score: number | null; issue?: ErrorCode; valid: boolean }
interface Intervention { strategy: InterventionStrategy; activeAt: number; quality: number | null; phase: string; failed: boolean }

export function localSafetyReason(input: TrainingDecisionInput): string | undefined {
  if (input.trainingState !== 'ACTIVE' || input.completion >= 1) return '当前未在有效训练中，保留原有反馈。'
  // Reuses the training page's existing reliability boundary; no new pose or anatomical thresholds.
  if (!input.poseValid || (input.poseReliability !== undefined && input.poseReliability < .65)
    || input.errors.some(e => e.code === 'POSE_LOW_CONFIDENCE' || e.code === 'BODY_OUT_OF_FRAME')) return '姿态识别不可靠，暂不据此判断动作错误。'
  if (input.score === null && input.exerciseId !== 'shoulder_rotation') return '动作评分数据不足，保留原有反馈。'
  if (input.errors.some(e => e.severity >= .8 || e.code === 'KNEE_VALGUS')) return '当前纠错优先级较高，沿用原有安全反馈。'
  return undefined
}

export function guardLocalStrategy(input: TrainingDecisionInput, strategy: InterventionStrategy): InterventionStrategy {
  if (localSafetyReason(input) || input.errors.length === 0 || input.feedbackResponse === 'corrected') return 'CONTINUE_STANDARD'
  if (strategy === 'SUGGEST_PAUSE' && (!resting(input.phase) || input.consecutiveErrors < 6
    || (input.history.activeSeconds ?? input.elapsedSeconds) < 180)) return 'CONTINUE_STANDARD'
  return strategy
}

/** In-memory, deterministic policy. Scores are engineering utilities, not probabilities or learned confidences. */
export class LocalAdaptiveDecisionEngine {
  private samples: Sample[] = []
  private exerciseId?: string
  private issue?: ErrorCode
  private memoryIssue?: ErrorCode
  private lastSampleAt = -Infinity
  private lastEvaluationAt = -Infinity
  private lastNow = -Infinity
  private activeMs = 0
  private previousActive = false
  private selected: InterventionStrategy = 'CONTINUE_STANDARD'
  private selectedAt = 0
  private activations = new Map<InterventionStrategy, number>()
  private failures = new Map<InterventionStrategy, number>()
  private intervention?: Intervention
  private lastDecision?: TrainingDecision

  reset(): void {
    this.samples = []; this.exerciseId = undefined; this.issue = undefined; this.memoryIssue = undefined
    this.lastSampleAt = -Infinity; this.lastEvaluationAt = -Infinity; this.lastNow = -Infinity
    this.activeMs = 0; this.previousActive = false; this.selected = 'CONTINUE_STANDARD'; this.selectedAt = 0
    this.activations.clear(); this.failures.clear(); this.intervention = undefined; this.lastDecision = undefined
  }

  decide(summary: TrainingDecisionInput, now = performance.now()): TrainingDecision {
    const started = performance.now()
    let input: TrainingDecisionInput
    try {
      input = parseTrainingInput(summary)
      if (!Number.isFinite(now) || now < this.lastNow) throw new Error('Invalid clock')
    } catch {
      this.reset()
      return this.result(this.emptyFeatures(), ['状态数据不完整或时间无效，保留原有反馈。'], 'safety', true, started)
    }
    if (this.exerciseId !== input.exerciseId) { this.reset(); this.exerciseId = input.exerciseId }
    const safeReason = localSafetyReason(input)
    const valid = !safeReason
    if (valid && this.previousActive && Number.isFinite(this.lastNow)) this.activeMs += clamp(now - this.lastNow, 0, 2000)
    this.previousActive = valid
    this.lastNow = now
    if (now - this.lastSampleAt >= LOCAL_POLICY.sampleMs) {
      this.lastSampleAt = now
      this.samples.push({ at: now, phase: phaseKey(input), score: valid ? input.score : null, issue: valid ? input.errors[0]?.code : undefined, valid })
      this.samples = this.samples.filter(s => now - s.at <= LOCAL_POLICY.windowMs).slice(-31)
    }
    const issue = valid ? input.errors[0]?.code : undefined
    if (issue !== this.issue) {
      this.issue = issue
    }
    if (issue && issue !== this.memoryIssue) {
      this.memoryIssue = issue; this.intervention = undefined; this.failures.clear(); this.activations.clear()
      this.selected = 'CONTINUE_STANDARD'; this.lastDecision = undefined
    }
    const features = this.features(input, now)
    if (safeReason) {
      this.selected = 'CONTINUE_STANDARD'; this.intervention = undefined
      return this.result(features, [safeReason], 'safety', true, started)
    }
    if (!issue || input.feedbackResponse === 'corrected' || features.trend === 'improving') {
      // Leaving a judged phase is not proof of correction. Retain intervention memory across brief return phases.
      if (input.feedbackResponse === 'corrected' || features.trend === 'improving' || features.stableSeconds >= 8) {
        this.selected = 'CONTINUE_STANDARD'; this.failures.clear(); this.intervention = undefined
      }
      return this.result(features, [input.feedbackResponse === 'corrected' || features.trend === 'improving'
        ? '近期动作已经改善，减少重复干预。' : '暂无持续的已确认问题，继续常规训练。'], 'score', false, started,
        undefined, undefined, 'CONTINUE_STANDARD')
    }
    if (features.reliableSamples < LOCAL_POLICY.warmupSamples) {
      this.selected = 'CONTINUE_STANDARD'
      return this.result(features, ['正在收集近期可靠状态，避免对偶发错误过早干预。'], 'collecting', false, started)
    }
    if (now - this.lastEvaluationAt < LOCAL_POLICY.evaluationMs && this.lastDecision) {
      const guarded = guardLocalStrategy(input, this.lastDecision.strategy)
      if (guarded !== this.lastDecision.strategy) return this.result(features, ['当前阶段不执行该干预，保留原有反馈。'], 'safety', true,
        started, this.lastDecision.local!.strategyScores, ['CONTINUE_STANDARD'], guarded)
      return { ...this.lastDecision, latencyMs: performance.now() - started,
        local: { ...this.lastDecision.local!, features, selection: 'sampling' } }
    }
    this.lastEvaluationAt = now
    if (this.intervention && !this.intervention.failed && this.activeMs - this.intervention.activeAt >= LOCAL_POLICY.holdMs
      && features.interventionEffect === 'ineffective') {
      this.intervention.failed = true
      this.failures.set(this.intervention.strategy, (this.failures.get(this.intervention.strategy) ?? 0) + 1)
    }
    features.ineffectiveInterventions = [...this.failures.values()].reduce((sum, n) => sum + n, 0)
    const scores = this.score(features)
    const eligible = this.eligible(input, features)
    let candidate = eligible.reduce((best, strategy) => scores[strategy] > scores[best] ? strategy : best, 'CONTINUE_STANDARD' as InterventionStrategy)
    let selection: LocalDecisionExplanation['selection'] = 'score'
    if (candidate !== this.selected && eligible.includes(this.selected)) {
      if (this.selected !== 'CONTINUE_STANDARD' && this.activeMs - this.selectedAt < LOCAL_POLICY.holdMs) { candidate = this.selected; selection = 'cooldown' }
      else if (scores[candidate] < scores[this.selected] + LOCAL_POLICY.hysteresisMargin) { candidate = this.selected; selection = 'hysteresis' }
    }
    if (candidate !== this.selected) {
      this.selected = candidate; this.selectedAt = this.activeMs
      this.activations.set(candidate, this.activeMs)
      this.intervention = candidate === 'CONTINUE_STANDARD' ? undefined : { strategy: candidate, activeAt: this.activeMs, quality: features.qualityScore, phase: phaseKey(input), failed: false }
    }
    const reasons = this.reasons(features, selection)
    return this.result(features, reasons, selection, false, started, scores, eligible)
  }

  private emptyFeatures(): LocalDecisionFeatures {
    return { windowSeconds: 30, reliableSamples: 0, poseReliability: 0, qualityScore: null, errorFrequency: 0,
      errorDurationSeconds: 0, repeatedPrompts: 0, scoreTrend: null, trend: 'insufficient', previousStrategy: this.selected,
      interventionEffect: 'none', ineffectiveInterventions: 0, stableSeconds: 0, activeSeconds: 0 }
  }
  private features(input: TrainingDecisionInput, now: number): LocalDecisionFeatures {
    const valid = this.samples.filter(s => s.valid)
    const aligned = valid.filter(s => s.phase === phaseKey(input) && s.score !== null).map(s => s.score!)
    const midpoint = Math.floor(aligned.length / 2)
    const scoreTrend = aligned.length >= 4 ? (mean(aligned.slice(midpoint))! - mean(aligned.slice(0, midpoint))!) : null
    const qualityScore = mean(aligned.slice(-4)) ?? input.score ?? input.history.averageScore
    const trend = scoreTrend === null ? 'insufficient' : scoreTrend >= 8 ? 'improving' : scoreTrend <= -8 ? 'worsening' : 'steady'
    const recent = valid.filter(s => now - s.at <= 15000)
    const errorFrequency = recent.length ? recent.filter(s => s.issue === this.issue && this.issue !== undefined).length / recent.length : 0
    let effect: LocalDecisionFeatures['interventionEffect'] = this.intervention ? 'observing' : 'none'
    if (this.intervention) {
      const improved = this.intervention.phase === phaseKey(input)
        && (trend === 'improving' || (qualityScore !== null && this.intervention.quality !== null && qualityScore - this.intervention.quality >= 8))
      if (improved || input.feedbackResponse === 'corrected') effect = 'effective'
      else if (this.activeMs - this.intervention.activeAt >= LOCAL_POLICY.holdMs && errorFrequency >= .4) effect = 'ineffective'
    }
    return { windowSeconds: 30, reliableSamples: valid.length, poseReliability: input.poseReliability ?? (input.poseValid ? 1 : 0),
      // 1 Hz observation estimate accumulated within the window, including repeated issues across movement cycles.
      qualityScore, errorFrequency, errorDurationSeconds: this.issue === undefined ? 0 : Math.min(30, valid.filter(s => s.issue === this.issue).length),
      repeatedPrompts: input.consecutiveErrors, scoreTrend, trend, previousStrategy: this.selected, interventionEffect: effect,
      ineffectiveInterventions: [...this.failures.values()].reduce((sum, n) => sum + n, 0),
      stableSeconds: input.history.stableSeconds, activeSeconds: input.history.activeSeconds ?? input.elapsedSeconds }
  }
  private score(f: LocalDecisionFeatures): Record<InterventionStrategy, number> {
    const deficit = f.qualityScore === null ? .3 : clamp((85 - f.qualityScore) / 45)
    const frequency = f.errorFrequency, repetition = clamp(f.repeatedPrompts / 6), duration = clamp(f.errorDurationSeconds / 12)
    const worsening = f.trend === 'worsening' ? 1 : 0, improving = f.trend === 'improving' ? 1 : 0
    const failedCue = Math.min(1, this.failures.get('SWITCH_CUE') ?? 0)
    const failedSteps = Math.min(1, this.failures.get('SHOW_DECOMPOSITION') ?? 0)
    const raw = {
      CONTINUE_STANDARD: 65 - 22 * deficit - 16 * frequency - 10 * repetition - 12 * duration + 30 * improving + (f.stableSeconds >= 8 ? 20 : 0),
      SWITCH_CUE: 5 + 25 * deficit + 25 * frequency + 15 * repetition + 15 * duration + 10 * worsening - 35 * improving - 20 * failedCue,
      SHOW_DECOMPOSITION: 20 * deficit + 20 * frequency + 20 * repetition + 20 * duration + 35 * failedCue - 30 * failedSteps - 40 * improving,
      SUGGEST_PAUSE: 20 * deficit + 15 * frequency + 15 * repetition + 15 * duration + 10 * worsening
        + 20 * Math.min(2, f.ineffectiveInterventions) + (f.activeSeconds >= 180 ? 25 : 0) - 40 * improving,
    }
    return Object.fromEntries(STRATEGIES.map(s => [s, Math.round(clamp(raw[s], 0, 100) * 10) / 10])) as Record<InterventionStrategy, number>
  }
  private eligible(input: TrainingDecisionInput, f: LocalDecisionFeatures): InterventionStrategy[] {
    return STRATEGIES.filter(s => {
      if (s === 'CONTINUE_STANDARD') return true
      if (guardLocalStrategy(input, s) !== s) return false
      if (s !== this.selected && this.activeMs - (this.activations.get(s) ?? -Infinity) < LOCAL_POLICY.cooldownMs[s]) return false
      if (f.errorFrequency < .4 || f.errorDurationSeconds < 3) return false
      if (s === 'SWITCH_CUE') return true
      if (s === 'SHOW_DECOMPOSITION') return f.errorDurationSeconds >= 8 && (Boolean(this.failures.get('SWITCH_CUE')) || f.repeatedPrompts >= 3)
      return f.errorDurationSeconds >= 12 && Boolean(this.failures.get('SHOW_DECOMPOSITION')) && f.activeSeconds >= 180
    })
  }
  private reasons(f: LocalDecisionFeatures, selection: LocalDecisionExplanation['selection']): string[] {
    const reasons = [`近期同类问题占 ${Math.round(f.errorFrequency * 100)}%，窗口内约观察到 ${Math.round(f.errorDurationSeconds)} 秒。`]
    if (f.qualityScore !== null) reasons.push(`近期同阶段质量分约 ${Math.round(f.qualityScore)} 分。`)
    if (f.ineffectiveInterventions > 0) reasons.push('此前提示尚未产生明确改善，调整指导方式。')
    if (selection === 'cooldown') reasons.push('保持当前指导一段时间，给调整留下时间。')
    if (selection === 'hysteresis') reasons.push('候选策略差距较小，保持当前指导。')
    if (this.selected === 'SUGGEST_PAUSE') reasons.push('连续干预仍未改善，当前已回到可暂停位置。')
    return reasons
  }
  private result(features: LocalDecisionFeatures, reasons: string[], selection: LocalDecisionExplanation['selection'], safetyFallback: boolean,
    started: number, scores = this.score(features), eligible: InterventionStrategy[] = ['CONTINUE_STANDARD'], strategy = this.selected): TrainingDecision {
    const decision: TrainingDecision = { strategy, baseline: 'CONTINUE_STANDARD', source: 'local', reason: 'local',
      latencyMs: Math.max(0, performance.now() - started), safetyFallback,
      local: { strategyScores: scores, eligibleStrategies: eligible, features, reasons, selection } }
    this.lastDecision = decision
    return decision
  }
}
