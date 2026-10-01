// 八段锦到位度阈值。阈值为暂定值：参照示范者自身的数值设定，尚未用真人数据标定
export const BADUANJIN_ANALYZER_CONFIG = Object.freeze({
  version: 'baduanjin-reach-v1',
  /** 约 2 s（10 Hz） */
  minSamples: 20,
  /** 间隔更大则不算连续动作（暂停、丢失姿态） */
  maxGapMs: 400,
  /** 至少容纳一次完整的托举 / 开弓（约 12–16 s 一次） */
  liveWindowMs: 20_000,
  /** 身体朝镜头弯曲时二维躯干变短，取较高分位数作尺度 */
  scalePercentile: 0.9,
  smoothHalfWidth: 1,
  repetition: {
    basePercentile: 0.1,
    topPercentile: 0.95,
    /** 示范者的一次动作：高于 base + levelShare × (top − base) 的一段 */
    levelShare: 0.6,
    /** 更短的是跟踪抖动，不是动作 */
    minSeconds: 1,
    /** 太靠近章节开头的一段属于上一式的结尾 */
    startMarginSeconds: 0.3,
    leadSeconds: 1,
    /** 跟练通常略慢于视频，窗口向后多留一些 */
    lagSeconds: 1.5,
    minSamples: 5,
  },
  amplitude: {
    /** 用户幅度 / 示范幅度 */
    fullRatio: 0.9,
    zeroRatio: 0.5,
    /** 封顶，避免一次大动作掩盖一次小动作 */
    maxRatio: 1.2,
  },
  /** 用户相对自身范围升起一半即算完成一次，与幅度无关 */
  phase: { riseShare: 0.5, fullShare: 1, zeroShare: 0.5 },
  timing: {
    /** 升起时刻：首次超过 base + riseLevel × (peak − base)，用户与示范者同一算法 */
    riseLevel: 0.5,
    /** 晚 1 s、早 0.6 s 以内算同步，与跟练比对的容差一致 */
    lateToleranceSeconds: 1,
    earlyToleranceSeconds: 0.6,
    zeroExcessSeconds: 2,
  },
  steadiness: {
    /** 顶点保持段：高于 base + holdLevel × (peak − base) */
    holdLevel: 0.8,
    minHoldSamples: 5,
    /** 相对约 0.5 s 平均的残差视为抖动 */
    residualHalfWidth: 2,
    /** 腕、鼻、肩中心残差 RMS 的中位数，单位躯干长 */
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
