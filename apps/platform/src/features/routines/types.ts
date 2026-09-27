/** The four follow-along routines integrated from the teammate's 2026-09 standard-video version. */
export type RoutineId = 'baduanjin' | 'taijiquan' | 'wuqinxi' | 'yijinjing'

/** Opening and closing sequences belong to the routine but are not numbered forms. */
export type RoutineChapterKind = 'opening' | 'form' | 'closing'

/** Accent family used sparingly for mode identity (chips, ribbon highlight). Primary actions stay FormPilot blue. */
export type RoutineAccent = 'orange' | 'violet' | 'emerald' | 'rose'

export interface RoutineChapterSource {
  id: string
  kind: RoutineChapterKind
  /** Short position label shown in the UI, e.g. 第三式 / 预备势 / 虎戏. */
  label: string
  /** Full name as captioned in the standard video, e.g. 调理脾胃须单举. */
  name: string
  /** When the chapter begins in the standard video, in seconds. */
  startSeconds: number
  /** What to watch for while following this chapter. */
  cue: string
}

export interface RoutineChapter extends RoutineChapterSource {
  /** 0-based position in the routine. */
  index: number
  /** 1-based number among `form` chapters only. */
  formNumber?: number
  /** Next chapter's start, or the video's end for the last chapter. */
  endSeconds: number
}

export interface RoutineVideo {
  src: string
  poseTrackSrc: string
  posterSrc: string
  width: number
  height: number
  /**
   * Aspect ratio of the picture inside the frame. Differs from width / height when the source is pillarboxed
   * (the 太极拳 video carries 4:3 footage in a 16:9 frame); the stage crops only the black bars.
   */
  contentAspect: number
  durationSeconds: number
  /** RFC 6381 codecs of the shipped file, e.g. `avc1.64001E, mp4a.40.2` (checked against the MP4 by a unit test). */
  codecs: string
}

export interface RoutineProgram {
  id: RoutineId
  /** Bumped whenever chapter timing or content changes, so saved sessions can be compared safely. */
  version: string
  title: string
  subtitle: string
  description: string
  /** Counting word for numbered forms: 式 / 动 / 势. */
  formUnit: string
  accent: RoutineAccent
  video: RoutineVideo
  chapters: ReadonlyArray<RoutineChapter>
  /** How the chapter times were established, kept next to the data it justifies. */
  timingSource: string
}

/** A full run of the routine, or one numbered form practised on its own. */
export type RoutineScope =
  | { kind: 'full' }
  | { kind: 'form'; chapterId: string }
