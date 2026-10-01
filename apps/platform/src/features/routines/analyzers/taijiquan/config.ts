// 太极拳连续性阈值。阈值为暂定值：参照示范者自身的数值设定，尚未用真人数据标定
export const TAIJIQUAN_ANALYZER_CONFIG = Object.freeze({
  version: 'taijiquan-continuity-v1',
  minSamples: 20,
  maxGapMs: 400,
  liveWindowMs: 6000,
  scalePercentile: 0.9,
  /** 先对位置做 ±2 样本平均再求速度，跟踪抖动不算运动 */
  positionHalfWidth: 2,
  pose: {
    fullSimilarity: 0.9,
    zeroSimilarity: 0.6,
  },
  smoothness: {
    /** 抖动：腕、髋中心位置相对 ±halfWidth 平均的 RMS，按 1 s 分块取中位数，单位躯干长 */
    residualHalfWidth: 2,
    blockSamples: 10,
    fullJitter: 0.02,
    zeroJitter: 0.035,
  },
  extent: {
    /** 舒展度 = 用户路程 / 示范者在相同视频时刻的路程 */
    fullRatio: 0.9,
    zeroRatio: 0.5,
    maxRatio: 1.2,
  },
  pauses: {
    /** 平均速度低于此值（躯干长 / s）且持续 minStopSeconds，视为停顿 */
    stopSpeed: 0.1,
    minStopSeconds: 0.8,
    /** 只在示范者同一时刻的速度高于此值时计入 */
    demonstratorMovingSpeed: 0.2,
    fullShare: 0.03,
    zeroShare: 0.25,
  },
  weightShift: {
    /** 定势窗口：本式后段中示范者最慢的一段 */
    settleSeconds: 2,
    settleSearchShare: 0.6,
    /** 跟练略慢于视频，用户窗口向后多留 */
    lagSeconds: 1,
    /** 支撑比例：left < 0.4，right > 0.6，balanced 0.3–0.7 */
    leftBelow: 0.4,
    rightAbove: 0.6,
    balancedMin: 0.3,
    balancedMax: 0.7,
    /** transfer 式的穿越判定带（滞回） */
    crossLow: 0.35,
    crossHigh: 0.65,
    scoreShiftMinShare: 0.7,
    /** 方向类：用户窗口内与标注一致的帧比例 */
    fullShare: 0.7,
    zeroShare: 0.4,
    /** transfer 类：用户支撑比例范围（p90 − p10）/ 示范者范围 */
    fullRangeRatio: 0.85,
    zeroRangeRatio: 0.5,
    minKnownSamples: 5,
  },
  weights: { pose: 0.25, smoothness: 0.2, pauses: 0.2, extent: 0.15, weightShift: 0.2 },
})
