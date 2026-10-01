/**
 * 八段锦到位度 thresholds. All values are provisional (待标定): they were set so that the standard demonstration
 * scores full marks on its own pose track and the self-check perturbations are told apart (see
 * ANALYZER_SELF_CHECK); they are not calibrated on recorded users.
 */
export const BADUANJIN_ANALYZER_CONFIG = Object.freeze({
  version: 'baduanjin-reach-v1',
  /** Fewer usable samples than this (≈ 2 s at 10 Hz) leave the chapter unevaluated. */
  minSamples: 20,
  /** Samples further apart than this are not one continuous movement (pause, lost pose). */
  maxGapMs: 400,
  /** Live view: long enough to contain one whole 托举 / 开弓 repetition (they repeat every ≈ 12–16 s). */
  liveWindowMs: 20_000,
  /** Robust body scale: this percentile of the 2D torso length (bending towards the camera shortens it). */
  scalePercentile: 0.9,
  /** Moving-average half width (samples) applied to trajectories before finding peaks. */
  smoothHalfWidth: 1,
  repetition: {
    /** Rest level and top level of a trajectory in the chapter (percentiles). */
    basePercentile: 0.1,
    topPercentile: 0.95,
    /** A demonstrator repetition is a stretch above base + share × (top − base). */
    levelShare: 0.6,
    /** Shorter stretches are dips of tracking, not movements. */
    minSeconds: 1,
    /** A stretch starting this close to the chapter start is the previous form's ending. */
    startMarginSeconds: 0.3,
    /** The user's repetition is searched from this long before the demonstrator's rise … */
    leadSeconds: 1,
    /** … to this long after its fall (following lags the video a little). */
    lagSeconds: 1.5,
    /** Fewer user samples than this inside a repetition's span leave it unobserved. */
    minSamples: 5,
  },
  amplitude: {
    /** User excursion / demonstrator excursion: full marks at 0.9 × the demonstration, zero at half of it. */
    fullRatio: 0.9,
    zeroRatio: 0.5,
    /** Larger ratios are capped so one big repetition cannot hide a small one. */
    maxRatio: 1.2,
  },
  /** A repetition counts as done when the user's own trajectory rises this share of their own range (amplitude-free). */
  phase: { riseShare: 0.5, fullShare: 1, zeroShare: 0.5 },
  timing: {
    /** Rise time = first moment above base + riseLevel × (this repetition's peak − base), for user and demonstrator alike. */
    riseLevel: 0.5,
    /** Following naturally lags: being up to 1 s late or 0.6 s early is in time (the matcher's tolerances). */
    lateToleranceSeconds: 1,
    earlyToleranceSeconds: 0.6,
    /** Mean time outside the tolerance at which the timing score reaches zero. */
    zeroExcessSeconds: 2,
  },
  steadiness: {
    /** The top hold of a repetition: samples above base + holdLevel × (peak − base). */
    holdLevel: 0.8,
    minHoldSamples: 5,
    /** Residual half width (samples): what moves faster than ≈ 0.5 s around its own average is jitter. */
    residualHalfWidth: 2,
    /** Median residual RMS of wrists, nose and shoulder centre, torso lengths: full marks at or below, zero at. */
    fullJitter: 0.02,
    zeroJitter: 0.045,
  },
  weights: {
    amplitude: { scored: 0.4, proxy: 0.1, 'phase-only': 0 },
    timing: 0.25,
    steadiness: 0.25,
    phases: 0.1,
  },
})
