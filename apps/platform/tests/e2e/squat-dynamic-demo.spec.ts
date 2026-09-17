import { expect, test } from '@playwright/test'

const debugValue = (page: import('@playwright/test').Page, label: string) => page
  .getByRole('complementary', { name: '开发调试信息' })
  .locator('dt', { hasText: label })
  .locator('..')
  .locator('dd')

test('Squat dynamic Demo completes one real PoseDetector repetition', async ({ page }) => {
  test.setTimeout(90_000)
  const modelRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('pose_landmarker_lite.task')) modelRequests.push(request.url())
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1&exercise=squat')

  const demoImage = page.getByRole('img', { name: '演示模式中的徒手深蹲人物' })
  await expect(demoImage).toHaveAttribute('data-demo-source', 'real-image-sequence')
  await expect(debugValue(page, 'Demo source')).toHaveText('real image sequence')
  await expect(debugValue(page, 'Pose pipeline')).toContainText('PoseDetector')
  await expect(debugValue(page, 'Baseline')).toHaveText('ready', { timeout: 30_000 })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase3_1/squat-demo-standing.png' })

  await expect(debugValue(page, 'Phase trace')).toContainText('DESCENDING', { timeout: 20_000 })
  await expect(debugValue(page, 'Phase trace')).toContainText('BOTTOM', { timeout: 20_000 })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase3_1/squat-demo-bottom.png' })

  await expect(debugValue(page, 'Phase trace')).toContainText('STANDING → DESCENDING → BOTTOM → ASCENDING → COMPLETE', { timeout: 30_000 })
  await expect(debugValue(page, 'Rep count')).not.toHaveText('0', { timeout: 10_000 })
  await page.locator('section[aria-labelledby="camera-title"]').screenshot({ path: 'test-results/regression-screenshots/phase3_1/squat-demo-complete.png' })
  await page.getByRole('complementary', { name: '开发调试信息' }).screenshot({ path: 'test-results/regression-screenshots/phase3_1/dynamic-demo-timeline.png' })

  const proof = Object.fromEntries(await Promise.all([
    'standingHipY', 'Camera FPS', 'Inference FPS', 'Avg inference', 'p95 inference', 'Dropped / skipped',
    'Last maxHipDrop', 'Last knee spread', 'Last knee height diff', 'Last torso lean',
    'Last rep duration', 'Last rep score', 'Last rep errors', 'MediaPipe init count',
  ].map(async (label) => [label, await debugValue(page, label).textContent()])))
  console.log(`SQUAT_DYNAMIC_PROOF ${JSON.stringify(proof)}`)
  expect(Number(proof['Last maxHipDrop'])).toBeGreaterThan(0.15)
  expect(Number.parseInt(proof['Last rep duration'] ?? '0', 10)).toBeGreaterThan(0)
  expect(proof['MediaPipe init count']).toBe('1')
  expect(modelRequests).toHaveLength(1)
})

test('Squat Coach debug shows detected and canonical skeletons plus split validation', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?demo=1&debug=1&exercise=squat')
  await expect(debugValue(page, 'Pose confidence')).not.toHaveText('0.00', { timeout: 30_000 })
  await page.getByLabel('Show Coach Reference Skeleton').check()
  await expect(page.getByTestId('detected-coach-skeleton')).toBeVisible()
  await expect(page.getByTestId('canonical-reference-skeleton')).toBeVisible()
  await expect(page.getByTestId('coach-validation-debug')).toContainText('Detectable PASS · Similarity PASS')
  await page.locator('section[aria-labelledby="coach-title"]').screenshot({ path: 'test-results/regression-screenshots/phase3_1/squat-coach-reference-refined.png' })
  await page.getByTestId('coach-validation-debug').screenshot({ path: 'test-results/regression-screenshots/phase3_1/squat-coach-validation-debug.png' })
})
