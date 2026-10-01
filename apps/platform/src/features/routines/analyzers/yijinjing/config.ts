// 易筋经稳定性阈值。阈值为暂定值：参照示范者自身的数值设定，尚未用真人数据标定
export const YIJINJING_ANALYZER_CONFIG = Object.freeze({
  version: 'yijinjing-stability-v1',
  minSamples: 20,
  maxGapMs: 400,
  liveWindowMs: 6000,
  scalePercentile: 0.9,
  stillness: {
    /** 静止：腕、肩、髋中最快一点的逐帧速度低于此值（当前帧躯干长 / s，原始位置） */
    maxSpeed: 0.25,
    /** 示范者连续静止达到此时长为保持类，否则为过渡类；预备势、收势固定为保持类 */
    holdMinMs: 1500,
  },
  target: {
    /** 跟练略慢于视频，用户窗口在示范静止段后多留 */
    lagSeconds: 1,
    /** 目标姿态相似度达到此值视为到位 */
    reachSimilarity: 0.75,
    fullSimilarity: 0.85,
    zeroSimilarity: 0.55,
  },
  hold: {
    /** 保持时长 / 示范静止时长；窗口已多留 1 s，落后 1 s 以内仍为满分 */
    fullRatio: 0.9,
    zeroRatio: 0.4,
    /** 样本覆盖示范静止段不足此时长时不评保持（实时窗口可能只覆盖一部分） */
    minCoveredSeconds: 1,
  },
  /** 过渡类：整势的跟练相似度 */
  pose: { fullSimilarity: 0.85, zeroSimilarity: 0.55 },
  stability: {
    /** 抖动：位置相对 ±halfWidth 平均的 RMS，单位躯干长 */
    residualHalfWidth: 2,
    fullJitter: 0.015,
    zeroJitter: 0.035,
    /** 晃动（仅保持类）：保持期间肩、髋中心相对其均值的 RMS，单位躯干长 */
    fullSway: 0.04,
    zeroSway: 0.12,
  },
  weights: { pose: 0.4, hold: 0.25, stability: 0.35 },
})
