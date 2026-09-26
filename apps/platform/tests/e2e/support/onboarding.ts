import type { Page } from '@playwright/test'
import { ONBOARDING_STORAGE_KEY } from '../../../src/features/onboarding/onboarding'

/** For specs that open Home for another purpose: behave like a returning user who has already seen the guide. */
export async function markOnboardingSeen(page: Page): Promise<void> {
  await page.addInitScript(({ key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, outcome: 'completed', at: 1 }))
  }, { key: ONBOARDING_STORAGE_KEY })
}
