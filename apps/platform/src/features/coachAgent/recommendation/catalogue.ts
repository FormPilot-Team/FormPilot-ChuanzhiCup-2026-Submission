import { routinePath, routineTrainingPath } from '../../../app/routes'
import { ROUTINE_PROGRAMS } from '../../routines/programs'
import type { RoutineId } from '../../routines/types'
import type { BodyRegion, Focus, KnowledgeEntry } from './types'

type MotionMap = Pick<KnowledgeEntry, 'regions' | 'focuses' | 'movement' | 'caution'>
const PROGRAM_SOURCE = 'apps/platform/src/features/routines/programs.ts#ROUTINE_PROGRAMS'

function motion(regions: BodyRegion[], focuses: Focus[], movement: string, caution: KnowledgeEntry['caution'] = []): MotionMap {
  return { regions, focuses, movement, caution }
}

/** Project motion descriptions only. Suitability and clinical benefit are NOT verified by these tags. */
const CHAPTER_MOTIONS: Readonly<Record<string, MotionMap>> = {
  'bdj-open': motion(['arms', 'legs'], ['general', 'stability'], '开立屈膝、抱球与自然呼吸'),
  'bdj-1': motion(['shoulders', 'arms'], ['reach', 'coordination'], '双臂同时上托、下落', ['overhead']),
  'bdj-2': motion(['shoulders', 'arms', 'legs'], ['reach', 'coordination', 'stability'], '马步中左右交替拉弓与侧向推掌', ['balance']),
  'bdj-3': motion(['shoulders', 'arms'], ['reach', 'coordination'], '一掌上托、一掌下按，左右交替', ['overhead']),
  'bdj-4': motion(['neck', 'shoulders'], ['coordination', 'stability'], '躯干正直，转头并两臂外旋', ['twist']),
  'bdj-5': motion(['trunk', 'legs', 'neck'], ['coordination', 'stability'], '马步下蹲与上身左右摇转、侧摆', ['twist', 'balance']),
  'bdj-6': motion(['trunk', 'arms', 'legs'], ['reach', 'coordination'], '俯身沿腿下攀，再起身还原；含明显俯身', ['bending']),
  'bdj-7': motion(['arms', 'shoulders', 'legs'], ['rhythm', 'coordination'], '马步中左右交替冲拳、旋腕与收拳', ['balance']),
  'bdj-8': motion(['legs'], ['stability', 'rhythm'], '双脚提踵、短暂停留与脚跟轻落', ['balance']),
  'bdj-close': motion(['arms'], ['general'], '两掌叠于腹前、放松还原'),

  'tjq-1': motion(['shoulders', 'arms', 'legs'], ['coordination', 'general'], '双臂前平举、屈膝按掌'),
  'tjq-2': motion(['arms', 'trunk', 'legs'], ['coordination', 'stability'], '弓步分掌、转腰带手、左右支撑转换', ['twist', 'balance']),
  'tjq-3': motion(['shoulders', 'arms', 'legs'], ['coordination', 'stability'], '后坐成虚步，一手额前上提、一手下按', ['overhead', 'balance']),
  'tjq-4': motion(['arms', 'trunk', 'legs'], ['coordination', 'rhythm'], '弓步推掌与搂膝配合', ['balance']),
  'tjq-5': motion(['arms', 'legs'], ['stability', 'coordination'], '后坐虚步、双臂合抱', ['balance']),
  'tjq-6': motion(['arms', 'legs'], ['coordination', 'rhythm'], '退步卷肱、左右交替前推后撤', ['balance']),
  'tjq-7': motion(['arms', 'trunk', 'legs'], ['coordination', 'rhythm'], '掤捋挤按连贯、支撑前后转换', ['balance']),
  'tjq-8': motion(['arms', 'trunk', 'legs'], ['coordination', 'rhythm'], '转体换向、掤捋挤按连贯', ['twist', 'balance']),
  'tjq-9': motion(['shoulders', 'arms', 'legs'], ['coordination', 'stability'], '勾手、随转体推掌、弓步定势', ['twist', 'balance']),
  'tjq-10': motion(['shoulders', 'arms', 'trunk', 'legs'], ['coordination', 'rhythm'], '两臂交替画圆、以腰带手与侧行步', ['twist', 'balance']),
  'tjq-11': motion(['shoulders', 'arms', 'legs'], ['coordination', 'stability'], '勾手、推掌与弓步同时到位', ['balance']),
  'tjq-12': motion(['arms', 'legs'], ['coordination', 'stability'], '后脚跟进、一掌探出一掌回收', ['balance']),
  'tjq-13': motion(['arms', 'legs'], ['stability', 'coordination'], '双手分开、提膝蹬脚、单腿支撑', ['balance']),
  'tjq-14': motion(['shoulders', 'arms', 'legs'], ['coordination', 'stability'], '弓步、双拳从两侧向前上方贯打', ['balance']),
  'tjq-15': motion(['arms', 'trunk', 'legs'], ['stability', 'coordination'], '转身提膝、左脚蹬出、双手分开', ['twist', 'balance']),
  'tjq-16': motion(['legs', 'trunk'], ['stability', 'coordination'], '左侧仆步下势、起身提膝独立；含深屈膝', ['balance']),
  'tjq-17': motion(['legs', 'trunk'], ['stability', 'coordination'], '右侧仆步下势、起身提膝独立；含深屈膝', ['balance']),
  'tjq-18': motion(['shoulders', 'arms', 'legs'], ['coordination', 'rhythm'], '弓步架推、一手上架一手前推、左右交替', ['overhead', 'balance']),
  'tjq-19': motion(['arms', 'trunk', 'legs'], ['reach', 'coordination'], '虚步中一手向前下方插掌；含俯身', ['balance', 'bending']),
  'tjq-20': motion(['shoulders', 'arms', 'legs'], ['reach', 'coordination'], '弓步、一手上架一手前推', ['overhead', 'balance']),
  'tjq-21': motion(['arms', 'trunk', 'legs'], ['coordination', 'rhythm'], '转身搬拳、拦掌与冲拳连续配合', ['twist', 'balance']),
  'tjq-22': motion(['shoulders', 'arms', 'legs'], ['coordination', 'rhythm'], '双掌翻转回收后再前推', ['balance']),
  'tjq-23': motion(['arms', 'trunk'], ['stability', 'coordination'], '双臂胸前交叉、保持身体中正'),
  'tjq-24': motion(['arms'], ['general'], '双掌下落、缓缓还原站立'),

  'wqx-open': motion(['shoulders', 'arms'], ['general', 'coordination'], '双掌上托下按、自然调息'),
  'wqx-1': motion(['shoulders', 'arms'], ['reach', 'coordination'], '虎爪双掌上举、下拉', ['overhead']),
  'wqx-2': motion(['arms', 'trunk', 'legs'], ['coordination', 'reach'], '双手前伸、躯干由屈到伸、屈膝前扑', ['bending']),
  'wqx-3': motion(['arms', 'trunk', 'legs'], ['coordination', 'stability'], '转腰侧屈、鹿角手向后下抵与弓步', ['twist', 'balance']),
  'wqx-4': motion(['shoulders', 'arms', 'trunk', 'legs'], ['reach', 'coordination'], '弓步前伸、含胸弓背、两臂内旋前伸', ['balance']),
  'wqx-5': motion(['trunk', 'arms'], ['coordination', 'rhythm'], '腰腹带动、双手在腹前画圆', ['twist']),
  'wqx-6': motion(['trunk', 'legs'], ['stability', 'rhythm'], '提髋起步、落步与身体左右晃动', ['balance']),
  'wqx-7': motion(['neck', 'shoulders', 'arms', 'legs'], ['coordination', 'stability'], '耸肩缩颈、提踵收腹、猿钩上提；耸肩为本式要求', ['balance']),
  'wqx-8': motion(['shoulders', 'arms', 'legs'], ['reach', 'coordination'], '退步屈膝、上步举手摘果、眼随手动', ['overhead', 'balance']),
  'wqx-9': motion(['shoulders', 'arms', 'trunk', 'legs'], ['reach', 'stability'], '双掌上举、身体后伸、后伸一腿', ['overhead', 'balance']),
  'wqx-10': motion(['shoulders', 'arms', 'legs'], ['stability', 'rhythm'], '双臂如翅起落、提膝单腿独立', ['balance']),
  'wqx-close': motion(['arms'], ['general'], '双掌下落腹前、放松收势'),

  'yjj-open': motion(['trunk', 'legs'], ['general', 'stability'], '头正身直、自然站立'),
  'yjj-1': motion(['shoulders', 'arms'], ['stability', 'general'], '双掌合于胸前、肩肘放松、保持中正'),
  'yjj-2': motion(['shoulders', 'arms'], ['stability', 'reach'], '双臂侧平举、立掌外撑、保持不晃'),
  'yjj-3': motion(['shoulders', 'arms', 'legs'], ['reach', 'stability'], '双掌过顶上托、提踵保持', ['overhead', 'balance']),
  'yjj-4': motion(['shoulders', 'arms', 'neck'], ['reach', 'stability'], '一手上举、一手腰后、目视掌心', ['overhead']),
  'yjj-5': motion(['arms', 'trunk', 'legs'], ['coordination', 'stability'], '弓步转腰、双拳前后对拉', ['twist', 'balance']),
  'yjj-6': motion(['shoulders', 'arms'], ['reach', 'stability'], '双掌前推、稍停与回收'),
  'yjj-7': motion(['shoulders', 'arms', 'trunk'], ['reach', 'coordination'], '一手绕头、一手背后上提、转体拔伸；含绕肩', ['overhead', 'twist']),
  'yjj-8': motion(['legs', 'arms'], ['stability', 'coordination'], '屈膝下蹲、双掌下按并稍停；含深屈膝', ['balance']),
  'yjj-9': motion(['arms', 'trunk'], ['reach', 'coordination'], '转腰探爪、屈身下探', ['twist', 'bending']),
  'yjj-10': motion(['arms', 'shoulders', 'trunk', 'legs'], ['stability', 'coordination'], '弓步前扑、塌腰抬头、十指撑地；含上肢撑地负荷', ['balance', 'bending', 'weight_bearing']),
  'yjj-11': motion(['arms', 'trunk'], ['coordination', 'stability'], '双手抱后脑、俯身逐节卷屈后起身；含明显俯身', ['bending']),
  'yjj-12': motion(['arms', 'trunk', 'legs'], ['coordination', 'stability'], '双手交叉俯身、抬头左右摆动；含明显俯身', ['twist', 'balance', 'bending']),
  'yjj-close': motion(['shoulders', 'arms'], ['general'], '双臂上举后缓缓下落、静立调息', ['overhead']),
}

const ROUTINE_MOTIONS: Record<RoutineId, MotionMap> = {
  baduanjin: motion(['shoulders', 'arms', 'neck', 'trunk', 'legs'], ['reach', 'coordination', 'general'], '八式的上举、侧推、转头、俯身、冲拳与提踵；整套包含不同负荷', ['overhead', 'twist', 'balance', 'bending']),
  taijiquan: motion(['arms', 'trunk', 'legs', 'shoulders'], ['coordination', 'rhythm', 'stability'], '二十四式连续步法、推掌、转体与支撑转换；含蹬脚、仆步与独立', ['overhead', 'twist', 'balance', 'bending']),
  wuqinxi: motion(['shoulders', 'arms', 'trunk', 'legs'], ['coordination', 'rhythm', 'reach'], '五戏十动的上举、前伸、转腰、晃动与提膝；含单腿支撑', ['overhead', 'twist', 'balance', 'bending']),
  yijinjing: motion(['shoulders', 'arms', 'trunk', 'legs'], ['stability', 'reach', 'coordination'], '十二势的上托、侧平举、推掌、转体与定势；含撑地与明显俯身', ['overhead', 'twist', 'balance', 'bending', 'weight_bearing']),
}

const routineEntries: KnowledgeEntry[] = ROUTINE_PROGRAMS.flatMap(program => [
  {
    id: program.id, kind: 'routine' as const, programId: program.id, title: program.title,
    ...ROUTINE_MOTIONS[program.id], verification: 'project_verified' as const,
    sources: [PROGRAM_SOURCE], href: routinePath(program.id),
  },
  ...program.chapters.map(chapter => {
    const mapped = CHAPTER_MOTIONS[chapter.id]
    if (!mapped) throw new Error(`Missing AI Coach knowledge mapping: ${chapter.id}`)
    return {
      id: chapter.id, kind: 'chapter' as const, programId: program.id, chapterId: chapter.id,
      title: `${program.title} · ${chapter.name}`, ...mapped,
      verification: 'project_verified' as const,
      sources: [PROGRAM_SOURCE, `apps/platform/src/features/routines/analyzers/${program.id}/steps.ts#${program.id.toUpperCase()}_STEPS`],
      // Existing scope parsing accepts numbered forms only. Never label a full routine as an opening/closing deep link.
      href: chapter.kind === 'form' ? routineTrainingPath(program.id, chapter.id) : null,
    }
  }),
])

const gameEntries: KnowledgeEntry[] = [
  {
    id: 'apple', kind: 'game', title: '摘苹果',
    ...motion(['shoulders', 'arms'], ['reach', 'stability', 'coordination'], '向上、向侧面伸手触达目标并短暂停留', ['overhead']),
    verification: 'project_verified', sources: ['apps/motion-games-lab/app/src/data/games.ts#GAMES', 'apps/motion-games-lab/app/src/motion/targetTracker.ts'], href: null,
  },
  {
    id: 'boating', kind: 'game', title: '林间划船',
    ...motion(['shoulders', 'arms'], ['rhythm', 'coordination'], '双手在身前左右交替向外划开、收回；不是肩旋转角度测量'),
    verification: 'project_verified', sources: ['apps/motion-games-lab/app/src/data/games.ts#GAMES', 'apps/motion-games-lab/app/src/games/boating/README.md'], href: null,
  },
  {
    id: 'archery', kind: 'game', title: '林间射箭',
    ...motion(['shoulders', 'arms'], ['stability', 'coordination', 'reach'], '双臂拉开、持弓手瞄准、拉弦手收回胸前；拉弓量为手腕间距代理'),
    verification: 'project_verified', sources: ['apps/motion-games-lab/app/src/data/games.ts#GAMES', 'apps/motion-games-lab/app/src/games/archery/README.md'], href: null,
  },
  {
    id: 'racing', kind: 'game', title: '体感赛车',
    ...motion(['arms', 'trunk', 'legs'], ['coordination', 'rhythm', 'stability'], '按控制模式进行上身移动、侧倾或手势转向；身体模式另含可选踏步与双手上举', ['overhead', 'balance']),
    verification: 'project_verified', sources: ['apps/poseverse/js/racing-control-modes.js#RACING_CONTROL_MODES', 'apps/poseverse/js/racing-body-difficulty.js#CORE_ACTIONS'], href: null,
  },
]

/** 4 routines + all 60 existing chapters + 4 games. No clinical efficacy or automatic cross-app data access. */
export const COACH_KNOWLEDGE: readonly KnowledgeEntry[] = Object.freeze([...routineEntries, ...gameEntries])
