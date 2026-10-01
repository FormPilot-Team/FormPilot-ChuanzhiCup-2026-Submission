/**
 * 评分依据: the short, user-facing account of where FormPilot's scores come from (Home → 评分依据). Three layers, in
 * the order a score is built: official material defines the movement, machine metrics measure it, FormPilot's own
 * calibration turns measurements into points. The full criterion and source registry stays in ./sources and
 * docs/scoring/SCORING_V2.md; this text only summarises it and must never claim more than the registry does.
 */

export interface ScoringBasisSource {
  /** Who publishes it. */
  name: string
  /** What FormPilot takes from it. */
  detail: string
}

/** The one sentence that must always be shown: official material ≠ FormPilot's numbers. */
export const SCORING_CALIBRATION_STATEMENT = '官方资料用于定义动作规范；具体角度阈值、容差和分数映射属于 FormPilot 工程标定值，并非国家标准直接规定的分数。'

export const SCORING_BASIS = Object.freeze({
  title: '评分依据',
  lead: '每个分数都分三层得出：官方资料定义“动作该怎么做”，机器指标衡量“你做得怎么样”，FormPilot 标定把测量结果换算成分数。',
  standards: {
    title: '动作规范来源',
    intro: '动作要点和常见错误来自这些官方或权威资料：',
    sources: [
      { name: '国家体育总局科学健身指导', detail: '《全民健身指南》及总局网站的热身、深蹲、侧平举等练习指导，用于热身训练的动作要点。' },
      { name: 'T/CACM 1676—2026 / T/CHQA 0001—2026《八段锦》', detail: '中华中医药学会、中国健身气功协会发布的团体标准，用于八段锦各式的动作过程与定势。' },
      { name: '国家体育总局健身气功管理中心', detail: '八段锦、五禽戏、易筋经的习惯性错误及纠正方法，机器检查项优先由这些错误转化而来。' },
      { name: '中国健身气功协会', detail: '健身气功功法的基本功、动作要求与易犯错误。' },
      { name: '二十四式简化太极拳官方审定体系', detail: '太极拳二十四式的动作名称、顺序与规格（如立身中正、屈膝步型）。' },
    ] satisfies ReadonlyArray<ScoringBasisSource>,
  },
  metrics: {
    title: '机器分析指标',
    intro: '摄像头识别身体关键点后，FormPilot 计算这些指标：',
    items: ['关节角度', '动作幅度', '左右协调 / 对称', '躯干稳定', '轨迹', '节奏', '跟练相似度'],
    research: '指标设计参考国内人体姿态估计、动作质量评价相关研究（如太极拳动作质量评估、康复训练动作分割与评估）。跟练相似度与动作规范检查分开显示，不合成一个分数。',
  },
  calibration: {
    title: 'FormPilot 标定',
    statement: SCORING_CALIBRATION_STATEMENT,
    example: '例如“肘部角度达到 150° 记满分”这样的数值，是 FormPilot 根据标准示范视频和测试数据标定的工程值，不是国家标准规定的分数线。',
    note: '评分只用于训练参考，不作医疗或康复诊断。',
  },
})
