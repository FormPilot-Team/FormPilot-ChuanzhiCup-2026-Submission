/**
 * 太极拳连续性 thresholds. Provisional (待标定): set so that the standard demonstration scores full marks on its own
 * pose track and the self-check perturbations are told apart; not calibrated on recorded users.
 */
export const TAIJIQUAN_ANALYZER_CONFIG = Object.freeze({
  version: 'taijiquan-continuity-v1',
  minSamples: 20,
  maxGapMs: 400,
  /** Live view: a few seconds of movement, enough to see a stop or a jerk. */
  liveWindowMs: 6000,
  scalePercentile: 0.9,
  /** Positions are averaged over ±2 samples before speeds are taken (tracking jitter is not movement). */
  positionHalfWidth: 2,
  pose: {
    /** Mean follow-along similarity: full marks at 90 %, zero at 60 %. */
    fullSimilarity: 0.9,
    zeroSimilarity: 0.6,
  },
  smoothness: {
    /**
     * Jitter = median over 1 s blocks and over the wrists / hip centre of the RMS of positions around their own
     * ±halfWidth average (torso lengths). The demonstrator's tracked pose stays ≤ 0.019 in every form.
     * (A speed-fluctuation measure was tried first and dropped: it did not separate any self-check perturbation.)
     */
    residualHalfWidth: 2,
    blockSamples: 10,
    fullJitter: 0.02,
    zeroJitter: 0.035,
  },
  extent: {
    /** 舒展度 = the user's path / the demonstrator's path over the same video moments (positions averaged ±2). */
    fullRatio: 0.9,
    zeroRatio: 0.5,
    maxRatio: 1.2,
  },
  pauses: {
    /** Below this mean speed (torso lengths / s) the body has stopped … */
    stopSpeed: 0.1,
    /** … for at least this long (a 太极 form never really stops) … */
    minStopSeconds: 0.8,
    /** … while the demonstrator at the same video time moves at least this fast. */
    demonstratorMovingSpeed: 0.2,
    /** Share of the demonstrator's moving time spent stopped: full marks at or below, zero at. */
    fullShare: 0.03,
    zeroShare: 0.25,
  },
  weightShift: {
    /** 定势窗口: the demonstrator's slowest stretch of this length in the last share of the form. */
    settleSeconds: 2,
    settleSearchShare: 0.6,
    /** The user's window stays open this long after the demonstrator's (following lags a little). */
    lagSeconds: 1,
    /** Support ratio bands: left < 0.4, right > 0.6, balanced 0.3–0.7. */
    leftBelow: 0.4,
    rightAbove: 0.6,
    balancedMin: 0.3,
    balancedMax: 0.7,
    /** Crossing bands for transfers (hysteresis). */
    crossLow: 0.35,
    crossHigh: 0.65,
    /** The rule for scoreShift (see steps.ts). */
    scoreShiftMinShare: 0.7,
    /** Directional forms: share of the user's window frames agreeing with the label. */
    fullShare: 0.7,
    zeroShare: 0.4,
    /** Transfer forms: user support-ratio range (p90 − p10) / demonstrator range. */
    fullRangeRatio: 0.85,
    zeroRangeRatio: 0.5,
    minKnownSamples: 5,
  },
  weights: { pose: 0.25, smoothness: 0.2, pauses: 0.2, extent: 0.15, weightShift: 0.2 },
})
