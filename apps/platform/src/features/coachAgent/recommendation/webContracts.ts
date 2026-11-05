import type { CoachProfile, CoachQuestion, CoachRecommendationResult } from './types'

/** P0 accepts self-reported profiles only; evidence is never supplied by a caller. */
export interface CoachWebRequest {
  schemaVersion: 1
  source: 'rules' | 'synthetic'
  profile: CoachProfile
}

export interface CoachWebSource {
  mode: CoachWebRequest['source']
  synthetic: boolean
  label: string
  historyStatus: 'not_connected'
  decisionStatus: 'not_connected'
  recommendationMode: 'profile_rules'
}

export interface CoachWebDataResponse {
  schemaVersion: 1
  /** empty means ready with no candidates in any category. */
  status: CoachRecommendationResult['status'] | 'empty'
  source: CoachWebSource
  result: CoachRecommendationResult
  answers: Record<CoachQuestion, string>
  availability: Record<'routines' | 'chapters' | 'games', 'available' | 'empty'>
  evidenceStatus: 'missing' | 'synthetic'
  reportStatus: 'missing' | 'synthetic'
  error: null
}

export interface CoachWebErrorResponse {
  schemaVersion: 1
  status: 'error'
  source: null
  result: null
  answers: null
  availability: null
  evidenceStatus: null
  reportStatus: null
  error: {
    code: 'INVALID_REQUEST'
    message: string
  }
}

/** JSON-safe snapshot. Loading/idle and unexpected execution failures belong to the host UI. */
export type CoachWebResponse = CoachWebDataResponse | CoachWebErrorResponse
