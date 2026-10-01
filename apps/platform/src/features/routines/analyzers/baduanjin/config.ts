/**
 * 八段锦到位度 thresholds. All values are provisional (待标定): they were set so that the standard demonstration
 * scores full marks on its own pose track, not calibrated on recorded users.
 */
export const BADUANJIN_ANALYZER_CONFIG = Object.freeze({
  version: 'baduanjin-reach-v1',
  /** Fewer usable samples than this (≈ 2 s at 10 Hz) leave the chapter unevaluated. */
  minSamples: 20,
  /** Samples further apart than this are not one continuous movement (pause, lost pose). */
  maxGapMs: 400,
  /** Live view: long enough to contain one whole 托举 / 开弓 repetition. */
  liveWindowMs: 10_000,
  /** Robust body scale: this percentile of the 2D torso length (bending towards the camera shortens it). */
  scalePercentile: 0.9,
  /** Moving-average half width (samples) applied to trajectories before finding peaks. */
  smoothHalfWidth: 1,
  repetition: {
    /** Rest level and top level of the demonstrator's trajectory in the chapter (percentiles). */
    basePercentile: 0.1,
    topPercentile: 0.95,
    /** A repetition is a stretch above base + share × (top − base). */
    levelShare: 0.6,
    /** Shorter stretches are dips of tracking, not movements. */
    minSeconds: 1,
    /** A stretch starting this close to the chapter start is the previous form's ending. */
    startMarginSeconds: 0.3,
    /** The user's repetition is searched from this long before the demonstrator's rise … */
    leadSeconds: 1,
    /** … to this long after its fall (following lags the video a little). */
    lagSeconds: 1.5,
  },
  amplitude: {
    /** User excursion / demonstrator excursion: full marks at 0.9 × the demonstration, zero at half of it. */
    fullRatio: 0.9,
    zeroRatio: 0.5,
  },
  weights: {
    amplitude: { scored: 0.4, proxy: 0.1, 'phase-only': 0 },
  },
})
