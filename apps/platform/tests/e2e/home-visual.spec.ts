import { expect, test, type Locator, type Page } from '@playwright/test'
import { COACH_WELCOME_ASSET } from '../../src/components/coach/coachIdentity'
import { markOnboardingSeen } from './support/onboarding'

type Box = { x: number; y: number; width: number; height: number }

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function box(locator: Locator): Promise<Box> {
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
  return value as Box
}

/** Where the text itself is drawn (a heading's box spans the whole column). */
async function textBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
}

/** The coach's face inside the welcome picture (Family A crop: roughly 40–60 % across, 16–40 % down). */
async function faceBox(page: Page): Promise<Box> {
  const image = await box(page.getByTestId('home-coach-image'))
  return { x: image.x + image.width * 0.4, y: image.y + image.height * 0.16, width: image.width * 0.2, height: image.height * 0.24 }
}

test.beforeEach(async ({ page }) => { await markOnboardingSeen(page) })

test('Home A: the hero shows the brand, the coach welcoming you and light hints on wide screens', async ({ page }) => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const hero = page.getByTestId('home-hero')
    await expect(hero.getByRole('heading', { level: 1, name: 'FormPilot' })).toBeVisible()
    await expect(hero).toContainText('你的专属动作教练')
    const image = page.getByTestId('home-coach-image')
    await expect(image).toHaveAttribute('src', COACH_WELCOME_ASSET.src)
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete ? element.naturalWidth : 0)).toBe(COACH_WELCOME_ASSET.width)
    const welcome = page.getByTestId('home-coach-welcome')
    await expect(welcome).toBeVisible()
    // The welcome sits beside the coach: never over her face, the title or the tagline.
    const bubble = await box(welcome)
    expect(overlaps(bubble, await faceBox(page)), `${viewport.width}: face`).toBe(false)
    expect(overlaps(bubble, await textBox(hero.getByRole('heading', { level: 1 }))), `${viewport.width}: title`).toBe(false)
    expect(overlaps(bubble, await textBox(hero.getByText('你的专属动作教练'))), `${viewport.width}: tagline`).toBe(false)
    expect(overlaps(bubble, await textBox(hero.getByText('实时动作识别 · 动作纠正 · 训练复盘'))), `${viewport.width}: keywords`).toBe(false)
    const hints = page.getByTestId('home-hero-capabilities')
    await expect(hints).toBeVisible()
    // …and the hints stay clear of her raised right hand (the picture's right edge is empty canvas).
    const picture = await box(image)
    expect((await box(hints)).x, `${viewport.width}: hints`).toBeGreaterThanOrEqual(picture.x + picture.width * 0.96)
    // The first training cards stay in the first screen, and nothing scrolls sideways.
    await expect(page.getByTestId('mode-card-smart-training')).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/home-visual-${viewport.width}x${viewport.height}.png` })
  }
})

test('Home B: five equal mode cards in one row on wide screens, 3 + 2 on tablets, one column on phones', async ({ page }) => {
  const ids = ['smart-training', 'baduanjin', 'taijiquan', 'wuqinxi', 'yijinjing']
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const wide = await Promise.all(ids.map((id) => box(page.getByTestId(`mode-card-${id}`))))
  for (const card of wide) {
    expect(Math.abs(card.y - wide[0].y)).toBeLessThan(1)
    expect(Math.abs(card.width - wide[0].width)).toBeLessThan(1)
    expect(Math.abs(card.height - wide[0].height)).toBeLessThan(1)
  }
  await expect(page.getByTestId('mode-card-baduanjin').locator('[data-figure="lift"]')).toBeVisible()

  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/')
  const tablet = await Promise.all(ids.map((id) => box(page.getByTestId(`mode-card-${id}`))))
  expect(new Set(tablet.slice(0, 3).map((card) => Math.round(card.y))).size).toBe(1)
  expect(new Set(tablet.slice(3).map((card) => Math.round(card.y))).size).toBe(1)
  expect(tablet[3].y).toBeGreaterThan(tablet[0].y)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const phone = await Promise.all(ids.map((id) => box(page.getByTestId(`mode-card-${id}`))))
  for (let index = 1; index < phone.length; index += 1) expect(phone[index].y).toBeGreaterThan(phone[index - 1].y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('Home C: on a phone the words come first, the coach moves below them and the hints are hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const hero = page.getByTestId('home-hero')
  const title = await box(hero.getByRole('heading', { level: 1 }))
  const guide = await box(page.getByTestId('home-guide'))
  const image = await box(page.getByTestId('home-coach-image'))
  expect(image.y).toBeGreaterThanOrEqual(guide.y + guide.height - 1)
  expect(title.y).toBeLessThan(image.y)
  await expect(page.getByTestId('home-hero-capabilities')).toBeHidden()
  const bubble = await box(page.getByTestId('home-coach-welcome'))
  expect(bubble.x).toBeGreaterThanOrEqual(0)
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(390)
  expect(overlaps(bubble, await faceBox(page))).toBe(false)
  await expect(page.getByTestId('mode-card-smart-training')).toBeInViewport()
  await page.screenshot({ path: 'test-results/home-visual-390x844.png', fullPage: true })
})

test('Home D: a welcome picture that fails to load leaves a clean hero, no broken image', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.route(`**${COACH_WELCOME_ASSET.src}`, (route) => route.fulfill({ status: 404, body: '' }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('home-coach-image')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'FormPilot' })).toBeVisible()
  await expect(page.getByTestId('home-coach-welcome')).toBeVisible()
  await expect(page.getByTestId('mode-card-smart-training')).toBeInViewport()
  expect(errors).toEqual([])
})

test('Home E: the AI coach wears the same face, and cards do not move under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const avatar = page.getByTestId('ai-coach-trigger').locator('img')
  await expect(avatar).toHaveAttribute('src', '/assets/coach/coach-avatar.webp')
  await expect.poll(() => avatar.evaluate((element: HTMLImageElement) => element.complete ? element.naturalWidth : 0)).toBeGreaterThan(0)
  const card = page.getByTestId('mode-card-taijiquan')
  await card.hover()
  await page.waitForTimeout(250)
  expect(await card.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
})

test('Home F: 动作工坊 sits beside 我的训练 as an equal card, with a light five-step path and a clear way in', async ({ page }) => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const phone = viewport.width < 640
    await page.setViewportSize(viewport)
    await page.goto('/')
    const workshop = page.getByTestId('home-workshop')
    const training = page.getByTestId('home-training-history')
    await workshop.scrollIntoViewIfNeeded()
    const card = await box(workshop)
    const other = await box(training)
    // The same card family as 我的训练: same frame, and on wide screens the same row, width and height.
    const frame = (element: Element) => { const style = getComputedStyle(element); return [style.borderTopColor, style.borderTopWidth, style.borderRadius].join(' ') }
    expect(await workshop.evaluate(frame), `${viewport.width}: frame`).toBe(await training.evaluate(frame))
    if (!phone) {
      expect(Math.abs(card.y - other.y), `${viewport.width}: row`).toBeLessThan(1)
      expect(Math.abs(card.width - other.width), `${viewport.width}: width`).toBeLessThan(1)
      expect(Math.abs(card.height - other.height), `${viewport.width}: height`).toBeLessThan(1)
    }
    // Five steps in one light path: every label readable, none touching the next, all inside the card.
    const steps = await Promise.all((await page.getByTestId('home-workshop-flow').getByRole('listitem').all()).map(box))
    expect(steps).toHaveLength(5)
    for (const [index, step] of steps.entries()) {
      expect(step.x, `${viewport.width}: step ${index + 1} left`).toBeGreaterThanOrEqual(card.x)
      expect(step.x + step.width, `${viewport.width}: step ${index + 1} right`).toBeLessThanOrEqual(card.x + card.width)
      const next = steps[index + 1]
      if (next && Math.abs(next.y - step.y) < 1) expect(next.x - (step.x + step.width), `${viewport.width}: gap after step ${index + 1}`).toBeGreaterThanOrEqual(6)
    }
    if (!phone) expect(new Set(steps.map((step) => Math.round(step.y))).size, `${viewport.width}: one row`).toBe(1)
    // The recognition sketch is a small side panel on wide cards and steps aside on phones.
    await expect(page.getByTestId('home-workshop-illustration')).toBeVisible({ visible: !phone })
    // It shows teaching FormPilot any action (record → learn → checks → tested), never the landmark skeleton of the
    // workshop's debug views or one training's start → finish poses; every part stays inside the panel.
    await expect(workshop.getByTestId('pose-sketch')).toHaveCount(0)
    await expect(workshop.locator('[data-figure="workshop-start"], [data-figure="workshop-finish"]')).toHaveCount(0)
    if (!phone) {
      const illustration = page.getByTestId('home-workshop-illustration')
      const panel = await box(illustration)
      expect(panel.y + panel.height, `${viewport.width}: illustration bottom`).toBeLessThanOrEqual(card.y + card.height)
      expect(panel.x + panel.width, `${viewport.width}: illustration right`).toBeLessThanOrEqual(card.x + card.width)
      for (const part of ['workshop-record', 'workshop-learn', 'workshop-requirements', 'workshop-tested']) {
        const piece = illustration.locator(`[data-part="${part}"]`)
        await expect(piece, `${viewport.width}: ${part}`).toBeVisible()
        const inner = await box(piece)
        expect(inner.x >= panel.x && inner.x + inner.width <= panel.x + panel.width && inner.y + inner.height <= panel.y + panel.height, `${viewport.width}: ${part} inside`).toBe(true)
      }
      await expect(illustration.locator('[data-figure="workshop-neutral"]')).toBeVisible()
    }
    const cta = page.getByTestId('home-workshop-link')
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAccessibleName('进入动作工坊')
    const link = await box(cta)
    expect(link.y + link.height, `${viewport.width}: cta`).toBeLessThanOrEqual(card.y + card.height)
    // The AI coach stays on top of the page, never covered by the card.
    const coach = await box(page.getByTestId('ai-coach-trigger'))
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="ai-coach-trigger"]') !== null, { x: coach.x + coach.width / 2, y: coach.y + coach.height / 2 }), `${viewport.width}: coach`).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${viewport.width}: scroll`).toBe(true)
    await page.screenshot({ path: `test-results/home-workshop-${viewport.width}x${viewport.height}.png` })
  }
})
