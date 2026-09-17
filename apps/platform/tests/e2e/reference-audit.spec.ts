import { expect, test } from '@playwright/test'

const assets = [
  { src: '/assets/camera-lateral-raise-demo.png', exercise: 'lateral_raise', kind: 'demo' },
  { src: '/assets/coach-lateral-raise.png', exercise: 'lateral_raise', kind: 'coach' },
  { src: '/assets/camera-step-jack-demo.png', exercise: 'step_jack', kind: 'demo' },
  { src: '/assets/coach-step-jack.png', exercise: 'step_jack', kind: 'coach' },
  { src: '/assets/camera-squat-demo.png', exercise: 'squat', kind: 'poster' },
  { src: '/assets/coach-squat.png', exercise: 'squat', kind: 'coach' },
] as const

for (const asset of assets) {
  test(`audits ${asset.src}`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.addInitScript(({ src }) => {
      const fakeGetUserMedia = async () => {
        const image = new Image()
        image.src = src
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        window.setInterval(() => context?.drawImage(image, 0, 0), 33)
        return canvas.captureStream(30)
      }
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: fakeGetUserMedia })
    }, { src: asset.src })
    await page.goto(`/?debug=1&exercise=${asset.exercise}`)
    await page.getByRole('button', { name: '启用摄像头' }).click()
    await page.getByText(/摄像头已连接/).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(2500)
    const values: Record<string, string> = await page.locator('aside dl > div').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
      const label = node.querySelector('dt')?.textContent ?? ''
      const value = node.querySelector('dd')?.textContent ?? ''
      return [label, value]
    })))
    console.log(`REFERENCE_AUDIT ${asset.src} ${JSON.stringify(values)}`)
    expect(Number.parseFloat(values['Pose confidence'])).toBeGreaterThanOrEqual(0.95)
    if (asset.exercise === 'lateral_raise') {
      expect(Number.parseFloat(values['Torso lean'])).toBeLessThanOrEqual(5)
      expect(Number.parseFloat(values['Left shoulder'])).toBeGreaterThanOrEqual(85)
      expect(Number.parseFloat(values['Left shoulder'])).toBeLessThanOrEqual(95)
      expect(Number.parseFloat(values['Right shoulder'])).toBeGreaterThanOrEqual(85)
      expect(Number.parseFloat(values['Right shoulder'])).toBeLessThanOrEqual(95)
      expect(Number.parseFloat(values['Left elbow'])).toBeGreaterThanOrEqual(160)
      expect(Number.parseFloat(values['Right elbow'])).toBeGreaterThanOrEqual(160)
      expect(Number.parseFloat(values['Symmetry diff'])).toBeLessThanOrEqual(5)
    } else if (asset.exercise === 'step_jack') {
      expect(Number.parseFloat(values['Torso lean'])).toBeLessThanOrEqual(5)
      expect(Number.parseFloat(values['Mean arm angle'])).toBeGreaterThanOrEqual(asset.kind === 'demo' ? 139 : 140)
      expect(Number.parseFloat(values['Mean arm angle'])).toBeLessThanOrEqual(150)
      expect(Number.parseFloat(values['Open ratio'])).toBeGreaterThanOrEqual(1.7)
      expect(Number.parseFloat(values['Open ratio'])).toBeLessThanOrEqual(asset.kind === 'demo' ? 2.05 : 1.9)
    } else {
      expect(Number.parseFloat(values['torsoLateralLean'])).toBeLessThanOrEqual(5)
      expect(Number.isFinite(Number.parseFloat(values['kneeSpreadRatio']))).toBe(true)
      expect(Number.parseFloat(values['kneeHeightDiff'])).toBeLessThanOrEqual(0.10)
      // Squat's legacy still is a poster/detectability audit, not a Coach
      // canonical-similarity gate. The split gate is covered independently.
      expect(Number.isFinite(Number.parseFloat(values['hipKneeSeparation']))).toBe(true)
    }
  })
}
