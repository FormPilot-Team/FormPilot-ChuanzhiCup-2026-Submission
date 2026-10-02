// 易筋经步骤表，按 programs.ts 的章节 id 索引。预备势、收势为保持类；
// 其余势在示范者连续静止 ≥ 1500 ms 时为保持类，否则为过渡类。
// 有左右之分的势（sided）只按原样比较目标姿态，不取镜像
export type YijinjingMode = 'hold' | 'transition'

export interface YijinjingStep {
  mode: YijinjingMode
  sided: boolean
  /** 反馈中接在数值后面的动作提示 */
  cue: string
}

export const YIJINJING_STEPS: Readonly<Record<string, YijinjingStep>> = Object.freeze({
  'yjj-open': { mode: 'hold', sided: false, cue: '头正身直，两脚踏实，静立调息' }, // 预备势
  'yjj-1': { mode: 'hold', sided: false, cue: '两掌合于胸前，肩肘放松，身体中正' }, // 韦驮献杵第一势
  'yjj-2': { mode: 'hold', sided: false, cue: '两臂侧平举立掌外撑，保持不晃' }, // 韦驮献杵第二势
  'yjj-3': { mode: 'hold', sided: false, cue: '两掌上托，提踵站稳，力达四肢' }, // 韦驮献杵第三势
  'yjj-4': { mode: 'hold', sided: true, cue: '上举手稳住，目视掌心' }, // 摘星换斗势
  'yjj-5': { mode: 'transition', sided: true, cue: '弓步稳定，两手前后对拉' }, // 倒拽九牛尾势
  'yjj-6': { mode: 'hold', sided: false, cue: '推掌到位后稍停，再回收' }, // 出爪亮翅势
  'yjj-7': { mode: 'hold', sided: true, cue: '拔伸到位后稍停，身体不晃' }, // 九鬼拔马刀势
  'yjj-8': { mode: 'hold', sided: false, cue: '下蹲到位稍停，两掌下按' }, // 三盘落地势
  'yjj-9': { mode: 'hold', sided: true, cue: '探爪到位后稳住，爪随身转' }, // 青龙探爪势
  'yjj-10': { mode: 'hold', sided: true, cue: '塌腰抬头的定势稳住' }, // 卧虎扑食势
  'yjj-11': { mode: 'hold', sided: false, cue: '俯身逐节卷屈，起身平稳' }, // 打躬势
  // 掉尾势：示范最长静止恰为 1500 ms，正好在阈值上，按 ≥ 判为保持类
  'yjj-12': { mode: 'hold', sided: true, cue: '摇头摆尾的定势稳住，两脚踏实' },
  'yjj-close': { mode: 'hold', sided: false, cue: '两臂下落后静立，调匀呼吸' }, // 收势
})

export const YIJINJING_MODE_LABEL: Readonly<Record<YijinjingMode, string>> = Object.freeze({
  hold: '保持类',
  transition: '过渡类',
})
