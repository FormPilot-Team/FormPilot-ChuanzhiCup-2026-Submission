import { describe, expect, it } from 'vitest'
import { FeedbackPolicy } from '../src/features/feedback/FeedbackPolicy'
import type { MotionError } from '../src/features/exercises/types'
import { ruleResult } from './helpers/fixtures'

const low: MotionError = { code: 'ARM_TOO_LOW_L', severity: 0.8, side: 'left', message: '左臂再抬高一些' }
const bent: MotionError = { code: 'ELBOW_TOO_BENT_L', severity: 0.7, side: 'left', message: '左手肘再伸直一些' }

describe('FeedbackPolicy', () => {
  const config = { confirmMs: 300, recoveryMs: 500, sameFeedbackCooldownMs: 4000, differentFeedbackGapMs: 1500 }

  it('requires persistence before issuing a correction', () => {
    const policy = new FeedbackPolicy(config)
    expect(policy.update(ruleResult([low]), 0)).toBeUndefined()
    expect(policy.update(ruleResult([low]), 299)).toBeUndefined()
    expect(policy.update(ruleResult([low]), 300)).toMatchObject({ kind: 'correction', code: 'ARM_TOO_LOW_L' })
  })

  it('respects same-code cooldown and different-code output spacing', () => {
    const policy = new FeedbackPolicy(config)
    policy.update(ruleResult([low]), 0)
    policy.update(ruleResult([low]), 300)
    expect(policy.update(ruleResult([low]), 2000)).toBeUndefined()
    policy.update(ruleResult([bent]), 2100)
    expect(policy.update(ruleResult([bent]), 2399)).toBeUndefined()
    expect(policy.update(ruleResult([bent]), 2400)).toMatchObject({ code: 'ELBOW_TOO_BENT_L' })
    policy.update(ruleResult([low]), 4200)
    expect(policy.update(ruleResult([low]), 4500)).toMatchObject({ code: 'ARM_TOO_LOW_L' })
  })

  it('announces recovery only after the error remains clear', () => {
    const policy = new FeedbackPolicy(config)
    policy.update(ruleResult([low]), 0)
    policy.update(ruleResult([low]), 300)
    expect(policy.update(ruleResult(), 1700)).toBeUndefined()
    expect(policy.update(ruleResult(), 2200)).toMatchObject({ kind: 'recovery', code: 'ARM_TOO_LOW_L' })
  })

  it('keeps the rule-engine priority order', () => {
    const policy = new FeedbackPolicy({ ...config, confirmMs: 0 })
    expect(policy.update(ruleResult([low, bent]), 0)).toMatchObject({ code: 'ARM_TOO_LOW_L' })
  })

  it('does not speak a lower-priority error while a higher-priority error is still confirming', () => {
    const policy = new FeedbackPolicy(config)
    policy.update(ruleResult([bent]), 0)
    policy.update(ruleResult([bent]), 300)
    expect(policy.update(ruleResult([low, bent]), 301)).toBeUndefined()
    expect(policy.update(ruleResult([low, bent]), 1799)).toBeUndefined()
    expect(policy.update(ruleResult([low, bent]), 1800)).toMatchObject({ kind: 'correction', code: 'ARM_TOO_LOW_L' })
  })
})
