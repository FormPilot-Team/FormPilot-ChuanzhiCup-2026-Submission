import { useEffect, useRef, useState } from 'react'
import { LocalAdaptiveDecisionEngine, guardLocalStrategy, localSafetyReason } from './LocalAdaptiveDecisionEngine'
import { ruleBaseline } from './decisionPolicy'
import { TrainingDecisionObserver, type DecisionObservation } from './TrainingDecisionObserver'
import type { TrainingDecisionInput } from './protocol'

export function useAdaptiveTraining(observation: DecisionObservation) {
  const latest = useRef(observation)
  latest.current = observation
  const [decision, setDecision] = useState(() => ruleBaseline())
  const [input, setInput] = useState<TrainingDecisionInput>()
  useEffect(() => {
    const observer = new TrainingDecisionObserver()
    const engine = new LocalAdaptiveDecisionEngine()
    const sample = () => {
      const next = observer.observe(latest.current, performance.now())
      setInput(next)
      setDecision(engine.decide(next))
    }
    sample()
    const timer = setInterval(sample, 1000)
    return () => { clearInterval(timer); engine.reset() }
  }, [])
  // Render-time guard also removes old interventions immediately on pose loss/pause, before the next 1 Hz sample.
  const currentInput = input ? {
    ...input, exerciseId: observation.exerciseId, phase: observation.phase, poseValid: observation.poseValid,
    trainingState: observation.trainingState, errors: observation.errors, completion: observation.completion,
    poseReliability: observation.poseReliability, score: observation.score,
  } : undefined
  const sameExercise = input?.exerciseId === observation.exerciseId
  const sameIssue = input?.errors[0]?.code === observation.errors[0]?.code
  const strategy = currentInput && sameExercise && sameIssue ? guardLocalStrategy(currentInput, decision.strategy) : 'CONTINUE_STANDARD'
  return {
    input: currentInput,
    decision: strategy === decision.strategy && sameExercise && sameIssue && currentInput && !localSafetyReason(currentInput) ? decision : {
      ...decision, strategy: 'CONTINUE_STANDARD' as const, source: 'local' as const, reason: 'local' as const, safetyFallback: true,
      local: decision.local ? { ...decision.local, selection: 'safety' as const,
        reasons: [currentInput ? localSafetyReason(currentInput) ?? '当前动作问题已改变，重新评估。' : '等待可靠训练数据。'] } : undefined,
    },
  }
}
