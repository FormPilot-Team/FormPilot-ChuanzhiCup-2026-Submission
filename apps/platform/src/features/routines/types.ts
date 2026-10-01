export type RoutineId = 'baduanjin' | 'taijiquan' | 'wuqinxi' | 'yijinjing'

/** 预备势、收势属于套路，但不编式序号 */
export type RoutineChapterKind = 'opening' | 'form' | 'closing'

export type RoutineAccent = 'orange' | 'violet' | 'emerald' | 'rose'

export interface RoutineChapterSource {
  id: string
  kind: RoutineChapterKind
  /** 界面上的位置标签，如 第三式 / 预备势 / 虎戏 */
  label: string
  /** 标准视频字幕中的全名，如 调理脾胃须单举 */
  name: string
  /** 在标准视频中的起点，秒 */
  startSeconds: number
  cue: string
}

export interface RoutineChapter extends RoutineChapterSource {
  /** 从 0 开始 */
  index: number
  /** 仅 form 章节，从 1 开始 */
  formNumber?: number
  /** 下一章起点，最后一章为视频结尾 */
  endSeconds: number
}

export interface RoutineVideo {
  src: string
  poseTrackSrc: string
  posterSrc: string
  width: number
  height: number
  /** 帧内画面的宽高比；太极拳视频为 16:9 帧内的 4:3 画面，只裁黑边 */
  contentAspect: number
  durationSeconds: number
  /** 发布文件的 RFC 6381 编码，由单测核对 */
  codecs: string
}

export interface RoutineProgram {
  id: RoutineId
  /** 章节时间或内容变化时递增，保证历史记录可比 */
  version: string
  title: string
  subtitle: string
  description: string
  /** 式 / 动 / 势 */
  formUnit: string
  accent: RoutineAccent
  video: RoutineVideo
  chapters: ReadonlyArray<RoutineChapter>
  timingSource: string
}

export type RoutineScope =
  | { kind: 'full' }
  | { kind: 'form'; chapterId: string }
