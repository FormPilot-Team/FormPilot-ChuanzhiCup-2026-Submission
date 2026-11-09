import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { COACH_DECISION_DEFAULT_MODE, COMPETITION_BUILD_MODE, resolveCoachDecisionMode, resolveCoachDecisionRuntime } from '../src/app/coachDecisionConfig'
import { COACH_DECISION_CONTRACT, recommendCoachDecision } from '../src/features/coachAgent/decisionModel/engine'
import { COACH_PATH, GAMES_PATH, ME_PATH, ROUTINES_PATH, TRAINING_CENTER_PATH, webBoardOf } from '../src/app/routes'
import type { CoachProfile } from '../src/features/coachAgent/recommendation/types'
import { ROUTINE_SESSION_STORAGE_KEY } from '../src/features/routines/session/RoutineSessionRepository'
import { MemoryRoutineSessionRepository } from '../src/features/routines/session/RoutineSessionRepository'
import type { TrainingSessionRepository } from '../src/features/training/TrainingSessionRepository'
import type { TrainingSessionState } from '../src/features/training/types'
import { WEB_GAMES, motionGameUrl, motionGamesBaseUrl, probeMotionGames } from '../src/features/web/games'
import { entryRetrainPath, loadWebHistory, relativeDayText, trainingStreakDays } from '../src/features/web/webHistory'
import { MemoryCustomSessionRepository } from '../src/features/workshop/session'
import { MemoryCustomActionRepository } from '../src/features/workshop/store'
import { COACH_FIXED_QUESTIONS, CoachPage, EXPERIMENTAL_LABEL, runCoachDecision } from '../src/pages/Web/CoachPage'
import { GamesCenterPage } from '../src/pages/Web/GamesCenterPage'
import { HomeV1Page } from '../src/pages/Web/HomeV1Page'
import { MePage, formalTrend } from '../src/pages/Web/MePage'
import { RoutinesV1Page, routineProgress } from '../src/pages/Web/RoutinesV1Page'
import { TrainingCenterPage } from '../src/pages/Web/TrainingCenterPage'
import { buildRoutineHistoryItems } from '../src/features/history/routineHistory'
import { mergeHistoryEntries } from '../src/features/history/historyEntries'
import { buildTrainingHistoryItems } from '../src/features/history/TrainingHistory'
import { at, makeSession } from './analysis-fixtures'
import { routineRecord } from './helpers/routineFixtures'

function trainingRepository(sessions: TrainingSessionState[]): TrainingSessionRepository {
  return { save: () => true, get: (id) => sessions.find((item) => item.id === id), list: () => sessions }
}

function emptyRepositories() {
  return { training: trainingRepository([]), routine: new MemoryRoutineSessionRepository(), custom: new MemoryCustomSessionRepository(), actions: new MemoryCustomActionRepository() }
}

/** Profile P of WEB_INTEGRATION_READY §9. */
const PROFILE_P: CoachProfile = { version: 1, goals: ['upper_limb'], difficulties: ['stiffness'], regions: ['shoulders', 'arms'], preference: 'mixed', risk: 'none', acknowledged: true }

/** Demo numbers of the prototype that must never appear as if they were the user's data. */
const PROTOTYPE_DEMO_VALUES = ['7.5', '6,240', '200+', '林同学', '1,280', 'BPM', '326', 'kcal']

/** Visible text only (attributes and SVG paths contain arbitrary numbers). */
const visibleText = (html: string) => html.replace(/<[^>]*>/g, ' ')

describe('Web V1 routes', () => {
  it('maps every path to one of the six boards', () => {
    expect(webBoardOf('/')).toBe('home')
    expect(webBoardOf(TRAINING_CENTER_PATH)).toBe('training')
    expect(webBoardOf('/smart-training')).toBe('training')
    expect(webBoardOf('/train')).toBe('training')
    expect(webBoardOf('/', '?demo=1')).toBe('training')
    expect(webBoardOf(ROUTINES_PATH)).toBe('routines')
    expect(webBoardOf('/routines/baduanjin/train')).toBe('routines')
    expect(webBoardOf(GAMES_PATH)).toBe('games')
    expect(webBoardOf(COACH_PATH)).toBe('coach')
    expect(webBoardOf(ME_PATH)).toBe('me')
    expect(webBoardOf('/me/settings')).toBe('me')
    expect(webBoardOf('/history')).toBe('me')
    expect(webBoardOf('/report/abc')).toBe('me')
    expect(webBoardOf('/workshop')).toBe('me')
    expect(webBoardOf('/workshop/a1/train')).toBe('training')
    expect(webBoardOf('/coach-agent-lab.html')).toBeUndefined()
  })
})

describe('Web V1 local history', () => {
  it('counts a streak only over consecutive days ending today or yesterday', () => {
    const now = new Date(2026, 10, 9, 15).getTime()
    const day = (offset: number) => ({ startedAt: new Date(2026, 10, 9 + offset, 9).getTime() })
    const entries = [day(0), day(-1), day(-2), day(-4)].map((item, index) => ({ kind: 'smart', id: String(index), incomplete: false, ...item })) as never
    expect(trainingStreakDays(entries, now)).toBe(3)
    expect(trainingStreakDays([{ startedAt: day(-1).startedAt }] as never, now)).toBe(1)
    expect(trainingStreakDays([{ startedAt: day(-3).startedAt }] as never, now)).toBe(0)
    expect(trainingStreakDays([], now)).toBe(0)
  })

  it('reads empty stores as zero, never as demo data', () => {
    const snapshot = loadWebHistory(emptyRepositories(), at(60))
    expect(snapshot.entries).toEqual([])
    expect(snapshot.summary.finishedCount).toBe(0)
    expect(snapshot.streakDays).toBe(0)
    expect(snapshot.unavailable).toBe(false)
  })

  it('leads "再练一次" to the same routine form', () => {
    const record = routineRecord({ id: 'r1', programId: 'taijiquan', scope: { kind: 'form', chapterId: 'tjq-10' }, startedAt: at(1) })
    const [entry] = mergeHistoryEntries([], buildRoutineHistoryItems([record]))
    expect(entryRetrainPath(entry)).toBe('/routines/taijiquan/train?form=tjq-10')
  })

  it('names relative training days', () => {
    const now = new Date(2026, 10, 9, 15).getTime()
    expect(relativeDayText(null, now)).toBe('从未训练')
    expect(relativeDayText(new Date(2026, 10, 9, 8).getTime(), now)).toBe('今天训练')
    expect(relativeDayText(new Date(2026, 10, 8, 20).getTime(), now)).toBe('昨天训练')
  })
})

describe('Web V1 pages render real data and honest empty states', () => {
  it('Home keeps the design hero, shows zeros and the first-use line with no history', () => {
    const html = renderToStaticMarkup(createElement(HomeV1Page, { repositories: emptyRepositories(), now: at(60) }))
    expect(html).toContain('fh-landing')
    expect(html).toContain('完成第一次训练后，这里会出现你的变化')
    expect(html).toContain('data-testid="home-recent-empty"')
    for (const value of PROTOTYPE_DEMO_VALUES) expect(visibleText(html), value).not.toContain(value)
    for (const label of ['首页', '训练中心', '功法训练', '游戏中心', 'AI Coach', '我的']) expect(html).toContain(`>${label}</a>`)
  })

  it('Home shows the latest real training and links to its report', () => {
    const sessions = [makeSession({ id: 'course-a', startedAt: at(58) })]
    const repositories = { ...emptyRepositories(), training: trainingRepository(sessions) }
    const html = renderToStaticMarkup(createElement(HomeV1Page, { repositories, now: at(60) }))
    expect(html).toContain('本机已完成 <b>1 次训练</b>')
    expect(html).toContain('href="/report/course-a"')
  })

  it('Training center names 动作工坊 correctly and lists the six standard exercises', () => {
    const html = renderToStaticMarkup(createElement(TrainingCenterPage, { repositories: emptyRepositories(), now: at(60) }))
    expect(html).toContain('动作工坊')
    expect(html).not.toContain('动作工作坊')
    expect((html.match(/data-testid="training-free-(?!options)/g) ?? []).length).toBe(6)
    expect(html).toContain('href="/smart-training"')
    expect(html).toContain('data-testid="training-actions-empty"')
  })

  it('Routines use platform ids, never the prototype ids', () => {
    const html = renderToStaticMarkup(createElement(RoutinesV1Page, { repository: new MemoryRoutineSessionRepository() }))
    for (const id of ['baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']) expect(html).toContain(`href="/routines/${id}"`)
    for (const id of ['/routines/badanjin"', '/routines/taichi"', '/routines/wuxinqi"']) expect(html).not.toContain(id)
    expect(html).toContain('data-testid="routine-progress-empty"')
  })

  it('Routine progress counts a form once at least 80 % of it was followed', () => {
    const items = buildRoutineHistoryItems([routineRecord({ id: 'p1', startedAt: at(2), chapters: { 'bdj-2': { coveredSeconds: 1 } } })])
    const progress = routineProgress(items).get('baduanjin')
    expect(progress?.practicedForms.has('bdj-1')).toBe(true)
    expect(progress?.practicedForms.has('bdj-2')).toBe(false)
  })

  it('Me separates games from formal training and shows no trend below two reliable courses', () => {
    const html = renderToStaticMarkup(createElement(MePage, { repositories: emptyRepositories(), now: at(60) }))
    expect(html).toContain('data-testid="me-trend-empty"')
    expect(html).toContain('href="/workshop"')
    for (const value of PROTOTYPE_DEMO_VALUES) expect(visibleText(html), value).not.toContain(value)
    const sessions = [makeSession({ id: 's1', startedAt: at(1) }), makeSession({ id: 's2', startedAt: at(2) })]
    expect(formalTrend(mergeHistoryEntries(buildTrainingHistoryItems(sessions), []))).toHaveLength(2)
  })

  it('Game center shows the three design cards and never claims a running game before checking', () => {
    const html = renderToStaticMarkup(createElement(GamesCenterPage, { probe: () => new Promise<'available' | 'unavailable'>(() => undefined) }))
    for (const game of WEB_GAMES) expect(html).toContain(`data-testid="game-card-${game.id}"`)
    expect(html).toContain('正在检查体感游戏服务')
    expect(html).not.toContain('data-testid="game-running"')
  })

  it('AI Coach opens on its intro and the profile view lists the fixed five questions only after a recommendation', () => {
    expect(renderToStaticMarkup(createElement(CoachPage, { mode: 'off', storage: null }))).toContain('data-testid="coach-intro"')
    const html = renderToStaticMarkup(createElement(CoachPage, { mode: 'off', storage: null, startInside: true }))
    expect(html).toContain('data-testid="coach-profile"')
    expect(html).not.toContain('coach-shadow-panel')
    expect(COACH_FIXED_QUESTIONS.map(([id]) => id)).toEqual(['suitable', 'first_game', 'recent_issues', 'why', 'next_focus'])
  })
})

describe('Web V1 games', () => {
  it('opens Motion Games Lab directly on the chosen game', () => {
    expect(motionGamesBaseUrl({})).toBe('http://127.0.0.1:5181/')
    expect(motionGamesBaseUrl({ VITE_MOTION_GAMES_URL: 'https://games.example.test/lab/' })).toBe('https://games.example.test/lab/')
    expect(motionGameUrl('archery', 'http://127.0.0.1:5181/')).toBe('http://127.0.0.1:5181/?game=archery')
  })

  it('reports the service as unavailable when nothing answers', async () => {
    expect(await probeMotionGames('http://x/', 50, (() => Promise.reject(new TypeError('offline'))) as typeof fetch)).toBe('unavailable')
    expect(await probeMotionGames('http://x/', 50, (() => Promise.resolve(new Response(null))) as typeof fetch)).toBe('available')
  })
})

describe('Web V1 AI Coach decision wiring', () => {
  it('is OFF by default; only the competition build mode turns on ACTIVE with approved experimental weights', () => {
    expect(COACH_DECISION_DEFAULT_MODE).toBe('off')
    expect(resolveCoachDecisionMode({ DEV: false }, '?coachMode=shadow')).toBe('off')
    expect(resolveCoachDecisionMode({ DEV: true }, '?coachMode=shadow')).toBe('shadow')
    expect(resolveCoachDecisionMode({ VITE_COACH_DECISION_MODE: 'shadow' }, '')).toBe('shadow')
    // Ordinary builds: no URL parameter or env value reaches ACTIVE.
    expect(resolveCoachDecisionRuntime({ DEV: true, MODE: 'development' }, '?coachMode=active&allowExperimentalModel=true')).toEqual({ mode: 'off', allowExperimentalModel: false, source: 'default' })
    expect(resolveCoachDecisionRuntime({ DEV: false, MODE: 'production', VITE_COACH_DECISION_MODE: 'active' }, '')).toEqual({ mode: 'off', allowExperimentalModel: false, source: 'default' })
    expect(resolveCoachDecisionRuntime({ DEV: false, MODE: 'production' }, '?coachMode=shadow').allowExperimentalModel).toBe(false)
    // The competition build (vite build --mode competition) runs ACTIVE with the owner-approved experimental weights.
    expect(resolveCoachDecisionRuntime({ DEV: false, MODE: COMPETITION_BUILD_MODE }, '?coachMode=shadow')).toEqual({ mode: 'active', allowExperimentalModel: true, source: 'competition_build' })
  })

  it('OFF shows the Agent Web P0 rule recommendation for profile P (§9 item 1)', () => {
    const run = runCoachDecision(PROFILE_P, 'profile_only', 'off', null)
    expect(run.failed).toBe(false)
    const response = run.response!
    expect(response.decisionOrigin).toBe('rules')
    expect(response.fallbackReason).toBe('MODEL_DISABLED')
    expect(response.execution).toBe('disabled')
    expect(response.display?.result.chapters.map((item) => item.entry.title)).toEqual(['八段锦 · 两手托天理三焦', '八段锦 · 左右开弓似射雕', '八段锦 · 调理脾胃须单举'])
    expect(response.display?.result.games.map((item) => item.entry.title)).toEqual(['摘苹果', '林间射箭'])
    expect(Object.keys(response.display?.answers ?? {})).toHaveLength(5)
  })

  it('SHADOW runs the model but still displays the rules (§9 item 2)', () => {
    const off = runCoachDecision(PROFILE_P, 'profile_only', 'off', null).response!
    const shadow = runCoachDecision(PROFILE_P, 'profile_only', 'shadow', null).response!
    expect(shadow.decisionOrigin).toBe('rules')
    expect(shadow.fallbackReason).toBe('SHADOW_MODE')
    expect(shadow.execution).toBe('executed')
    expect(shadow.ranking.length).toBeGreaterThan(0)
    expect(shadow.display).toEqual(off.display)
    expect(shadow.model?.tier).toBe('ai_experimental')
  })

  it('pauses on a risk profile without running the model or showing content (§9 item 5)', () => {
    const response = runCoachDecision({ ...PROFILE_P, risk: 'dizziness' }, 'profile_only', 'shadow', null).response!
    expect(response.status).toBe('safety_hold')
    expect(response.execution).toBe('not_run')
    const result = response.display?.result
    expect([...(result?.chapters ?? []), ...(result?.routines ?? []), ...(result?.games ?? [])]).toHaveLength(0)
  })

  it('falls back to rules when the model abstains (§9 item 6)', () => {
    const profile: CoachProfile = { version: 1, goals: ['mobility'], difficulties: ['none'], regions: ['shoulders', 'neck', 'arms', 'legs'], preference: 'routine', risk: 'none', acknowledged: true }
    const shadow = runCoachDecision(profile, 'profile_only', 'shadow', null).response!
    const off = runCoachDecision(profile, 'profile_only', 'off', null).response!
    expect(shadow.abstained).toBe(true)
    expect(shadow.abstainReason).toBe('OUT_OF_DISTRIBUTION')
    expect(shadow.display).toEqual(off.display)
  })

  it('reads local routine records only with consent (§9 item 7)', () => {
    const now = Date.now()
    const record = routineRecord({ id: 'consent-1', startedAt: now - 6 * 86_400_000 })
    const storage = { getItem: (key: string) => (key === ROUTINE_SESSION_STORAGE_KEY ? JSON.stringify([record]) : null) }
    expect(runCoachDecision(PROFILE_P, 'profile_only', 'off', storage, now).response?.dataSources.trainingHistory).toBe('missing')
    expect(runCoachDecision(PROFILE_P, 'local_records', 'off', storage, now).response?.dataSources.trainingHistory).toBe('live_local_records')
  })

  it('asks for the profile when it is incomplete', () => {
    const response = runCoachDecision({ ...PROFILE_P, acknowledged: false }, 'profile_only', 'off', null).response!
    expect(response.status).toBe('profile_required')
  })
})

describe('Web V1 AI Coach — competition build (ACTIVE)', () => {
  const COMPETITION = resolveCoachDecisionRuntime({ DEV: false, MODE: COMPETITION_BUILD_MODE }, '')

  it('shows the trained model recommendation for profile P (§9 item 3) with the reviewed-label identity', () => {
    const response = runCoachDecision(PROFILE_P, 'profile_only', COMPETITION, null).response!
    expect(response.mode).toBe('active')
    expect(response.decisionOrigin).toBe('model')
    expect(response.fallbackReason).toBeNull()
    expect(response.execution).toBe('executed')
    expect(response.display?.result.chapters.map((item) => item.entry.title)).toEqual(['易筋经 · 韦驮献杵第一势', '八段锦 · 左右开弓似射雕', '易筋经 · 出爪亮翅势'])
    expect(response.display?.result.games.map((item) => item.entry.title)).toEqual(['林间射箭', '林间划船'])
    expect(response.display?.result.chapters.every((item) => item.reasons.length > 0)).toBe(true)
    // Identity stays honest: still the AI-label tier, human validation still pending.
    expect(response.model).toMatchObject({ id: 'fp-cdm-m2', version: '1.0.0', release: 'fp-cdm-release/1.0.0', tier: 'ai_experimental', tierLabel: EXPERIMENTAL_LABEL })
    expect(response.model?.validation).toEqual({ offlineTechnical: 'passed', humanValidation: 'pending', productAcceptance: 'not_accepted' })
    const top = response.ranking.find((item) => item.id === response.display?.result.chapters[0].entry.id)
    expect(top?.explanation.length).toBeGreaterThan(0)
  })

  it('a bare "active" mode without the build approval falls back to rules (§9 item 4)', () => {
    const response = runCoachDecision(PROFILE_P, 'profile_only', 'active', null).response!
    expect(response.decisionOrigin).toBe('rules')
    expect(response.fallbackReason).toBe('EXPERIMENTAL_MODEL_NOT_APPROVED')
    expect(response.display).toEqual(runCoachDecision(PROFILE_P, 'profile_only', 'off', null).response!.display)
  })

  it('still pauses every risk profile without running the model', () => {
    for (const risk of ['acute_pain', 'dizziness', 'recent_injury'] as const) {
      const response = runCoachDecision({ ...PROFILE_P, risk }, 'profile_only', COMPETITION, null).response!
      expect(response.status, risk).toBe('safety_hold')
      expect(response.execution, risk).toBe('not_run')
      expect(response.decisionOrigin, risk).toBe('rules')
    }
  })

  it('abstains on an out-of-distribution profile and shows the rule recommendation (§9 item 6)', () => {
    const profile: CoachProfile = { version: 1, goals: ['mobility'], difficulties: ['none'], regions: ['shoulders', 'neck', 'arms', 'legs'], preference: 'routine', risk: 'none', acknowledged: true }
    const response = runCoachDecision(profile, 'profile_only', COMPETITION, null).response!
    expect(response.abstained).toBe(true)
    expect(response.fallbackReason).toBe('MODEL_ABSTAINED')
    expect(response.decisionOrigin).toBe('rules')
    expect(response.display).toEqual(runCoachDecision(profile, 'profile_only', 'off', null).response!.display)
  })

  it('rejects an invalid request through the public interface instead of crashing (§9 item 9)', () => {
    const response = recommendCoachDecision({ contract: COACH_DECISION_CONTRACT, profile: PROFILE_P, userId: 'x' } as never, { mode: 'active', allowExperimentalModel: true })
    expect(response.fallbackReason).toBe('INPUT_INVALID')
    expect(response.inputIssues[0]?.path).toBe('$.userId')
    expect(response.decisionOrigin).toBe('rules')
  })

  it('renders the competition page with the orb intro and, inside, the profile form', () => {
    expect(renderToStaticMarkup(createElement(CoachPage, { runtime: COMPETITION, storage: null }))).toContain('data-testid="coach-orb-stage"')
    const html = renderToStaticMarkup(createElement(CoachPage, { runtime: COMPETITION, storage: null, startInside: true }))
    expect(html).toContain('data-testid="coach-profile"')
    expect(html).toContain('data-testid="coach-orb-avatar"')
    expect(html).not.toContain('未经人工验证')
  })
})
