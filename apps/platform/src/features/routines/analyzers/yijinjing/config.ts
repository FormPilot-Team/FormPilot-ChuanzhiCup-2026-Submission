/**
 * 易筋经稳定性 thresholds. Provisional (待标定): set so that the standard demonstration scores full marks on its own
 * pose track and the self-check perturbations are told apart; not calibrated on recorded users.
 */
export const YIJINJING_ANALYZER_CONFIG = Object.freeze({
  version: 'yijinjing-stability-v1',
  minSamples: 20,
  maxGapMs: 400,
  /** Live view: one hold. */
  liveWindowMs: 6000,
  scalePercentile: 0.9,
  stillness: {
    /**
     * Still = the fastest of wrists, shoulders and hips moves slower than this, in torso lengths of the current frame
     * per second, from one sample to the next (raw positions). This is the measurement the stage-0 audit used and the
     * hold rule was decided on; a stretch lasts from the start of its first still step to the end of its last.
     */
    maxSpeed: 0.25,
    /**
     * A 势 whose demonstrator holds still for at least this long is a hold (保持类); otherwise a transition
     * (过渡类). 预备势 and 收势 are holds by definition.
     */
    holdMinMs: 1500,
  },
  target: {
    /** The user's window around the demonstrator's longest still stretch stays open this long after it (following lags). */
    lagSeconds: 1,
    /** At or above this target similarity the user is in the target pose. */
    reachSimilarity: 0.75,
    /** Mean target similarity in the window: full marks at 0.85, zero at 0.55. */
    fullSimilarity: 0.85,
    zeroSimilarity: 0.55,
  },
  hold: {
    /**
     * Longest still-and-in-pose stretch / the demonstrator's still stretch: full marks at 0.9, zero at 0.4. The window
     * already stays open 1 s longer than the demonstrator's stretch, so following up to 1 s late keeps full marks.
     * (First set at 0.8 / 0.3: following 2–3.5 s late then cost only 12 points over the routine — self-check.)
     */
    fullRatio: 0.9,
    zeroRatio: 0.4,
    /** The samples must cover at least this much of the demonstrator's hold to judge it (the live window may not). */
    minCoveredSeconds: 1,
  },
  /** Transitions: mean follow-along similarity over the 势. */
  pose: { fullSimilarity: 0.85, zeroSimilarity: 0.55 },
  stability: {
    /** Jitter = RMS of positions around their ±halfWidth average (torso lengths): high-frequency shaking. */
    residualHalfWidth: 2,
    fullJitter: 0.015,
    zeroJitter: 0.035,
    /** Sway (holds only) = RMS of the shoulder and hip centres around their own mean in the hold (torso lengths). */
    fullSway: 0.04,
    zeroSway: 0.12,
  },
  weights: { pose: 0.4, hold: 0.25, stability: 0.35 },
})
