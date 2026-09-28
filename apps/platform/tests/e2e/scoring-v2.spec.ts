import { expect, test, type Page } from '@playwright/test'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'
import type { RoutineSessionRecord } from '../../src/features/routines/session/types'
import { SESSION_STORAGE_KEY } from '../../src/features/training/LocalStorageTrainingSessionRepository'
import type { TrainingSessionState } from '../../src/features/training/types'
import { at, makeSession } from '../analysis-fixtures'
import { routineRecord } from '../helpers/routineFixtures'
import { markOnboardingSeen } from './support/onboarding'

/** Scoring v2: every score in a report can say which phase and which measurement cost points, and on what basis. */

async function seed(page: Page, key: string, value: unknown) {
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, { key, value: JSON.stringify(value) })
}

function warmUpSession(): TrainingSessionState {
  const session = makeSession({
    id: 'scoring-v2-warmup',
    startedAt: at(40),
    exercises: {
      overhead_raise: { raw: (index) => (index % 2 === 0 ? { minElbowL: 90, minElbowR: 96, topElbowL: 128, topElbowR: 136 } : undefined) },
      squat: { raw: (index) => (index >= 3 ? { minKneeSpreadRatio: 0.68 } : undefined) },
    },
  })
  session.exercises[0].guidanceSummary = {
    samples: 420,
    metrics: { amplitude: { value: 41.2, score: 100 }, coordination: { value: 0.74, score: 74 }, continuity: { value: 0.86, score: 86 }, stability: { value: 4.1, score: 59 } },
    errorFrames: { ARMS_UNSYNCED: 30 },
  }
  return session
}

/** A 第一式 record whose saved technique evidence shows bent elbows in two of the six 托举. */
function routineWithTechnique(): RoutineSessionRecord {
  const tops = [[50.5, 55.1], [65.4, 70.5], [80.9, 86.5], [96.4, 102.9], [113.5, 119.2], [130, 135.4]]
  const windows = (values: Array<number>, score: (value: number) => number) => tops.map(([start, end], index) => ({ start, end, samples: 50, value: values[index], score: score(values[index]) }))
  const elbow = (value: number) => (value >= 150 ? 100 : Math.max(0, Math.round(((value - 120) / 30) * 100)))
  return {
    ...routineRecord({ id: 'scoring-v2-routine', scope: { kind: 'form', chapterId: 'bdj-1' }, chapters: { 'bdj-1': { similarity: 0.86 } } }),
    technique: {
      version: 'scoring-v2.0',
      criteria: [
        { criterionId: 'bdj.1.elbow_extension', chapterId: 'bdj-1', windows: windows([158, 137, 156, 131, 157, 155], elbow) },
        { criterionId: 'bdj.1.lift_height', chapterId: 'bdj-1', windows: windows([0.62, 0.55, 0.6, 0.5, 0.63, 0.61], () => 100) },
        { criterionId: 'bdj.1.torso_upright', chapterId: 'bdj-1', windows: windows([2, 3, 2, 4, 2, 1], () => 100) },
      ],
    },
  }
}

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

test('Scoring v2 A: a warm-up report explains each exercise score by its parts, deductions and basis', async ({ page }) => {
  await seed(page, SESSION_STORAGE_KEY, [warmUpSession()])
  await page.goto('/report/scoring-v2-warmup')
  const section = page.getByTestId('report-score-explanation')
  await expect(section).toContainText('评分说明 · 为什么是这个分数')
  await section.locator('summary').first().click()
  await expect(section).toContainText('没有统一的“国家六动作评分标准”')
  const overhead = page.getByTestId('score-explanation-overhead_raise')
  await expect(overhead.getByTestId('score-component-wu.overhead_raise.elbow')).toContainText('顶部阶段肘部伸展程度')
  await expect(overhead.getByTestId('score-deduction').first()).toContainText('上举时手肘弯曲')
  await expect(overhead.getByTestId('score-deduction').first()).toContainText('顶部有效帧肘角（较低侧） 128°，满分要求 ≥ 150°')
  await expect(overhead.getByTestId('score-basis').first()).toContainText('FormPilot 工程标定')
  const squat = page.getByTestId('score-explanation-squat')
  await expect(squat).toContainText('膝部轨迹')
  await expect(squat.getByTestId('score-basis').first()).toContainText('国家体育总局网站转载')
  await expect(squat.getByTestId('score-references')).toContainText('腰背挺直、骨盆中立')
  await expect(squat.getByTestId('score-references')).toContainText('本项需要人工观察')
  const shoulder = page.getByTestId('score-explanation-shoulder_rotation')
  await expect(shoulder).toContainText('热身引导 · 不计分')
  await expect(shoulder).toContainText('肩部活动幅度41° · 达到提示线')
  await expect(page.locator('body')).not.toContainText(/wu\.overhead|ELBOW_TOO_BENT|FORMPILOT_CALIBRATED|evidenceLevel/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('Scoring v2 B: the AI Coach answers “为什么是这个分数？” from the same evidence', async ({ page }) => {
  await seed(page, SESSION_STORAGE_KEY, [warmUpSession()])
  await page.goto('/report/scoring-v2-warmup')
  await page.getByTestId('ai-coach-trigger').click()
  await page.getByTestId('ai-coach-panel').getByRole('button', { name: '为什么是这个分数？' }).click()
  const log = page.getByTestId('ai-coach-log')
  await expect(log).toContainText('综合评分')
  await expect(log).toContainText('主要扣分在「')
  await expect(log).toContainText('识别到的关节角度和位置')
  await expect(log).toContainText('评价依据：')
  await expect(log).not.toContainText('继续努力')
})

test('Scoring v2 C: a routine report shows 动作规范评价 apart from 跟练相似度, with phase evidence', async ({ page }) => {
  await seed(page, ROUTINE_SESSION_STORAGE_KEY, [routineWithTechnique(), routineRecord({ id: 'scoring-v2-old' })])
  await page.goto('/report/scoring-v2-routine')
  const technique = page.getByTestId('routine-report-technique')
  await expect(technique).toContainText('动作规范评价')
  await expect(technique).toContainText('两者不合成一个分数')
  await expect(page.getByTestId('routine-report-similarity')).toContainText('86')
  const score = Number(await page.getByTestId('routine-technique-score').textContent())
  expect(score).toBeGreaterThan(0)
  expect(score).toBeLessThan(100)
  const deduction = technique.getByTestId('technique-deduction').first()
  await expect(deduction).toContainText('第一式 · 两手托天理三焦 · 托举顶部两肘未伸直')
  await expect(deduction).toContainText('第 4 次托举顶点（视频 01:36）双肘伸展角（较弯一侧） 131°，要求 ≥ 150°')
  await expect(deduction).toContainText('国家体育总局健身气功管理中心《健身气功•八段锦习惯性错误及纠正方法》（2018-01-10）')
  await expect(deduction).toContainText('由 FormPilot 按标准示范实测值标定')
  await page.getByTestId('routine-technique-details').locator('summary').click()
  await expect(page.getByTestId('technique-criterion-bdj.1.elbow_extension')).toContainText('6 次中 4 次达标')
  await expect(page.getByTestId('technique-chapter-bdj-1')).toContainText('眼随手走，先托后抬头')
  await expect(page.getByTestId('technique-not-observable')).toContainText('呼吸配合')

  await page.goto('/report/scoring-v2-old')
  await expect(page.getByTestId('routine-report-technique')).toContainText('评分说明上线之前')
  await expect(page.getByTestId('routine-technique-score')).toHaveText('—')
})

test('Scoring v2 D: a followed form saves technique evidence and its report scores the faithful follower', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/routines/baduanjin/train?fixture=synthetic&fast=1&form=bdj-1')
  const dialog = page.getByTestId('routine-complete-dialog')
  await expect(dialog).toHaveAttribute('data-outcome', 'completed', { timeout: 60_000 })
  const [record] = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as RoutineSessionRecord[], ROUTINE_SESSION_STORAGE_KEY)
  expect(record.technique?.version).toBe('scoring-v2.1')
  const elbow = record.technique?.criteria.find((item) => item.criterionId === 'bdj.1.elbow_extension')
  expect(elbow?.chapterId).toBe('bdj-1')
  expect(elbow?.windows).toHaveLength(6)
  expect(elbow?.windows.filter((window) => window.score !== null).length).toBeGreaterThanOrEqual(4)
  expect(elbow?.windows.every((window) => window.score === null || window.score === 100)).toBe(true)
  await page.getByRole('button', { name: '查看跟练报告' }).click()
  await expect(page.getByTestId('routine-technique-score')).toHaveText('100')
  await expect(page.getByTestId('routine-report-technique')).toContainText('已检查的动作要求全部达标')
})
