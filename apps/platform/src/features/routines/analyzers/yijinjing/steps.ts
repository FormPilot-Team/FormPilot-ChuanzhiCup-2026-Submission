/**
 * 易筋经 step table for the 稳定性 analyzer, keyed by the chapter ids of `programs.ts`.
 *
 * `mode` follows one rule, checked against the standard video by tests/routine-analyzer-yijinjing.test.ts:
 * 预备势 and 收势 are holds; any other 势 is a hold (保持类) when the demonstrator stays still (see
 * config.stillness) for at least 1500 ms in one stretch, otherwise a transition (过渡类). The demonstrator's longest
 * still stretch is noted for each 势 (standard video, 2026-10-01).
 * `sided` 势 work one side at a time: their target pose is compared as seen only (no mirror), as decided in D3.
 */
export type YijinjingMode = 'hold' | 'transition'

export interface YijinjingStep {
  mode: YijinjingMode
  sided: boolean
  /** What to do to hold the position better, quoted after the measured value. */
  cue: string
}

export const YIJINJING_STEPS: Readonly<Record<string, YijinjingStep>> = Object.freeze({
  'yjj-open': { mode: 'hold', sided: false, cue: '头正身直，两脚踏实，静立调息' }, // 14.8 s (hold by definition)
  'yjj-1': { mode: 'hold', sided: false, cue: '两掌合于胸前，肩肘放松，身体中正' }, // 5.8 s
  'yjj-2': { mode: 'hold', sided: false, cue: '两臂侧平举立掌外撑，保持不晃' }, // 6.5 s
  'yjj-3': { mode: 'hold', sided: false, cue: '两掌上托，提踵站稳，力达四肢' }, // 9.5 s
  'yjj-4': { mode: 'hold', sided: true, cue: '上举手稳住，目视掌心' }, // 2.2 s
  'yjj-5': { mode: 'transition', sided: true, cue: '弓步稳定，两手前后对拉' }, // 1.2 s
  'yjj-6': { mode: 'hold', sided: false, cue: '推掌到位后稍停，再回收' }, // 11.9 s
  'yjj-7': { mode: 'hold', sided: true, cue: '拔伸到位后稍停，身体不晃' }, // 3.1 s
  'yjj-8': { mode: 'hold', sided: false, cue: '下蹲到位稍停，两掌下按' }, // 3.4 s
  'yjj-9': { mode: 'hold', sided: true, cue: '探爪到位后稳住，爪随身转' }, // 5.8 s
  'yjj-10': { mode: 'hold', sided: true, cue: '塌腰抬头的定势稳住' }, // 5.3 s
  'yjj-11': { mode: 'hold', sided: false, cue: '俯身逐节卷屈，起身平稳' }, // 13.7 s
  // 1.5 s exactly (1500 ms): on the threshold, a hold by the rule (≥). One frame less would make it a transition.
  'yjj-12': { mode: 'hold', sided: true, cue: '摇头摆尾的定势稳住，两脚踏实' },
  'yjj-close': { mode: 'hold', sided: false, cue: '两臂下落后静立，调匀呼吸' }, // 8.6 s (hold by definition)
})

export const YIJINJING_MODE_LABEL: Readonly<Record<YijinjingMode, string>> = Object.freeze({
  hold: '保持类',
  transition: '过渡类',
})
