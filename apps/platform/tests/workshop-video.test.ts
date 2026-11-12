import { describe, expect, it } from 'vitest'
import { videoFileProblem, videoFrameProblem } from '../src/features/workshop/videoCapture'

describe('local video demonstration boundaries', () => {
  it('accepts video files by content decoding later, without rejecting unfamiliar extensions', () => {
    expect(videoFileProblem({ size: 45_000_000 })).toBeNull()
    expect(videoFileProblem({ size: 0 })).toMatch(/空/)
    expect(videoFileProblem({ size: 3_000_000_000 })).toBeNull()
  })

  it('allows a selected frame in a decoded video', () => {
    expect(videoFrameProblem(2, 2.5)).toBeNull()
    expect(videoFrameProblem(2.5, 2.5)).toMatch(/有效画面/)
    expect(videoFrameProblem(0, Number.NaN)).toMatch(/无法读取/)
  })
})
