// Game Hub catalog. All player-facing wording lives in src/data so it can be reviewed in one place:
// no medical-effect claims, short sentences, a safety reminder where it matters.
import type { GameId } from '../shared/metrics'
import { paintOrchardCard, paintRangeCard, paintRiverCard } from '../shared/world/painters'

export interface GameCard {
  id: GameId
  name: string
  english: string
  movement: string
  description: string
  available: boolean
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

export const GAMES: GameCard[] = [
  {
    id: 'apple',
    name: '摘苹果',
    english: 'Apple Picking',
    movement: '向上、向侧面伸手',
    description: '果园里的苹果熟了。把手伸到苹果上停一下，苹果就会落进篮子里。',
    available: true,
    paint: paintOrchardCard,
  },
  {
    id: 'boating',
    name: '林间划船',
    english: 'Boating',
    movement: '两手轮流向外划',
    description: '顺着森林里的小河划船。左右手轮流向外侧划开，节奏越稳，船走得越快。',
    available: true,
    paint: paintRiverCard,
  },
  {
    id: 'archery',
    name: '林间射箭',
    english: 'Archery',
    movement: '拉开双臂、稳住、松手',
    description: '在林间靶场拉开弓，稳稳地保持一会儿，再松手把箭射向靶心。',
    available: true,
    paint: paintRangeCard,
  },
]

export interface IntroCopy {
  title: string
  lead: string
  how: { title: string; text: string }[]
}

export const INTRO: Record<GameId, IntroCopy> = {
  apple: {
    title: '摘苹果',
    lead: '举起手，把树上的苹果一个个摘下来。',
    how: [
      { title: '把手伸到苹果上', text: '屏幕上的小手跟着你的手动' },
      { title: '停一下', text: '小手半握住，等金色圆圈转满' },
      { title: '苹果落进篮子', text: '摘得越多，分数越高' },
    ],
  },
  boating: {
    title: '林间划船',
    lead: '像划水一样，两只手轮流向外侧划开再收回，小船就往前走。',
    how: [
      { title: '两手放在身前', text: '手肘靠近身体，放松就好' },
      { title: '向外侧划开，再收回', text: '从身前划到外侧，再回到身前' },
      { title: '轮流划，节奏稳', text: '左右轮流划，顺路收下花灯' },
    ],
  },
  archery: {
    title: '林间射箭',
    lead: '双手合在胸前，向两边拉开弓，稳住，再松手放箭。',
    how: [
      { title: '双手合在胸前', text: '就像握住了弓和弦' },
      { title: '向两边拉开，稳住', text: '持弓的手伸直，等圆圈转满' },
      { title: '拉弦的手往回一松', text: '箭就飞出去啦，越稳越准' },
    ],
  },
}

export const COPY = Object.freeze({
  productName: 'Motion Games Lab',
  tagline: '跟着身体动起来的森林小游戏',
  safety: '动作慢一点，在舒服的范围内就好。感到不适请立即停止。',
  comingSoon: '敬请期待',
  steps: ['游戏说明', '站位', '摄像头识别', '准备', '开始'],
  positioning: {
    standing: ['面对屏幕站好，离摄像头大约 1.5 到 2 米', '让上半身和双手都出现在画面里', '头顶和两侧留出伸手的空间', '光线明亮一些，不要背对窗户'],
    seated: ['坐在稳固的椅子上，面对屏幕，离摄像头大约 1.5 米', '让上半身和双手都出现在画面里', '头顶和两侧留出伸手的空间', '光线明亮一些，不要背对窗户'],
  },
  hints: {
    lean: '身体保持正直，够不到也没关系',
    shrug: '肩膀放松，往下沉一沉',
    rest: '累了可以随时暂停，休息一下',
    lostTitle: '看不到你啦',
    lostText: '请回到摄像头前，让上半身和双手出现在画面里',
    found: '找到你了，马上继续',
  },
  boating: {
    tooSmall: '再往外划开一点，船会走得更快',
    raised: '手放低一些，在身前划就好',
    turned: '身体正对屏幕，只动手臂',
    rhythm: '顺流而下！节奏真稳',
    cueLeft: '左边有花灯',
    cueRight: '右边有花灯',
  },
  archery: {
    ready: '双手合在胸前，准备拉弓',
    draw: '向两边拉开弓',
    hold: '稳住…',
    armed: '松手！拉弦的手往回一松',
    reset: '再来一箭：双手回到胸前',
    turned: '身体正对屏幕，用手臂拉弓',
    bowArmBent: '持弓的手臂再伸直一些',
    bowArmSoft: '手臂再伸展一点会更稳',
    elbowOnly: '拉弦时手肘也一起往外拉',
    handsLow: '把弓抬到胸口的高度',
    lowered: '没关系，放下休息一下，再来一箭',
    timeout: '松手就能放箭，拉弦的手往回一松',
  },
})
