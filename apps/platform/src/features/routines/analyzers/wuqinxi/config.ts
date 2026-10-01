/**
 * 五禽戏五戏特征 thresholds. Provisional (待标定): set so that the standard demonstration scores full marks on its own
 * pose track and the self-check perturbations are told apart; not calibrated on recorded users.
 */
export const WUQINXI_ANALYZER_CONFIG = Object.freeze({
  version: 'wuqinxi-profile-v1',
  minSamples: 20,
  maxGapMs: 400,
  /** Live view: long enough for one 虎举 / 鸟飞 cycle. */
  liveWindowMs: 8000,
  scalePercentile: 0.9,
  /** Feature series are averaged over ±2 samples before taking their range. */
  smoothHalfWidth: 2,
  profile: {
    /** Range = p95 − p5 of the smoothed feature over the form. */
    lowPercentile: 0.05,
    highPercentile: 0.95,
    /** User range / demonstrator range: full marks at 0.9, zero at 0.5. */
    fullRatio: 0.9,
    zeroRatio: 0.5,
    maxRatio: 1.2,
    /** Fewer visible samples of a feature leave it unmeasured. */
    minFeatureSamples: 15,
  },
  pose: { fullSimilarity: 0.9, zeroSimilarity: 0.6 },
  rhythm: {
    /** The first feature is correlated with the demonstrator's at lags in this range (s, positive = late). */
    minLagSeconds: -1,
    maxLagSeconds: 4,
    lagStepSeconds: 0.1,
    /** Below this best correlation the rhythm is not readable (too little movement or too noisy). */
    minCorrelation: 0.3,
    /** At least this much of the form must be followed to read a rhythm. */
    minSeconds: 8,
    lateToleranceSeconds: 1,
    earlyToleranceSeconds: 0.6,
    zeroExcessSeconds: 2,
  },
  steadiness: {
    /** Median over 1 s blocks of the residual RMS of wrists, nose and shoulder centre (torso lengths). */
    residualHalfWidth: 2,
    blockSamples: 10,
    fullJitter: 0.02,
    zeroJitter: 0.04,
  },
  weights: { profile: 0.4, pose: 0.2, rhythm: 0.2, steadiness: 0.2 },
})
