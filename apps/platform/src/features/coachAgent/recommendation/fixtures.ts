import type { RecommendationContext } from './types'

/** Fixed presentation fixtures. No browser storage, model, network or claims about a real user. */
export function createRecommendationDemo(): RecommendationContext {
  const at = Date.UTC(2026, 10, 2, 8)
  return {
    decisionStatus: 'synthetic',
    evidence: [
      { id: 'synthetic:training:1', category: 'training', source: 'synthetic', title: '八段锦章节练习样例', detail: '人工构造已练过八段锦的场景；不是浏览器已有记录。', focuses: ['coordination', 'rhythm'], contentId: 'baduanjin', occurredAt: at, references: ['fixture:competition-ai-coach/training-v1'] },
      { id: 'synthetic:game:1', category: 'game', source: 'synthetic', title: '林间划船游玩样例', detail: '人工构造偏好左右交替游戏的场景；不是已接通的游戏历史。', focuses: ['coordination', 'rhythm'], contentId: 'boating', occurredAt: at, references: ['fixture:competition-ai-coach/game-v1'] },
      { id: 'synthetic:report:1', category: 'report', source: 'synthetic', title: '动作节奏待关注样例', detail: '用于演示报告分项如何参与推荐，不表示你的真实问题，不来自真人测试。', focuses: ['rhythm'], occurredAt: at, references: ['fixture:competition-ai-coach/report-v1'] },
      { id: 'synthetic:decision:1', category: 'decision', source: 'synthetic', title: 'StartLux 接口输出样例 · SHOW_DECOMPOSITION', detail: '人工固定的受守卫决策示意：先查看动作分解、熟悉配合；没有运行 StartLux 模型。', focuses: ['coordination'], occurredAt: at, references: ['fixture:competition-ai-coach/guarded-decision-v1'] },
    ],
    limitations: ['当前全部证据为 synthetic 合成样例；未读取任何真实训练、游戏或模型数据。', '游戏历史适配与真实 StartLux 模型尚未接入；此处只展示接口消费和本地规则推荐流程。'],
  }
}
