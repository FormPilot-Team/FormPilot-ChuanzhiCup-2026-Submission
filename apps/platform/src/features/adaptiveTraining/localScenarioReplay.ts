import { LocalAdaptiveDecisionEngine } from './LocalAdaptiveDecisionEngine.ts'
import { DECISION_SCENARIOS, NORMAL_INPUT, type DecisionScenario } from './scenarios.ts'
import type { TrainingDecisionInput, InterventionStrategy } from './protocol.ts'

// Explicit engineering expectations for constructed timelines. These are not human exercise trials or training labels.
export const LOCAL_EXPECTATIONS: Record<string, InterventionStrategy> = {
  normal: 'CONTINUE_STANDARD', occasional: 'CONTINUE_STANDARD', switch: 'SWITCH_CUE', decomposition: 'SHOW_DECOMPOSITION',
  persistent: 'SHOW_DECOMPOSITION', pause: 'SUGGEST_PAUSE', recovered: 'CONTINUE_STANDARD', stable: 'CONTINUE_STANDARD',
  completed: 'CONTINUE_STANDARD', 'pose-missing': 'CONTINUE_STANDARD', 'out-of-frame': 'CONTINUE_STANDARD', paused: 'CONTINUE_STANDARD',
  preparing: 'CONTINUE_STANDARD', 'knee-priority': 'CONTINUE_STANDARD', severe: 'CONTINUE_STANDARD',
  'pause-moving': 'SHOW_DECOMPOSITION', 'pause-early': 'SHOW_DECOMPOSITION', 'switch-early': 'CONTINUE_STANDARD',
  'split-early': 'SWITCH_CUE', 'recovery-stale': 'CONTINUE_STANDARD', arms: 'SWITCH_CUE', coordination: 'SHOW_DECOMPOSITION',
  'request-failure': 'SHOW_DECOMPOSITION', 'request-timeout': 'SHOW_DECOMPOSITION', 'illegal-result': 'SHOW_DECOMPOSITION',
}
export interface LocalScenarioFrame { at: number; input: TrainingDecisionInput; interventionExpected: boolean }
const repeated = { ...NORMAL_INPUT, score: 58, errors: [{ code: 'DEPTH_INSUFFICIENT' as const, severity: .4 }], consecutiveErrors: 3, feedbackResponse: 'not_corrected' as const }
const occasionalIds = ['occasional', 'switch-early']
const recoveryIds = ['recovered', 'recovery-stale']

export function buildLocalScenarioFrames(scenario: DecisionScenario): LocalScenarioFrame[] {
  const { id } = scenario
  const length = id === 'pause' ? 36 : ['switch', 'split-early', 'arms'].includes(id) ? 8
    : occasionalIds.includes(id) ? 12 : ['recovered', 'stable'].includes(id) ? 30 : 24
  const frames: LocalScenarioFrame[] = []
  for (let t = 0; t <= length; t++) {
    let input: TrainingDecisionInput = structuredClone(scenario.input)
    if (occasionalIds.includes(id) && t < length) input = structuredClone(NORMAL_INPUT)
    if (recoveryIds.includes(id)) {
      input = t < 20 ? structuredClone(repeated) : { ...input, feedbackResponse: 'corrected', score: id === 'recovered' ? 92 : input.score }
    }
    if (scenario.fault) input = structuredClone(repeated)
    input.history = { ...input.history, activeSeconds: input.elapsedSeconds + t }
    input.elapsedSeconds += t
    frames.push({ at: t * 1000, input, interventionExpected: input.errors.length > 0 && input.poseValid
      && input.trainingState === 'ACTIVE' && input.feedbackResponse !== 'corrected' && !occasionalIds.includes(id)
      && input.completion < 1 && !input.errors.some(e => e.severity >= .8 || e.code === 'KNEE_VALGUS') })
  }
  return frames
}

export function replayLocalScenario(id: string) {
  const scenario = DECISION_SCENARIOS.find(s => s.id === id)
  if (!scenario) throw new Error('Unknown local scenario')
  const frames = buildLocalScenarioFrames(scenario)
  const engine = new LocalAdaptiveDecisionEngine()
  const decisions = frames.map(frame => engine.decide(frame.input, frame.at))
  return { scenario, frames, decisions, input: frames.at(-1)!.input, decision: decisions.at(-1)! }
}
