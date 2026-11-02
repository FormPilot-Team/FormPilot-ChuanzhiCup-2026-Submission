import type { RoutineId } from '../../routines/types'

export type Focus = 'reach' | 'stability' | 'coordination' | 'rhythm' | 'general'
export type BodyRegion = 'shoulders' | 'neck' | 'arms' | 'trunk' | 'legs'
export interface CoachProfile {
  version: 1
  goals: Array<'mobility' | 'upper_limb' | 'daily' | 'rehab_support'>
  difficulties: Array<'stiffness' | 'reach_difficulty' | 'soreness' | 'sedentary' | 'none'>
  regions: BodyRegion[]
  preference: 'routine' | 'game' | 'mixed'
  risk: 'none' | 'acute_pain' | 'dizziness' | 'recent_injury'
  acknowledged: boolean
}
export interface KnowledgeEntry {
  id: string
  kind: 'routine' | 'chapter' | 'game'
  title: string
  programId?: RoutineId
  chapterId?: string
  regions: BodyRegion[]
  focuses: Focus[]
  movement: string
  caution: Array<'overhead' | 'balance' | 'twist' | 'bending' | 'weight_bearing'>
  verification: 'project_verified' | 'pending'
  sources: string[]
  href: string | null
}
export interface CoachEvidence {
  id: string
  category: 'training' | 'game' | 'report' | 'decision'
  source: 'live' | 'synthetic'
  title: string
  detail: string
  focuses: Focus[]
  contentId?: string
  occurredAt: number
  references: string[]
}
export interface RecommendationContext {
  evidence: CoachEvidence[]
  limitations: string[]
  decisionStatus: 'not_connected' | 'rules' | 'startlux' | 'synthetic'
}
export interface CoachRecommendation {
  entry: KnowledgeEntry
  reasons: string[]
  evidenceIds: string[]
  basis: 'profile_rules' | 'live_and_rules' | 'synthetic_and_rules'
}
export type CoachQuestion = 'suitable' | 'first_game' | 'recent_issues' | 'why' | 'next_focus'
export interface CoachRecommendationResult {
  status: 'ready' | 'profile_required' | 'safety_hold'
  message: string
  routines: CoachRecommendation[]
  chapters: CoachRecommendation[]
  games: CoachRecommendation[]
  focus: Focus[]
  evidence: CoachEvidence[]
  limitations: string[]
}
