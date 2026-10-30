import { describe, expect, it, vi } from 'vitest'
import type { RoutineTechniqueRecord } from '../src/features/scoring/routine/techniqueRecord'
import type {
  AgentToolResult, CoachIntervention, CoachValidationContext, MotionEvent, PlanCourseRef,
  ScoringEvidence, ToolInvocation, TrainingPlanDraft, TrainingSessionSummary, ValidationResult,
} from '../src/features/coachAgent/contracts'
import {
  validateAgentToolResult, validateCoachIntervention, validateMotionEvent, validateScoringEvidence,
  validateTrainingPlanDraft, validateTrainingSessionSummary,
} from '../src/features/coachAgent/validation'

// Fixed synthetic transport fixtures; these are not camera measurements or model results.
const NOW = 1_793_340_000_000
const SESSION_ID = 'synthetic-session'
const epoch = (value: number) => ({ domain: 'epoch-ms' as const, value })
const trainingTime = (value: number, clockId = 'synthetic-clock') => ({ domain: 'training-monotonic-ms' as const, clockId, value })
const videoTime = (value: number, clockId = 'synthetic-video') => ({ domain: 'video-seconds' as const, clockId, value })
const catalogue: PlanCourseRef[] = [
  { kind: 'warmup-course', id: 'electronic-coach-six-step', version: '1.0.0' },
  { kind: 'routine-program', id: 'baduanjin', version: '1.0.0' },
]
const invocation: ToolInvocation = { requestId: 'synthetic-request', tool: 'read_session' }

function envelope(id: string) {
  return {
    schemaVersion: 1 as const, id, recordedAt: epoch(NOW), confidence: 0.9,
    provenance: { source: 'synthetic' as const, mode: 'normal' as const, producer: 'rules' as const },
  }
}

function evidence(): ScoringEvidence {
  return {
    ...envelope('synthetic-evidence'), sessionId: SESSION_ID,
    subject: { kind: 'exercise', id: 'squat' }, recordRef: { id: SESSION_ID, version: '2' },
    window: { start: trainingTime(1_000), end: trainingTime(2_000) },
    score: {
      scoreKind: 'warmup-standard', scale: '0-100', status: 'available', value: 82,
      scoringVersion: 'scoring-v2.1', rulesVersion: { spec: 'engineering-v1', threshold: 'synthetic-threshold-v1' },
    },
    quality: { sampleCount: 3, observability: 'OBSERVABLE', evidenceLevel: 'C' },
    criterionIds: ['wu.squat.depth'],
  }
}

function context(records: ScoringEvidence[] = [evidence()]): CoachValidationContext {
  return { evidence: records, catalogue: structuredClone(catalogue) }
}

function event(): MotionEvent {
  return {
    ...envelope('synthetic-event'), sessionId: SESSION_ID, subject: { kind: 'exercise', id: 'squat' },
    occurredAt: trainingTime(1_500), eventKind: 'observation', repetitionIndex: null,
    feedback: null, evidenceRefs: ['synthetic-evidence'],
  }
}

function summary(): TrainingSessionSummary {
  return {
    ...envelope('synthetic-summary'), sessionId: SESSION_ID, recordRef: { id: SESSION_ID, version: '2' },
    kind: 'warmup', startedAt: epoch(NOW - 60_000), endedAt: epoch(NOW), status: 'completed',
    activeDurationMs: 45_000, completedReps: 3, evidence: [evidence()],
  }
}

function intervention(): CoachIntervention {
  return {
    ...envelope('synthetic-intervention'), sessionId: SESSION_ID, status: 'proposed',
    confirmation: 'required', executed: false, strategy: 'SUGGEST_PAUSE',
    explanation: 'Synthetic fixture: propose a pause; no controller is called.', evidenceRefs: ['synthetic-evidence'],
  }
}

function plan(): TrainingPlanDraft {
  return {
    ...envelope('synthetic-plan'), status: 'draft', confirmation: 'required', executed: false,
    courses: structuredClone(catalogue), rationale: 'Synthetic fixture: catalogue references only.',
    evidenceRefs: ['synthetic-evidence'],
  }
}

function toolResult(): AgentToolResult {
  return {
    ...envelope('synthetic-tool-result'), requestId: invocation.requestId,
    ok: true, tool: 'read_session', data: summary(), error: null,
  }
}

function expectRejected(result: ValidationResult<unknown>, code?: string): void {
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.errors.length).toBeGreaterThan(0)
    for (const error of result.errors) {
      expect(typeof error.path).toBe('string')
      expect(error.code.length).toBeGreaterThan(0)
      expect(error.message.trim().length).toBeGreaterThan(0)
    }
    if (code) expect(result.errors.some((error) => error.code === code)).toBe(true)
  }
}

type Validator = (value: unknown) => ValidationResult<unknown>
const contracts: Array<{ name: string; make: () => object; validate: Validator }> = [
  { name: 'ScoringEvidence', make: evidence, validate: validateScoringEvidence },
  { name: 'MotionEvent', make: event, validate: (value) => validateMotionEvent(value, context()) },
  { name: 'TrainingSessionSummary', make: summary, validate: validateTrainingSessionSummary },
  { name: 'CoachIntervention', make: intervention, validate: (value) => validateCoachIntervention(value, context()) },
  { name: 'TrainingPlanDraft', make: plan, validate: (value) => validateTrainingPlanDraft(value, context()) },
  { name: 'AgentToolResult', make: toolResult, validate: (value) => validateAgentToolResult(value, invocation, context()) },
]

describe.each(contracts)('$name transport boundary', ({ make, validate }) => {
  it('accepts a complete synthetic fixture without changing its meaning', () => {
    const input = make()
    expect(validate(input)).toEqual({ ok: true, value: input })
  })

  it.each([null, undefined, false, 42, 'not-a-contract', []])('rejects non-record input %s', (value) => {
    expectRejected(validate(value))
  })

  it('rejects unsupported schema versions and unknown fields', () => {
    expectRejected(validate({ ...make(), schemaVersion: 2 }), 'UNSUPPORTED_VERSION')
    expectRejected(validate({ ...make(), execute: true }))
  })

  it('does not default missing capture source or training mode to real normal training', () => {
    expectRejected(validate({ ...make(), provenance: { mode: 'normal', producer: 'rules' } }))
    expectRejected(validate({ ...make(), provenance: { source: 'synthetic', producer: 'rules' } }))
    expectRejected(validate({ ...make(), provenance: { source: 'live', mode: 'fast', producer: 'invented' } }))
  })

  it.each([-0.01, 1.01, NaN, Infinity])('rejects invalid confidence %s', (confidence) => {
    expectRejected(validate({ ...make(), confidence }))
  })

  it('requires a bounded id and an explicit finite epoch timestamp', () => {
    expectRejected(validate({ ...make(), id: '' }))
    expectRejected(validate({ ...make(), id: 'x'.repeat(129) }))
    expectRejected(validate({ ...make(), recordedAt: trainingTime(1_000) }))
    expectRejected(validate({ ...make(), recordedAt: epoch(NaN) }))
    expectRejected(validate({ ...make(), recordedAt: epoch(-1) }))
  })
})

describe('score evidence preserves the source and meaning of scores', () => {
  it('allows rules to process synthetic captures and keeps unknown metadata explicit', () => {
    const record = evidence()
    expect(validateScoringEvidence({ ...record, confidence: null, provenance: { source: 'unknown', mode: 'unknown', producer: 'repository' } }).ok).toBe(true)
    expect(validateScoringEvidence({ ...record, provenance: { ...record.provenance, producer: 'simulation' } }).ok).toBe(true)
  })

  it('rejects a model claiming to have produced measured evidence or a saved session', () => {
    const record = evidence()
    expectRejected(validateScoringEvidence({ ...record, provenance: { ...record.provenance, producer: 'model' } }))
    const session = summary()
    expectRejected(validateTrainingSessionSummary({ ...session, provenance: { ...session.provenance, producer: 'model' } }))
    const result = toolResult()
    expectRejected(validateAgentToolResult({ ...result, provenance: { ...result.provenance, producer: 'model' } }, invocation, context()))
  })

  it.each([-1, 101, NaN, Infinity])('rejects invalid 0–100 scores %s', (value) => {
    const record = evidence()
    expectRejected(validateScoringEvidence({ ...record, score: { ...record.score, value } }))
  })

  it.each([0, 100])('preserves an available boundary score %s as a score', (value) => {
    const record = evidence()
    expect(validateScoringEvidence({ ...record, score: { ...record.score, value } }).ok).toBe(true)
  })

  it('requires real record references, score versions and measured criteria for an available standard score', () => {
    const record = evidence()
    const invalid = [
      { ...record, recordRef: { ...record.recordRef, id: 'another-session' } },
      { ...record, score: { ...record.score, scoringVersion: '' } },
      { ...record, score: { ...record.score, rulesVersion: null } },
      { ...record, score: { ...record.score, rulesVersion: { spec: 'v1', threshold: '' } } },
      { ...record, criterionIds: [] },
      { ...record, quality: { ...record.quality, sampleCount: 0 } },
      { ...record, quality: { ...record.quality, sampleCount: 1.5 } },
      { ...record, quality: { ...record.quality, observability: 'NOT_OBSERVABLE' } },
    ]
    for (const value of invalid) expectRejected(validateScoringEvidence(value))
    expect(validateScoringEvidence({ ...record, quality: { ...record.quality, observability: 'PROXY' } }).ok).toBe(true)
  })

  it('keeps guidance and insufficient data separate from a numeric zero', () => {
    const record = evidence()
    const guidance: ScoringEvidence = {
      ...record, subject: { kind: 'exercise', id: 'shoulder_rotation' },
      score: { scoreKind: 'guidance', scale: 'none', status: 'guidance', value: null, scoringVersion: null, rulesVersion: null },
      criterionIds: [], quality: { sampleCount: 0, observability: 'NOT_OBSERVABLE', evidenceLevel: null },
    }
    expect(validateScoringEvidence(guidance).ok).toBe(true)
    expectRejected(validateScoringEvidence({ ...guidance, score: { ...guidance.score, value: 0 } }))
    expectRejected(validateScoringEvidence({ ...guidance, score: { ...guidance.score, scoringVersion: 'invented-score' } }))
    const unavailable = { ...record, score: { ...record.score, status: 'insufficient', value: null }, quality: { ...record.quality, sampleCount: 0 } }
    expect(validateScoringEvidence(unavailable).ok).toBe(true)
    expectRejected(validateScoringEvidence({ ...unavailable, score: { ...unavailable.score, value: 0 } }))
  })

  it('does not treat follow-along similarity as a standard score', () => {
    const record: ScoringEvidence = {
      ...evidence(), subject: { kind: 'routine', id: 'baduanjin' },
      window: { start: videoTime(12.5), end: videoTime(13.5) },
      score: { scoreKind: 'follow-along-similarity', scale: '0-1', status: 'available', value: 0.82, scoringVersion: 'matcher-v1', rulesVersion: null },
    }
    expect(validateScoringEvidence(record).ok).toBe(true)
    expectRejected(validateScoringEvidence({ ...record, score: { ...record.score, value: 82 } }))
    expectRejected(validateScoringEvidence({ ...record, score: { ...record.score, scale: '0-100' } }))
    expectRejected(validateScoringEvidence({ ...record, score: { ...record.score, rulesVersion: { spec: 'v1', threshold: 'v1' } } }))
    expectRejected(validateScoringEvidence({ ...record, subject: { kind: 'exercise', id: 'squat' } }))
  })

  it('preserves a routine technique record version without inventing warm-up rule versions', () => {
    // Real domain shape, synthetic values: RoutineTechniqueRecord does not store spec/threshold.
    const technique: RoutineTechniqueRecord = {
      version: 'scoring-v2.1', criteria: [{
        criterionId: 'bdj.1.elbow_extension', chapterId: 'synthetic-chapter',
        windows: [{ start: 12, end: 14, samples: 3, value: 162, score: 82 }],
      }],
    }
    const criterion = technique.criteria[0]
    const window = criterion.windows[0]
    const record: ScoringEvidence = {
      ...evidence(), subject: { kind: 'routine', id: 'baduanjin' },
      recordRef: { id: SESSION_ID, version: '1' },
      window: { start: videoTime(window.start), end: videoTime(window.end) },
      score: { scoreKind: 'routine-technique', scale: '0-100', status: 'available', value: window.score as number, scoringVersion: technique.version, rulesVersion: null },
      quality: { sampleCount: window.samples, observability: 'OBSERVABLE', evidenceLevel: 'C' },
      criterionIds: [criterion.criterionId],
    }
    expect(validateScoringEvidence(record)).toEqual({ ok: true, value: record })
    expectRejected(validateScoringEvidence({ ...record, score: { ...record.score, scoringVersion: null } }))
    expect(validateTrainingSessionSummary({ ...summary(), kind: 'routine', completedReps: null, evidence: [record] }).ok).toBe(true)
  })

  it('rejects mixed clocks, reversed windows, and non-finite time values', () => {
    const record = evidence()
    for (const window of [
      { start: trainingTime(1_000), end: epoch(NOW) },
      { start: trainingTime(1_000), end: trainingTime(2_000, 'other-clock') },
      { start: trainingTime(2_000), end: trainingTime(1_000) },
      { start: trainingTime(1_000), end: trainingTime(Infinity) },
    ]) expectRejected(validateScoringEvidence({ ...record, window }))
  })

  it('rejects epoch measurements after the evidence recording time', () => {
    const record = evidence()
    expectRejected(validateScoringEvidence({ ...record, window: { start: epoch(NOW), end: epoch(NOW + 1) } }))
    expect(validateScoringEvidence({ ...record, window: { start: epoch(NOW - 1), end: epoch(NOW) } }).ok).toBe(true)
  })
})

describe('motion events resolve evidence in the same training context', () => {
  it('uses different payloads for observations, repetitions and feedback', () => {
    expect(validateMotionEvent({ ...event(), eventKind: 'repetition', repetitionIndex: 1 }, context()).ok).toBe(true)
    expect(validateMotionEvent({ ...event(), eventKind: 'feedback', feedback: { kind: 'correction', code: 'DEPTH_INSUFFICIENT' } }, context()).ok).toBe(true)
    expectRejected(validateMotionEvent({ ...event(), eventKind: 'repetition' }, context()))
    expectRejected(validateMotionEvent({ ...event(), repetitionIndex: 1 }, context()))
    expectRejected(validateMotionEvent({ ...event(), eventKind: 'feedback' }, context()))
    expectRejected(validateMotionEvent({ ...event(), feedback: { kind: 'correction', code: 'DEPTH_INSUFFICIENT' } }, context()))
    expectRejected(validateMotionEvent({ ...event(), eventKind: 'repetition', repetitionIndex: 0 }, context()))
  })

  it.each(['BEHIND', 'AHEAD', 'MISMATCH', 'MISMATCH_ARMS', 'MISMATCH_TORSO', 'MISMATCH_LEGS', 'RECOVERED'])('preserves confirmed routine feedback %s in its own vocabulary', (code) => {
    const feedback = { kind: code === 'RECOVERED' ? 'recovery' : 'correction', code }
    const routine = { ...event(), subject: { kind: 'routine', id: 'baduanjin' }, eventKind: 'feedback', occurredAt: videoTime(13), feedback, evidenceRefs: [] }
    expect(validateMotionEvent(routine, context([])).ok).toBe(true)
    expectRejected(validateMotionEvent({ ...routine, subject: { kind: 'exercise', id: 'squat' } }, context([])))
  })

  it('rejects warm-up codes and unconfirmed routine states as routine corrections', () => {
    const routine = { ...event(), subject: { kind: 'routine', id: 'baduanjin' }, eventKind: 'feedback', occurredAt: videoTime(13), evidenceRefs: [] }
    for (const code of ['DEPTH_INSUFFICIENT', 'READING', 'CUE', 'FOLLOWING_WELL', 'RECOVERED', null]) {
      expectRejected(validateMotionEvent({ ...routine, feedback: { kind: 'correction', code } }, context([])))
    }
    expectRejected(validateMotionEvent({ ...routine, feedback: { kind: 'recovery', code: 'BEHIND' } }, context([])))
  })

  it('rejects missing, duplicate and mismatched evidence references', () => {
    expectRejected(validateMotionEvent(event(), context([])), 'MISSING_EVIDENCE')
    expectRejected(validateMotionEvent({ ...event(), evidenceRefs: ['synthetic-evidence', 'synthetic-evidence'] }, context()))
    expectRejected(validateMotionEvent({ ...event(), sessionId: 'other-session' }, context()))
    expectRejected(validateMotionEvent({ ...event(), subject: { kind: 'exercise', id: 'knee_raise' } }, context()))
    expectRejected(validateMotionEvent({ ...event(), provenance: { ...event().provenance, source: 'live' } }, context()))
    expectRejected(validateMotionEvent({ ...event(), provenance: { ...event().provenance, mode: 'fast' } }, context()))
  })

  it('requires the event and its evidence to share a clock and observation window', () => {
    expectRejected(validateMotionEvent({ ...event(), occurredAt: epoch(NOW) }, context()), 'TIME_DOMAIN_CONFLICT')
    expectRejected(validateMotionEvent({ ...event(), occurredAt: trainingTime(1_500, 'other-clock') }, context()), 'TIME_DOMAIN_CONFLICT')
    expectRejected(validateMotionEvent({ ...event(), occurredAt: trainingTime(999) }, context()))
    expectRejected(validateMotionEvent({ ...event(), occurredAt: trainingTime(2_001) }, context()))
    expect(validateMotionEvent({ ...event(), occurredAt: trainingTime(1_000) }, context()).ok).toBe(true)
    expect(validateMotionEvent({ ...event(), occurredAt: trainingTime(2_000) }, context()).ok).toBe(true)
  })

  it('rejects an epoch event or referenced evidence recorded in its future', () => {
    expectRejected(validateMotionEvent({ ...event(), evidenceRefs: [], occurredAt: epoch(NOW + 1) }, context([])))
    expectRejected(validateMotionEvent({ ...event(), recordedAt: epoch(NOW - 1) }, context()))
  })

  it('rejects corrupt or ambiguous evidence snapshots instead of trusting their ids', () => {
    expectRejected(validateMotionEvent(event(), context([evidence(), evidence()])))
    const corrupt = { ...evidence(), id: 'unused-corrupt-evidence', score: { ...evidence().score, value: NaN } }
    expectRejected(validateMotionEvent(event(), { ...context(), evidence: [evidence(), corrupt] }))
  })
})

describe('session summaries preserve persisted session semantics', () => {
  it('allows an active unfinished session and an honest empty evidence list', () => {
    expect(validateTrainingSessionSummary({ ...summary(), status: 'active', endedAt: null, activeDurationMs: null, completedReps: null, evidence: [] }).ok).toBe(true)
    expect(validateTrainingSessionSummary({ ...summary(), evidence: [] }).ok).toBe(true)
  })

  it('rejects missing final times, impossible elapsed duration and wrong time domains', () => {
    const session = summary()
    for (const value of [
      { ...session, endedAt: null },
      { ...session, endedAt: epoch(NOW - 60_001) },
      { ...session, startedAt: trainingTime(0) },
      { ...session, activeDurationMs: 60_001 },
      { ...session, activeDurationMs: -1 },
      { ...session, completedReps: 1.5 },
      { ...session, completedReps: -1 },
      { ...session, recordRef: { ...session.recordRef, id: 'other-session' } },
    ]) expectRejected(validateTrainingSessionSummary(value))
  })

  it('rejects evidence from another session, capture source, mode or score family', () => {
    const session = summary()
    const record = evidence()
    for (const foreign of [
      { ...record, sessionId: 'other-session', recordRef: { ...record.recordRef, id: 'other-session' } },
      { ...record, provenance: { ...record.provenance, source: 'live' } },
      { ...record, provenance: { ...record.provenance, mode: 'fast' } },
    ]) expectRejected(validateTrainingSessionSummary({ ...session, evidence: [foreign] }))
    expectRejected(validateTrainingSessionSummary({ ...session, kind: 'routine' }))
    expectRejected(validateTrainingSessionSummary({ ...session, evidence: [record, record] }))
  })
})

describe('coach proposals never grant permission to execute training changes', () => {
  it.each(['CONTINUE_STANDARD', 'SWITCH_CUE', 'SHOW_DECOMPOSITION', 'SUGGEST_PAUSE'])('allows the existing strategy %s only as a proposal', (strategy) => {
    expect(validateCoachIntervention({ ...intervention(), strategy }, context()).ok).toBe(true)
  })

  it('rejects executed, unconfirmed or unauthorized intervention payloads', () => {
    for (const value of [
      { ...intervention(), status: 'executed' },
      { ...intervention(), executed: true },
      { ...intervention(), confirmation: 'approved' },
      { ...intervention(), strategy: 'CHANGE_SCORING_THRESHOLD' },
      { ...intervention(), threshold: 120 },
    ]) expectRejected(validateCoachIntervention(value, context()))
    expectRejected(validateCoachIntervention({ ...intervention(), sessionId: 'other-session' }, context()))
    expectRejected(validateCoachIntervention(intervention(), context([])), 'MISSING_EVIDENCE')
    expectRejected(validateCoachIntervention({ ...intervention(), provenance: { ...intervention().provenance, source: 'live' } }, context()))
  })

  it('allows an unexecuted catalogue draft without pretending it has supporting history', () => {
    expect(validateTrainingPlanDraft({ ...plan(), evidenceRefs: [], confidence: null }, context([])).ok).toBe(true)
  })

  it('matches a draft course by kind, id and version against the supplied catalogue', () => {
    for (const courses of [
      [{ ...catalogue[0], id: 'invented-course' }],
      [{ ...catalogue[0], version: 'future-version' }],
      [{ ...catalogue[0], kind: 'routine-program' }],
      [{ ...catalogue[0], targetReps: 200 }],
    ]) expectRejected(validateTrainingPlanDraft({ ...plan(), courses }, context()))
    expectRejected(validateTrainingPlanDraft(plan(), { ...context(), catalogue: [] }))
    expectRejected(validateTrainingPlanDraft(plan(), context([])), 'MISSING_EVIDENCE')
  })

  it('rejects executable or dosage overrides regardless of the draft label', () => {
    for (const value of [
      { ...plan(), status: 'approved' },
      { ...plan(), executed: true },
      { ...plan(), confirmation: 'optional' },
      { ...plan(), steps: [{ exerciseId: 'squat', reps: 200 }] },
      { ...plan(), threshold: 120 },
      { ...plan(), command: 'resume' },
    ]) expectRejected(validateTrainingPlanDraft(value, context()))
  })
})

describe('tool results bind to a caller request without inventing successful data', () => {
  it('deeply validates each of the four read/draft result types', () => {
    const base = toolResult()
    const cases = [
      { tool: 'read_session' as const, data: summary() },
      { tool: 'read_history' as const, data: [summary()] },
      { tool: 'read_scoring_evidence' as const, data: [evidence()] },
      { tool: 'draft_plan' as const, data: plan() },
    ]
    for (const item of cases) {
      const expected = { ...invocation, tool: item.tool }
      expect(validateAgentToolResult({ ...base, ...item }, expected, context()).ok).toBe(true)
      expectRejected(validateAgentToolResult({ ...base, ...item, data: { fabricatedScore: 99 } }, expected, context()))
    }
    expectRejected(validateAgentToolResult({ ...base, data: { ...summary(), evidence: [{ ...evidence(), score: { ...evidence().score, value: 101 } }] } }, invocation, context()))
  })

  it('binds both request id and tool and denies control tools', () => {
    expectRejected(validateAgentToolResult({ ...toolResult(), requestId: 'other-request' }, invocation, context()))
    expectRejected(validateAgentToolResult(toolResult(), { ...invocation, tool: 'read_history' }, context()))
    expectRejected(validateAgentToolResult({ ...toolResult(), tool: 'resume_training' }, invocation, context()))
  })

  it('preserves payload provenance rather than relabelling synthetic or unknown data as live', () => {
    const base = toolResult()
    for (const tool of ['read_session', 'read_history', 'read_scoring_evidence', 'draft_plan'] as const) {
      const data = tool === 'read_session' ? summary() : tool === 'read_history' ? [summary()] : tool === 'read_scoring_evidence' ? [evidence()] : plan()
      const expected = { ...invocation, tool }
      expectRejected(validateAgentToolResult({ ...base, tool, data, provenance: { ...base.provenance, source: 'live' } }, expected, context()))
      expectRejected(validateAgentToolResult({ ...base, tool, data, provenance: { ...base.provenance, mode: 'fast' } }, expected, context()))
      expect(validateAgentToolResult({ ...base, tool, data, provenance: { ...base.provenance, source: 'unknown', mode: 'unknown' } }, expected, context()).ok).toBe(true)
      expectRejected(validateAgentToolResult({ ...base, tool, data, recordedAt: epoch(NOW - 1) }, expected, context()))
    }
    const unknown = { ...summary(), evidence: [], provenance: { ...summary().provenance, source: 'unknown' } }
    expectRejected(validateAgentToolResult({ ...base, data: unknown }, invocation, context()))
  })

  it('preserves successful empty history and explicit not-found failures as different outcomes', () => {
    const base = toolResult()
    expect(validateAgentToolResult({ ...base, tool: 'read_history', data: [] }, { ...invocation, tool: 'read_history' }, context([])).ok).toBe(true)
    const missing = { ...base, ok: false, data: null, error: { code: 'NOT_FOUND', message: 'No such synthetic training record.', retryable: false } }
    expect(validateAgentToolResult(missing, invocation, context()).ok).toBe(true)
    expectRejected(validateAgentToolResult({ ...missing, data: summary() }, invocation, context()))
    expectRejected(validateAgentToolResult({ ...base, data: null }, invocation, context()))
    expectRejected(validateAgentToolResult({ ...base, error: missing.error }, invocation, context()))
  })

  it.each(['INSUFFICIENT_DATA', 'INVALID_INPUT', 'UNSUPPORTED_VERSION', 'PERMISSION_DENIED', 'NOT_ALLOWED', 'TIMEOUT', 'UNAVAILABLE'])('represents %s without score or session fallback data', (code) => {
    const failure = { ...toolResult(), ok: false, data: null, error: { code, message: 'Synthetic failure fixture.', retryable: code === 'TIMEOUT' } }
    expect(validateAgentToolResult(failure, invocation, context()).ok).toBe(true)
    expectRejected(validateAgentToolResult({ ...failure, data: [] }, invocation, context()))
  })

  it('rejects malformed failure semantics', () => {
    for (const error of [null, { code: 'SUCCESS', message: 'ok', retryable: false }, { code: 'NOT_FOUND', message: '', retryable: false }, { code: 'TIMEOUT', message: 'timeout', retryable: 'yes' }]) {
      expectRejected(validateAgentToolResult({ ...toolResult(), ok: false, data: null, error }, invocation, context()))
    }
  })
})

describe('bounded and pure validation', () => {
  it('bounds reference, evidence, history and plan arrays before accepting payloads', () => {
    expectRejected(validateMotionEvent({ ...event(), evidenceRefs: Array.from({ length: 65 }, (_, index) => `evidence-${index}`) }, context()))
    expectRejected(validateTrainingSessionSummary({ ...summary(), evidence: Array.from({ length: 257 }, (_, index) => ({ ...evidence(), id: `evidence-${index}` })) }))
    expectRejected(validateAgentToolResult({ ...toolResult(), tool: 'read_history', data: Array.from({ length: 65 }, (_, index) => ({ ...summary(), id: `summary-${index}` })) }, { ...invocation, tool: 'read_history' }, context()))
    expectRejected(validateTrainingPlanDraft({ ...plan(), courses: Array.from({ length: 17 }, () => catalogue[0]) }, context()))
  })

  it('rejects nested unknown fields, inherited records, accessors and sparse arrays', () => {
    const record = evidence()
    expectRejected(validateScoringEvidence({ ...record, recordRef: { ...record.recordRef, trusted: true } }))
    expectRejected(validateScoringEvidence({ ...record, score: { ...record.score, officialScore: true } }))
    expectRejected(validateScoringEvidence(Object.assign(Object.create({ execute: true }), record)))
    const getter = vi.fn(() => 1)
    const accessor = { ...record }
    Object.defineProperty(accessor, 'schemaVersion', { enumerable: true, get: getter })
    expectRejected(validateScoringEvidence(accessor))
    expect(getter).not.toHaveBeenCalled()
    expectRejected(validateTrainingSessionSummary({ ...summary(), evidence: new Array(1) }))
  })

  it('accepts deeply frozen inputs and snapshots deterministically without mutation', () => {
    function freeze<T>(value: T): T {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
      }
      return value
    }
    const snapshot = freeze(context())
    const expectedSnapshot = structuredClone(snapshot)
    const request = freeze(structuredClone(invocation))
    const checks: Array<[object, Validator]> = [
      [evidence(), validateScoringEvidence],
      [event(), (value) => validateMotionEvent(value, snapshot)],
      [summary(), validateTrainingSessionSummary],
      [intervention(), (value) => validateCoachIntervention(value, snapshot)],
      [plan(), (value) => validateTrainingPlanDraft(value, snapshot)],
      [toolResult(), (value) => validateAgentToolResult(value, request, snapshot)],
    ]
    for (const [value, validate] of checks) {
      const expected = structuredClone(value)
      freeze(value)
      const first = validate(value)
      expect(first).toEqual({ ok: true, value: expected })
      expect(validate(value)).toEqual(first)
      expect(value).toEqual(expected)
    }
    expect(snapshot).toEqual(expectedSnapshot)
    expect(request).toEqual(invocation)
  })
})
