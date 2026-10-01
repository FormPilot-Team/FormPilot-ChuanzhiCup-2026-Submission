// 五禽戏五戏特征阈值。阈值为暂定值：参照示范者自身的数值设定，尚未用真人数据标定
export const WUQINXI_ANALYZER_CONFIG = Object.freeze({
  version: 'wuqinxi-profile-v1',
  minSamples: 20,
  maxGapMs: 400,
  /** 容纳一次虎举 / 鸟飞，并满足节律所需的 8 s */
  liveWindowMs: 10_000,
  scalePercentile: 0.9,
  smoothHalfWidth: 2,
  profile: {
    /** 范围 = 平滑后特征的 p95 − p5 */
    lowPercentile: 0.05,
    highPercentile: 0.95,
    /** 用户范围 / 示范者范围 */
    fullRatio: 0.9,
    zeroRatio: 0.5,
    maxRatio: 1.2,
    minFeatureSamples: 15,
  },
  pose: { fullSimilarity: 0.9, zeroSimilarity: 0.6 },
  rhythm: {
    /** 第一个特征与示范者做相关的滞后范围，s；正值表示偏晚 */
    minLagSeconds: -1,
    maxLagSeconds: 4,
    lagStepSeconds: 0.1,
    /** 最佳相关低于此值时节律无法读出（动作太少或噪声太大） */
    minCorrelation: 0.3,
    minSeconds: 8,
    lateToleranceSeconds: 1,
    earlyToleranceSeconds: 0.6,
    zeroExcessSeconds: 2,
  },
  steadiness: {
    /** 腕、鼻、肩中心残差 RMS 按 1 s 分块取中位数，单位躯干长 */
    residualHalfWidth: 2,
    blockSamples: 10,
    fullJitter: 0.02,
    zeroJitter: 0.04,
  },
  weights: { profile: 0.4, pose: 0.2, rhythm: 0.2, steadiness: 0.2 },
})
