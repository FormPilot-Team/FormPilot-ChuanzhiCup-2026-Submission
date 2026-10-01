/**
 * Acceptance rule for every routine analyzer, checked by `tests/routine-analyzer-self-check.test.ts` on the standard
 * videos' own pose tracks (no recorded users yet):
 * - the demonstrator following their own video must score at least `demonstratorMinScore` in every scored chapter;
 * - each perturbation of that same sequence must lower the analyzer's mean score by at least `minPerturbationDrop`.
 * A metric that none of the perturbations moves has no discriminating power and is reported as such.
 */
export const ANALYZER_SELF_CHECK = Object.freeze({
  demonstratorMinScore: 80,
  minPerturbationDrop: 15,
  perturbations: Object.freeze({
    /** Gaussian noise on every landmark, standard deviation in torso lengths (isotropic in true proportions). */
    noise: Object.freeze({ sigmaTorso: 0.05, seed: 2026 }),
    /** Every landmark (and the hip centre's path) pulled towards the chapter's mean posture: movements at 0.6 × size. */
    amplitude: Object.freeze({ factor: 0.6 }),
    /**
     * Following late with stops: the user is `lagSeconds` behind and, every `cycleSeconds`, stands still for
     * `pauseSeconds` before catching up a little faster.
     */
    timing: Object.freeze({ lagSeconds: 2, cycleSeconds: 6, pauseSeconds: 1.5 }),
  }),
})
