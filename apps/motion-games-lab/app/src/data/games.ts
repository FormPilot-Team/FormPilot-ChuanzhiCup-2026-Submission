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
    movement: '双臂有节奏地划动',
    description: '顺着森林里的小河划船，左右手轮流划桨，船就会往前走。',
    available: false,
    paint: paintRiverCard,
  },
  {
    id: 'archery',
    name: '林间射箭',
    english: 'Archery',
    movement: '拉开双臂、稳住、放开',
    description: '在林间训练场拉弓，稳稳地保持一会儿，再松手射向靶心。',
    available: false,
    paint: paintRangeCard,
  },
]

export const COPY = Object.freeze({
  productName: 'Motion Games Lab',
  tagline: '跟着身体动起来的森林小游戏',
  safety: '动作慢一点，在舒服的范围内就好。感到不适请立即停止。',
  comingSoon: '敬请期待',
  steps: ['游戏说明', '站位', '摄像头识别', '准备', '开始'],
  apple: {
    title: '摘苹果',
    lead: '举起手，把树上的苹果一个个摘下来。',
    how: [
      { title: '把手伸到苹果上', text: '屏幕上的圆圈就是你的手' },
      { title: '停一下', text: '等金色圆圈转满' },
      { title: '苹果落进篮子', text: '摘得越多，分数越高' },
    ],
  },
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
})
