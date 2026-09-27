import type { RoutineChapter, RoutineChapterSource, RoutineId, RoutineProgram, RoutineVideo } from './types'

const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 1..99 as Chinese numerals: 十一, 二十, 二十四. */
export function chineseNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error(`Unsupported numeral: ${value}`)
  if (value < 10) return DIGITS[value]
  const tens = Math.floor(value / 10)
  const ones = value % 10
  return `${tens === 1 ? '' : DIGITS[tens]}十${DIGITS[ones]}`
}

/** Derives end times, indexes and form numbers; chapter starts must be strictly increasing and inside the video. */
export function buildChapters(sources: ReadonlyArray<RoutineChapterSource>, durationSeconds: number): RoutineChapter[] {
  let formNumber = 0
  return sources.map((source, index) => {
    const next = sources[index + 1]
    const endSeconds = next ? next.startSeconds : durationSeconds
    if (!(source.startSeconds >= 0 && endSeconds > source.startSeconds && endSeconds <= durationSeconds)) {
      throw new Error(`Invalid chapter timing for ${source.id}`)
    }
    if (source.kind === 'form') formNumber += 1
    return { ...source, index, endSeconds, formNumber: source.kind === 'form' ? formNumber : undefined }
  })
}

/** `codecs` is what the shipped file really contains (tests/routine-video-files.test.ts reads the MP4 to check). */
function video(id: RoutineId, width: number, height: number, durationSeconds: number, codecs: string, contentAspect = width / height): RoutineVideo {
  return {
    src: `/assets/routines/${id}-standard.mp4`,
    poseTrackSrc: `/assets/routines/${id}-standard.pose.json`,
    posterSrc: `/assets/routines/${id}-poster.jpg`,
    width,
    height,
    contentAspect,
    durationSeconds,
    codecs,
  }
}

const CAPTION_TIMING = '章节起点取自标准视频内的动作字幕（2026-09-26 逐帧检测字幕出现与切换时刻）；字幕间的过渡空白计入前一段。'

const BADUANJIN_VIDEO = video('baduanjin', 640, 360, 728.3, 'avc1.64001E, mp4a.40.5')
const BADUANJIN: RoutineProgram = {
  id: 'baduanjin',
  version: '1.0.0',
  title: '八段锦',
  subtitle: '健身气功 · 八式',
  description: '跟随标准视频完成预备势、八式与收势，视频含呼吸口令。训练中实时比对跟练相似度与节奏。',
  formUnit: '式',
  accent: 'orange',
  video: BADUANJIN_VIDEO,
  timingSource: CAPTION_TIMING,
  chapters: buildChapters([
    { id: 'bdj-open', kind: 'opening', label: '预备势', name: '预备势', startSeconds: 0, cue: '两脚开立与肩同宽，屈膝抱球于腹前，调匀呼吸' },
    { id: 'bdj-1', kind: 'form', label: '第一式', name: '两手托天理三焦', startSeconds: 42, cue: '十指交叉上托，两臂充分伸展；上托吸气，下落呼气' },
    { id: 'bdj-2', kind: 'form', label: '第二式', name: '左右开弓似射雕', startSeconds: 135.5, cue: '马步稳定，一手推出一手拉弓，眼随推出的手' },
    { id: 'bdj-3', kind: 'form', label: '第三式', name: '调理脾胃须单举', startSeconds: 222, cue: '一掌上托、一掌下按，上下对拉拔长，左右交替' },
    { id: 'bdj-4', kind: 'form', label: '第四式', name: '五劳七伤往后瞧', startSeconds: 295.5, cue: '两臂外旋，转头向后瞧，躯干保持正直' },
    { id: 'bdj-5', kind: 'form', label: '第五式', name: '摇头摆尾去心火', startSeconds: 366, cue: '马步下蹲，上身左右摇转，头与尾闾相对摆动' },
    { id: 'bdj-6', kind: 'form', label: '第六式', name: '两手攀足固肾腰', startSeconds: 466, cue: '俯身两手沿腿后侧下攀至脚面，起身时手臂前伸带动上体' },
    { id: 'bdj-7', kind: 'form', label: '第七式', name: '攒拳怒目增气力', startSeconds: 592.5, cue: '马步冲拳，怒目前视，收拳前旋腕抓握' },
    { id: 'bdj-8', kind: 'form', label: '第八式', name: '背后七颠百病消', startSeconds: 651.5, cue: '两脚跟提起、头向上顶，稍停后脚跟轻落' },
    { id: 'bdj-close', kind: 'closing', label: '收势', name: '收势', startSeconds: 705, cue: '两掌叠于腹前，放松还原，调匀呼吸' },
  ], BADUANJIN_VIDEO.durationSeconds),
}

const TAIJIQUAN_FORMS: ReadonlyArray<readonly [string, number, string]> = [
  ['起势', 0, '两脚开立，两臂缓缓前平举，屈膝按掌'],
  ['左右野马分鬃', 17, '弓步分掌，转腰带手，上手与眼同高'],
  ['白鹤亮翅', 41, '后坐成虚步，一手上提至额前、一手下按于胯旁'],
  ['搂膝拗步', 48, '弓步推掌，一手搂过膝前，一手从耳侧推出'],
  ['手挥琵琶', 75.5, '后坐成虚步，两臂合抱如抱琵琶'],
  ['倒卷肱', 83, '退步卷肱，一手后撤一手前推，左右交替'],
  ['左揽雀尾', 114, '掤、捋、挤、按连贯，重心前后转换'],
  ['右揽雀尾', 137, '转体换向，掤捋挤按连贯完成'],
  ['单鞭', 166.5, '一手成勾手，另一掌随转体推出，弓步定势'],
  ['云手', 178, '两手交替在体前画圆，以腰带手，侧行步平稳'],
  ['单鞭', 200.5, '勾手、推掌与弓步同时到位'],
  ['高探马', 209, '后脚跟进，一掌向前探出，一掌收于腹前'],
  ['右蹬脚', 217.5, '两手分开，提膝蹬脚，支撑腿稳定'],
  ['双峰贯耳', 227.5, '弓步，两拳从两侧向前上方贯打'],
  ['转身左蹬脚', 237.5, '转身提膝，左脚向前蹬出，两手分开'],
  ['左下势独立', 246, '仆步下势，再起身提膝独立'],
  ['右下势独立', 260.5, '换右侧仆步下势，起身后独立站稳'],
  ['左右穿梭', 274.5, '弓步架推，一手上架一手前推，左右交替'],
  ['海底针', 290.5, '后坐成虚步，一手由上向前下方插掌'],
  ['闪通臂', 298.5, '弓步推掌，一手上架一手前推'],
  ['转身搬拦捶', 305.5, '转身搬拳、拦掌、冲拳一气呵成'],
  ['如封似闭', 320.5, '两掌翻转回收，再向前推出'],
  ['十字手', 329.5, '两臂交叉于胸前成十字，身体中正'],
  ['收势', 337.5, '两掌分开下落，缓缓还原站立'],
]

// 4:3 footage pillarboxed in a 640×360 frame (picture spans x 78–555).
const TAIJIQUAN_VIDEO = video('taijiquan', 640, 360, 340.3, 'avc1.640033, mp4a.40.5', 4 / 3)
const TAIJIQUAN: RoutineProgram = {
  id: 'taijiquan',
  version: '1.0.0',
  title: '太极拳',
  subtitle: '二十四式',
  description: '跟随标准视频完成二十四式太极拳，从起势到收势连贯演练。训练中实时比对跟练相似度与节奏。',
  formUnit: '式',
  accent: 'violet',
  video: TAIJIQUAN_VIDEO,
  // Captions mark each form's start slightly after the movement begins; starts are taken 1 s before the caption.
  timingSource: `${CAPTION_TIMING} 太极拳字幕在动作开始后约 1 秒出现，因此起点取字幕前 1 秒；原片在收势开始约 3 秒后结束。`,
  chapters: buildChapters(TAIJIQUAN_FORMS.map(([name, startSeconds, cue], index) => ({
    id: `tjq-${index + 1}`,
    kind: 'form' as const,
    label: `第${chineseNumeral(index + 1)}式`,
    name,
    startSeconds,
    cue,
  })), TAIJIQUAN_VIDEO.durationSeconds),
}

const WUQINXI_VIDEO = video('wuqinxi', 640, 360, 822.5, 'avc1.64001E, mp4a.40.2')
const WUQINXI: RoutineProgram = {
  id: 'wuqinxi',
  version: '1.0.0',
  title: '五禽戏',
  subtitle: '健身气功 · 五戏十动',
  description: '跟随标准视频完成虎、鹿、熊、猿、鸟五戏十个动作，视频含呼吸口令。训练中实时比对跟练相似度与节奏。',
  formUnit: '动',
  accent: 'emerald',
  video: WUQINXI_VIDEO,
  timingSource: CAPTION_TIMING,
  chapters: buildChapters([
    { id: 'wqx-open', kind: 'opening', label: '起势', name: '起势调息', startSeconds: 0, cue: '两掌上托下按，引气调息，呼吸均匀' },
    { id: 'wqx-1', kind: 'form', label: '虎戏', name: '虎举', startSeconds: 66.5, cue: '两掌撑开成虎爪，上举如托重物，下拉如拉重物' },
    { id: 'wqx-2', kind: 'form', label: '虎戏', name: '虎扑', startSeconds: 140, cue: '两手前伸如虎扑，躯干由屈到伸，引腰前探' },
    { id: 'wqx-3', kind: 'form', label: '鹿戏', name: '鹿抵', startSeconds: 229, cue: '转腰侧屈，手作鹿角向后下方抵，眼看后脚跟' },
    { id: 'wqx-4', kind: 'form', label: '鹿戏', name: '鹿奔', startSeconds: 280.5, cue: '弓步前伸，含胸弓背，两臂内旋前伸' },
    { id: 'wqx-5', kind: 'form', label: '熊戏', name: '熊运', startSeconds: 354, cue: '两手握空拳成熊掌，以腰腹为轴在腹前画圆' },
    { id: 'wqx-6', kind: 'form', label: '熊戏', name: '熊晃', startSeconds: 395, cue: '提髋起步，落步震足，身体左右晃动' },
    { id: 'wqx-7', kind: 'form', label: '猿戏', name: '猿提', startSeconds: 462, cue: '耸肩缩颈、提踵收腹，手作猿钩上提' },
    { id: 'wqx-8', kind: 'form', label: '猿戏', name: '猿摘', startSeconds: 509.5, cue: '退步摘果，眼随手动，动作轻灵' },
    { id: 'wqx-9', kind: 'form', label: '鸟戏', name: '鸟伸', startSeconds: 587, cue: '两掌上举、身体后伸，再下按并后伸一腿' },
    { id: 'wqx-10', kind: 'form', label: '鸟戏', name: '鸟飞', startSeconds: 639, cue: '两臂如翅起落，单腿提膝独立，保持平衡' },
    { id: 'wqx-close', kind: 'closing', label: '收势', name: '引气归元', startSeconds: 697, cue: '两掌引气下落于腹前，调匀呼吸，放松收势' },
  ], WUQINXI_VIDEO.durationSeconds),
}

const YIJINJING_FORMS: ReadonlyArray<readonly [string, number, string]> = [
  ['韦驮献杵第一势', 34, '两掌合于胸前，指尖斜向上，气定神敛'],
  ['韦驮献杵第二势', 48, '两臂侧平举，立掌外撑，掌心向外'],
  ['韦驮献杵第三势', 73.5, '两掌上托于头顶，提踵，力达四肢'],
  ['摘星换斗势', 96.5, '一手上举摘星、目视掌心，一手背于腰后'],
  ['倒拽九牛尾势', 121.5, '弓步转腰，两手握拳前后对拉'],
  ['出爪亮翅势', 183, '两掌前推如出爪，推出时瞪目，回收时吸气'],
  ['九鬼拔马刀势', 249, '一手绕头扳耳，一手背后上提，转体拔伸'],
  ['三盘落地势', 355, '屈膝下蹲，两掌下按，发音吐气'],
  ['青龙探爪势', 407.5, '转腰探爪，屈身下探，爪随身转'],
  ['卧虎扑食势', 472.5, '弓步前扑，塌腰抬头，十指撑地如虎扑'],
  ['打躬势', 518, '两手抱后脑，俯身逐节卷屈脊柱'],
  ['掉尾势', 614.5, '两手交叉俯身，抬头摇尾左右摆动'],
]

const YIJINJING_VIDEO = video('yijinjing', 640, 360, 765.5, 'avc1.64001E, mp4a.40.5')
const YIJINJING: RoutineProgram = {
  id: 'yijinjing',
  version: '1.0.0',
  title: '易筋经',
  subtitle: '健身气功 · 十二势',
  description: '跟随标准视频完成预备势、十二势与收势，动作舒展、拔伸筋骨。训练中实时比对跟练相似度与节奏。',
  formUnit: '势',
  accent: 'rose',
  video: YIJINJING_VIDEO,
  timingSource: CAPTION_TIMING,
  chapters: buildChapters([
    { id: 'yjj-open', kind: 'opening', label: '预备势', name: '预备势', startSeconds: 0, cue: '两脚并拢站立，头正身直，呼吸自然' },
    ...YIJINJING_FORMS.map(([name, startSeconds, cue], index) => ({
      id: `yjj-${index + 1}`,
      kind: 'form' as const,
      label: `第${chineseNumeral(index + 1)}势`,
      name,
      startSeconds,
      cue,
    })),
    { id: 'yjj-close', kind: 'closing', label: '收势', name: '收势', startSeconds: 694.5, cue: '两臂上举后缓缓下落，调匀呼吸' },
  ], YIJINJING_VIDEO.durationSeconds),
}

/** Catalog order: the two routines already promised on the Mode Hub first, then the two new ones. */
export const ROUTINE_PROGRAMS: ReadonlyArray<RoutineProgram> = Object.freeze([BADUANJIN, TAIJIQUAN, WUQINXI, YIJINJING])

const PROGRAMS_BY_ID: ReadonlyMap<string, RoutineProgram> = new Map(ROUTINE_PROGRAMS.map((program) => [program.id, program]))

export function isRoutineId(value: string | null | undefined): value is RoutineId {
  return typeof value === 'string' && PROGRAMS_BY_ID.has(value)
}

export function getRoutineProgram(id: RoutineId): RoutineProgram {
  const program = PROGRAMS_BY_ID.get(id)
  if (!program) throw new Error(`Unknown routine: ${id}`)
  return program
}

export function findRoutineProgram(id: string | null | undefined): RoutineProgram | undefined {
  return id ? PROGRAMS_BY_ID.get(id) : undefined
}
