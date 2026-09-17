import { describe, expect, it } from 'vitest'
import { FALLBACK_RECOVERY_MESSAGE, FeedbackPolicy } from '../src/features/feedback/FeedbackPolicy'
import type { MotionError } from '../src/features/exercises/types'
import { ruleResult } from './helpers/fixtures'

const config = { confirmMs: 0, recoveryMs: 100, sameFeedbackCooldownMs: 4000, differentFeedbackGapMs: 5000 }

function recover(error: MotionError) {
  const policy = new FeedbackPolicy(config)
  policy.update(ruleResult([error]), 0)
  policy.update(ruleResult(), 1)
  policy.update(ruleResult(), 101)
  return policy.getSnapshot().recoveredFeedback
}

describe('FeedbackRecoveryEvent', () => {
  it.each([
    [{ code: 'ARM_TOO_LOW_R', severity: .8, message: '右臂再抬高一些' }, '很好，保持这个高度'],
    [{ code: 'DEPTH_INSUFFICIENT', severity: .8, message: '可以再蹲低一些' }, '很好，下蹲深度更充分了'],
    [{ code: 'BODY_SWAY', severity: .8, message: '保持身体稳定' }, '很好，核心更稳定了'],
  ] as const)('emits a specific positive message for $0.code', (error, message) => {
    expect(recover(error)).toMatchObject({ kind: 'recovery', exerciseId: 'lateral_raise', code: error.code, message })
  })

  it('uses the positive fallback when no specific recovery copy exists', () => {
    expect(recover({ code: 'TOO_FAST', severity: .6, message: '放慢速度' })?.message).toBe(FALLBACK_RECOVERY_MESSAGE)
  })

  it('exposes confirmed correction even when speech spacing blocks output', () => {
    const policy = new FeedbackPolicy(config)
    const first = { code: 'ARM_TOO_LOW_R', severity: .8, message: '右臂再抬高一些' } as const
    const second = { code: 'ELBOW_TOO_BENT_L', severity: .7, message: '左手肘再伸直一些' } as const
    expect(policy.update(ruleResult([first]), 0)).toBeDefined()
    expect(policy.update(ruleResult([second]), 1)).toBeUndefined()
    expect(policy.getSnapshot().confirmedPrimaryFeedback).toMatchObject({ code: 'ELBOW_TOO_BENT_L' })
  })

  it('exposes recovery even when speech spacing blocks its announcement', () => {
    const policy = new FeedbackPolicy(config)
    policy.update(ruleResult([{ code: 'BODY_SWAY', severity: .7, message: '保持稳定' }]), 0)
    policy.update(ruleResult(), 1)
    expect(policy.update(ruleResult(), 101)).toBeUndefined()
    expect(policy.getSnapshot().recoveredFeedback).toMatchObject({ code: 'BODY_SWAY', kind: 'recovery' })
  })
})
