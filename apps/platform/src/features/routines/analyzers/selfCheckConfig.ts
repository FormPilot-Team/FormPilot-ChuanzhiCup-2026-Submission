// 自检验收：示范者跟练自己的视频，每个计分章节不低于 demonstratorMinScore；
// 每种扰动使平均分至少下降 minPerturbationDrop
export const ANALYZER_SELF_CHECK = Object.freeze({
  demonstratorMinScore: 80,
  minPerturbationDrop: 15,
  perturbations: Object.freeze({
    /** 每个关键点加高斯噪声，标准差以躯干长计 */
    noise: Object.freeze({ sigmaTorso: 0.05, seed: 2026 }),
    /** 关键点与髋中心轨迹向本章平均姿态收缩，动作幅度变为 0.6 倍 */
    amplitude: Object.freeze({ factor: 0.6 }),
    /** 落后 lagSeconds，并且每 cycleSeconds 先停 pauseSeconds 再加快追上 */
    timing: Object.freeze({ lagSeconds: 2, cycleSeconds: 6, pauseSeconds: 1.5 }),
  }),
})
