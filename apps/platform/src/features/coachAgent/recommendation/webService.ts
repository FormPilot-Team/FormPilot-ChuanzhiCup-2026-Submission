import { answerCoachQuestion, recommendCoach } from './engine'
import { createRecommendationDemo } from './fixtures'
import type { RecommendationContext } from './types'
import type { CoachWebRequest, CoachWebResponse } from './webContracts'

export type { CoachWebRequest, CoachWebResponse, CoachWebDataResponse, CoachWebErrorResponse } from './webContracts'

function isRequest(value: unknown): value is Omit<CoachWebRequest, 'profile'> & { profile: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return Object.keys(request).length === 3
    && Object.keys(request).every(key => ['schemaVersion', 'source', 'profile'].includes(key))
    && request.schemaVersion === 1
    && (request.source === 'rules' || request.source === 'synthetic')
}

/**
 * Synchronous, stateless Web entrypoint. Reuses the existing rule engine and fixed answers.
 * Does not read storage, accept client evidence, call a model, or retain a profile/result.
 */
export function getCoachWebRecommendation(request: unknown): CoachWebResponse {
  if (!isRequest(request)) return {
    schemaVersion: 1, status: 'error', source: null, result: null, answers: null,
    availability: null, evidenceStatus: null, reportStatus: null,
    error: { code: 'INVALID_REQUEST', message: '请求仅支持 schemaVersion: 1、source: rules/synthetic 和 profile；不接受历史、证据、模型输出或账号授权字段。' },
  }

  const synthetic = request.source === 'synthetic'
  const context: RecommendationContext = synthetic ? createRecommendationDemo() : {
    evidence: [], decisionStatus: 'not_connected',
    limitations: ['当前仅使用自述画像；未读取或接入真实用户训练、报告和游戏历史。'],
  }
  // A fixture decision illustrates a schema; it is never a connected StartLux runtime.
  context.decisionStatus = 'not_connected'
  const result = recommendCoach(request.profile, context)
  const availability = {
    routines: result.routines.length ? 'available' : 'empty',
    chapters: result.chapters.length ? 'available' : 'empty',
    games: result.games.length ? 'available' : 'empty',
  } as const
  const hasCandidates = [...result.routines, ...result.chapters, ...result.games].length > 0
  if (result.status === 'ready' && !hasCandidates) {
    result.message = '当前筛选下没有可用的功法、章节或游戏候选；不会补造或强行替换推荐。'
  }

  // Engine entries share the catalogue: return an isolated snapshot to Web consumers.
  return structuredClone({
    schemaVersion: 1,
    status: result.status === 'ready' && !hasCandidates ? 'empty' : result.status,
    source: {
      mode: request.source, synthetic,
      label: synthetic ? 'synthetic 合成演示；不代表本人历史、真实训练证据或模型推理。' : '自述画像的本地规则建议；未读取真实历史。',
      historyStatus: 'not_connected', decisionStatus: 'not_connected', recommendationMode: 'profile_rules',
    },
    result,
    answers: {
      suitable: answerCoachQuestion('suitable', result),
      first_game: answerCoachQuestion('first_game', result),
      recent_issues: answerCoachQuestion('recent_issues', result),
      why: answerCoachQuestion('why', result),
      next_focus: answerCoachQuestion('next_focus', result),
    },
    availability,
    evidenceStatus: result.evidence.length ? 'synthetic' : 'missing',
    reportStatus: result.evidence.some(item => item.category === 'report') ? 'synthetic' : 'missing',
    error: null,
  })
}
