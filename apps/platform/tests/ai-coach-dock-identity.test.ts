import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STATIC_AI_COACH_ASSET } from '../src/components/coach/AICoachDock'

describe('Static AI Coach identity', () => {
  it('uses the frozen Family A asset', () => {
    expect(STATIC_AI_COACH_ASSET).toBe('/assets/overhead-raise-demo-start.png')
  })

  it('does not connect Family B assets to the training page or current dock', () => {
    const currentTrainingSurface = [
      readFileSync('src/pages/Training/TrainingPage.tsx', 'utf8'),
      readFileSync('src/components/training/AICoachFeedbackDock.tsx', 'utf8'),
      readFileSync('src/components/coach/AICoachDock.tsx', 'utf8'),
    ].join('\n')
    expect(currentTrainingSurface).not.toContain('coach-lateral-raise.png')
    expect(currentTrainingSurface).not.toContain('coach-step-jack.png')
    expect(currentTrainingSurface).not.toContain('<CoachPanel')
  })
})
