import { expect, test, type Page } from '@playwright/test'
import { ROUTINE_SESSION_STORAGE_KEY } from '../../src/features/routines/session/RoutineSessionRepository'
import { createDraftAction } from '../../src/features/workshop/definition'
import { standingPose } from '../../src/features/workshop/fixture'
import { CUSTOM_ACTION_STORAGE_KEY, type CapturedPose, type CustomActionDefinition } from '../../src/features/workshop/types'
import { routineRecord } from '../helpers/routineFixtures'
import { markOnboardingSeen } from './support/onboarding'

/**
 * Web V1.1 evidence: the upgraded pages at the four acceptance viewports, with layout checks that hold at every size.
 * Training pages run the DEV synthetic fixture (not a real camera, not a real person); reports and the detail page use
 * seeded test records (marked as such in the evidence index). Screenshots go to FP_EVIDENCE_DIR when it is set.
 */
const OUT = process.env.FP_EVIDENCE_DIR ?? 'test-results/web-v11'
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
] as const

type Box = { x: number; y: number; width: number; height: number }
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

function capture(degrees: number): CapturedPose {
  return { landmarks: standingPose(degrees).map(({ x, y, z, visibility }) => ({ x, y, z, visibility })), aspect: 16 / 9, frames: 12, capturedAt: '2026-11-11T08:00:00.000Z' }
}

function sampleAction(id: string, patch: Partial<CustomActionDefinition> = {}): CustomActionDefinition {
  return {
    ...createDraftAction(new Date('2026-11-11T08:00:00.000Z'), id),
    name: '侧平举练习',
    description: '双臂侧平举到肩高再放下',
    goal: { type: 'reps', target: 3 },
    startPose: { description: '双臂自然下垂', capture: capture(8) },
    finishPose: { description: '双臂抬到肩高', capture: capture(90) },
    test: { status: 'passed', repsDetected: 3, repsPassed: 3 },
    ...patch,
  }
}

async function seed(page: Page, key: string, value: unknown) {
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, { key, value: JSON.stringify(value) })
}

async function seedRoutineHistory(page: Page) {
  await seed(page, ROUTINE_SESSION_STORAGE_KEY, [
    routineRecord({ id: 'v11-evidence-routine', startedAt: Date.UTC(2026, 10, 11, 8, 49), chapters: { 'bdj-2': { similarity: 0.62 }, 'bdj-5': { similarity: 0.58 } } }),
    routineRecord({ id: 'v11-evidence-routine-old', startedAt: Date.UTC(2026, 10, 5, 8, 0), chapters: { 'bdj-5': { similarity: 0.6 } } }),
  ])
}

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

test('V1.1 evidence C1: routine detail with and without a real history run', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/routines/baduanjin')
  await expect(page.getByTestId('routine-continue')).toHaveAttribute('data-has-history', 'false')
  await expect(page.getByTestId('routine-recommendation')).toHaveCount(0)
  await page.screenshot({ path: `${OUT}/c1-detail-no-history-1440x900.png`, fullPage: true })

  await seedRoutineHistory(page)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto('/routines/baduanjin')
    await expect(page.getByTestId('routine-continue')).toHaveAttribute('data-has-history', 'true')
    await expect(page.getByTestId('routine-recommendation')).toContainText('第五式')
    await expect(page.getByTestId('routine-selected-chapter')).toHaveAttribute('data-chapter-id', 'bdj-5')
    await expect(page.getByTestId('routine-forms').locator('li')).toHaveCount(10)
    await noSidewaysScroll(page)
    await page.screenshot({ path: `${OUT}/c1-detail-${viewport.name}.png`, fullPage: true })
  }
})

test('V1.1 evidence C2: immersive follow-along, details drawer and no-camera state', async ({ page }) => {
  test.setTimeout(240_000)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto('/routines/baduanjin/train?fixture=synthetic')
    await expect(page.getByTestId('routine-state')).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 30_000 })
    await expect(page.getByTestId('routine-hud')).toBeVisible({ timeout: 15_000 })
    const [media, camera, guidance] = await Promise.all(['routine-stage-media', 'camera-stage', 'camera-guidance'].map(async (id) => (await page.getByTestId(id).boundingBox())!))
    expect(overlap(media, camera)).toBe(0)
    expect(overlap(guidance, camera)).toBe(0)
    await noSidewaysScroll(page)
    await page.screenshot({ path: `${OUT}/c2-follow-along-${viewport.name}.png` })
    if (viewport.name === '1440x900' || viewport.name === '390x844') {
      await page.getByTestId('details-toggle').click()
      await expect(page.getByTestId('routine-feedback')).toBeVisible()
      await page.screenshot({ path: `${OUT}/c2-follow-along-details-${viewport.name}.png` })
      await page.getByTestId('details-close').click()
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/routines/baduanjin/train')
  await expect(page.getByRole('button', { name: '启用摄像头' })).toBeVisible()
  await page.screenshot({ path: `${OUT}/c2-no-camera-1440x900.png` })
})

test('V1.1 evidence C3: warm-up with the camera as the main picture', async ({ page }) => {
  test.setTimeout(240_000)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto('/train?demo=1&course=1&fixture=synthetic&exercise=lateral_raise')
    await expect(page.getByTestId('training-exit')).toHaveAttribute('data-exit-phase', 'active', { timeout: 30_000 })
    await expect(page.getByTestId('warmup-count')).toBeVisible()
    const [camera, side] = await Promise.all(['camera-panel', 'demonstration-panel'].map(async (id) => (await page.getByTestId(id).boundingBox())!))
    expect(overlap(camera, side)).toBe(0)
    await noSidewaysScroll(page)
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/c3-warmup-${viewport.name}.png` })
  }
})

test('V1.1 evidence C4: routine report three-question first screen', async ({ page }) => {
  test.setTimeout(120_000)
  await seedRoutineHistory(page)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.goto('/report/v11-evidence-routine')
    await expect(page.getByTestId('report-q-result')).toBeVisible()
    await expect(page.getByTestId('routine-report-problem')).toHaveAttribute('data-chapter-id', 'bdj-5')
    await expect(page.getByTestId('report-q-next')).toContainText('单练第五式')
    await expect(page.getByTestId('routine-report-segments').locator('[data-segment-id]')).toHaveCount(10)
    await noSidewaysScroll(page)
    await page.screenshot({ path: `${OUT}/c4-routine-report-${viewport.name}.png` })
    if (viewport.name === '1440x900') await page.screenshot({ path: `${OUT}/c4-routine-report-full-${viewport.name}.png`, fullPage: true })
  }
})

test('V1.1 evidence workshop: library, wizard and custom-action training', async ({ page }) => {
  test.setTimeout(180_000)
  await seed(page, CUSTOM_ACTION_STORAGE_KEY, { schemaVersion: 1, actions: [sampleAction('custom-v11-evidence'), sampleAction('custom-v11-draft', { name: '弓步压腿', description: '', test: { status: 'untested', repsDetected: 0, repsPassed: 0 } })] })
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
    await page.setViewportSize(viewport)
    await page.goto('/workshop')
    await expect(page.getByTestId('workshop-create')).toBeVisible()
    await expect(page.getByTestId('workshop-continue')).toContainText('弓步压腿')
    await noSidewaysScroll(page)
    await page.screenshot({ path: `${OUT}/workshop-home-${viewport.name}.png`, fullPage: true })
    await page.goto('/workshop/new')
    await expect(page.getByRole('heading', { name: '1 · 动作信息' })).toBeVisible()
    await page.screenshot({ path: `${OUT}/workshop-wizard-${viewport.name}.png`, fullPage: true })
    await page.goto('/workshop/custom-v11-evidence/train?fixture=synthetic')
    await expect(page.getByTestId('custom-state')).toHaveAttribute('data-course-state', 'ACTIVE', { timeout: 30_000 })
    await noSidewaysScroll(page)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/workshop-custom-training-${viewport.name}.png` })
  }
})
