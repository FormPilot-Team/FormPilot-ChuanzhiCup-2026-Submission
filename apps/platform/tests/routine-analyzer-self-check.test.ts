import { describe, expect, it } from 'vitest'
import { ANALYZER_SELF_CHECK } from '../src/features/routines/analyzers/selfCheckConfig'
import type { RoutineId } from '../src/features/routines/types'
import { selfCheckRun, type SelfCheckCase } from './helpers/analyzerSelfCheck'

/**
 * Self-check of each routine analyzer on its standard video's own pose track (see ANALYZER_SELF_CHECK): the
 * demonstrator scores high in every chapter, and noise, smaller movements and late stop-and-go timing each lower
 * the mean clearly. Results are summarised in docs/ANALYZER_AUDIT.md.
 */
const ANALYZERS: ReadonlyArray<RoutineId> = ['baduanjin', 'taijiquan', 'wuqinxi']
const PERTURBATIONS: ReadonlyArray<Exclude<SelfCheckCase, 'demonstrator'>> = ['noise', 'amplitude', 'timing']

describe('routine analyzer self-check on the standard demonstration', () => {
  for (const id of ANALYZERS) {
    it(`${id}: the demonstrator scores ≥ ${ANALYZER_SELF_CHECK.demonstratorMinScore} in every scored chapter, and each perturbation lowers the mean by ≥ ${ANALYZER_SELF_CHECK.minPerturbationDrop}`, () => {
      const demonstrator = selfCheckRun(id, 'demonstrator')
      const scored = [...demonstrator.chapters.entries()].filter(([, evaluation]) => evaluation?.score !== null && evaluation?.score !== undefined)
      expect(scored.length).toBeGreaterThan(0)
      for (const [chapterId, evaluation] of scored) {
        expect(evaluation!.score, chapterId).toBeGreaterThanOrEqual(ANALYZER_SELF_CHECK.demonstratorMinScore)
      }
      for (const kind of PERTURBATIONS) {
        const perturbed = selfCheckRun(id, kind)
        expect(demonstrator.mean - perturbed.mean, `${id} ${kind}: ${demonstrator.mean.toFixed(1)} → ${perturbed.mean.toFixed(1)}`).toBeGreaterThanOrEqual(ANALYZER_SELF_CHECK.minPerturbationDrop)
      }
    }, 120_000)
  }
})
